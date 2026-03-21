import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { SYSTEM_BOOTSTRAP_INVITE_CREATOR_ID } from "../src/worker/auth/bootstrap";
import { generateDurableEntityId, generateOpaqueToken, hashSha256 } from "../src/worker/services/id-service";

const execFile = promisify(execFileCallback);
const MAX_INVITE_TTL_HOURS = 24 * 30;
const DEFAULT_INVITE_TTL_HOURS = 24;
const DEFAULT_DATABASE = "anvil-db";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const HELP_TEXT = `Seed a one-time bootstrap invite for the first user.

Usage:
  node --import tsx scripts/seed-bootstrap-invite.ts --local [options]
  node --import tsx scripts/seed-bootstrap-invite.ts --remote [options]

Options:
  --local                  Seed the local D1 database
  --remote                 Seed the remote D1 database
  --database NAME          D1 database binding/name (default: ${DEFAULT_DATABASE})
  --expires-in-hours N     Invite TTL in hours (default: ${DEFAULT_INVITE_TTL_HOURS}, max: ${MAX_INVITE_TTL_HOURS})
  --persist-to PATH        Local D1 persistence directory for --local
  --dry-run                Generate output but do not execute the INSERT
  --print-sql              Print the generated SQL statements
  --force                  Replace existing unused sentinel bootstrap invites
  --json                   Print a machine-readable JSON payload
  --help                   Show this help text

Examples:
  npm run db:seed-initial-user -- --local
  npm run db:seed-initial-user -- --remote --expires-in-hours 4
`;

interface Options {
  mode: "local" | "remote";
  database: string;
  expiresInHours: number;
  persistTo: string | null;
  dryRun: boolean;
  printSql: boolean;
  force: boolean;
  json: boolean;
}

interface ParsedArguments {
  options: Options | null;
  requestedHelp: boolean;
}

interface WranglerStatementResult {
  success: boolean;
  results?: Array<Record<string, unknown>>;
  error?: string;
}

class CliError extends Error {}

interface SeedBootstrapInviteJsonOutput {
  mode: Options["mode"];
  database: string;
  inviteId: string;
  token: string;
  expiresAt: string;
  sentinelCreator: string;
  dryRun: boolean;
}

const printHelp = (): void => {
  process.stdout.write(`${HELP_TEXT}\n`);
};

const escapeSqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const toHex = (value: Uint8Array): string => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
const toBlobLiteral = (value: Uint8Array): string => `X'${toHex(value)}'`;

const parseNumberFlag = (name: string, rawValue: string): number => {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new CliError(`${name} must be a valid number.`);
  }

  return value;
};

const parseArguments = (argv: string[]): ParsedArguments => {
  if (argv.length === 0) {
    return { options: null, requestedHelp: false };
  }

  let mode: Options["mode"] | null = null;
  let database = DEFAULT_DATABASE;
  let expiresInHours = DEFAULT_INVITE_TTL_HOURS;
  let persistTo: string | null = null;
  let dryRun = false;
  let printSql = false;
  let force = false;
  let json = false;
  let requestedHelp = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--help":
      case "-h":
        requestedHelp = true;
        break;
      case "--local":
        if (mode && mode !== "local") {
          throw new CliError("Specify exactly one of --local or --remote.");
        }
        mode = "local";
        break;
      case "--remote":
        if (mode && mode !== "remote") {
          throw new CliError("Specify exactly one of --local or --remote.");
        }
        mode = "remote";
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--print-sql":
        printSql = true;
        break;
      case "--force":
        force = true;
        break;
      case "--json":
        json = true;
        break;
      case "--database":
      case "--expires-in-hours":
      case "--persist-to": {
        const rawValue = argv[index + 1];
        if (!rawValue || rawValue.startsWith("--")) {
          throw new CliError(`${argument} requires a value.`);
        }

        index += 1;
        if (argument === "--database") {
          database = rawValue;
        } else if (argument === "--expires-in-hours") {
          expiresInHours = parseNumberFlag(argument, rawValue);
        } else {
          persistTo = rawValue;
        }
        break;
      }
      default:
        throw new CliError(`Unknown argument: ${argument}`);
    }
  }

  if (requestedHelp) {
    return { options: null, requestedHelp: true };
  }

  if (!mode) {
    return { options: null, requestedHelp: false };
  }

  if (!database.trim()) {
    throw new CliError("--database cannot be empty.");
  }

  if (!Number.isFinite(expiresInHours) || expiresInHours <= 0 || expiresInHours > MAX_INVITE_TTL_HOURS) {
    throw new CliError(`--expires-in-hours must be between 1 and ${MAX_INVITE_TTL_HOURS}.`);
  }

  if (persistTo && mode !== "local") {
    throw new CliError("--persist-to can only be used together with --local.");
  }

  return {
    options: {
      mode,
      database: database.trim(),
      expiresInHours,
      persistTo,
      dryRun,
      printSql,
      force,
      json,
    },
    requestedHelp: false,
  };
};

const createWranglerArgs = (
  options: Pick<Options, "database" | "mode" | "persistTo"> &
    ({ command: string; file?: never } | { command?: never; file: string }),
  json: boolean,
): string[] => {
  const args = [
    "wrangler",
    "d1",
    "execute",
    options.database,
    options.mode === "local" ? "--local" : "--remote",
    "--yes",
  ];

  if (options.persistTo) {
    args.push("--persist-to", options.persistTo);
  }

  if ("command" in options && options.command !== undefined) {
    args.push("--command", options.command);
  } else {
    args.push("--file", options.file);
  }

  if (json) {
    args.push("--json");
  }

  return args;
};

const formatCommandFailure = (error: unknown): string => {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    const stdout = String((error as { stdout?: unknown }).stdout ?? "").trim();
    if (stderr) {
      return stderr;
    }
    if (stdout) {
      return stdout;
    }
  }

  return error instanceof Error ? error.message : String(error);
};

const runWranglerJson = async (
  options: Pick<Options, "database" | "mode" | "persistTo">,
  command: string,
): Promise<WranglerStatementResult[]> => {
  const args = createWranglerArgs({ ...options, command }, true);

  let stdout: string;
  try {
    ({ stdout } = await execFile("npx", args, {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    throw new CliError(formatCommandFailure(error));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new CliError(
      `Failed to parse Wrangler JSON output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new CliError("Wrangler returned an unexpected JSON payload.");
  }

  const statements = parsed as WranglerStatementResult[];
  const failedStatement = statements.find((statement) => !statement.success);
  if (failedStatement) {
    throw new CliError(failedStatement.error ?? "Wrangler reported a failed statement.");
  }

  return statements;
};

const runWranglerFile = async (
  options: Pick<Options, "database" | "mode" | "persistTo">,
  file: string,
  quiet = false,
): Promise<void> => {
  const args = createWranglerArgs({ ...options, file }, false);

  try {
    const { stdout, stderr } = await execFile("npx", args, {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (!quiet && stdout.trim()) {
      process.stdout.write(`${stdout.trim()}\n`);
    }
    if (!quiet && stderr.trim()) {
      process.stderr.write(`${stderr.trim()}\n`);
    }
  } catch (error) {
    throw new CliError(formatCommandFailure(error));
  }
};

const getNumericCell = (statements: WranglerStatementResult[], statementIndex: number, key: string): number => {
  const rawValue = statements[statementIndex]?.results?.[0]?.[key];
  if (typeof rawValue === "number") {
    return rawValue;
  }
  if (typeof rawValue === "string" && rawValue.length > 0) {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new CliError(`Wrangler response did not include a numeric ${key} value.`);
};

const buildBootstrapInviteSql = (params: {
  inviteId: string;
  tokenHash: Uint8Array;
  now: number;
  expiresAt: number;
  replaceExistingUnusedBootstrapInvites: boolean;
}): string => {
  const lines: string[] = [];

  if (params.replaceExistingUnusedBootstrapInvites) {
    lines.push(
      `DELETE FROM invites WHERE created_by_user_id = ${escapeSqlString(SYSTEM_BOOTSTRAP_INVITE_CREATOR_ID)} AND accepted_at IS NULL;`,
    );
  }

  lines.push(
    `INSERT INTO invites (id, created_by_user_id, token_hash, expires_at, accepted_by_user_id, accepted_at, created_at) VALUES (${escapeSqlString(params.inviteId)}, ${escapeSqlString(SYSTEM_BOOTSTRAP_INVITE_CREATOR_ID)}, ${toBlobLiteral(params.tokenHash)}, ${params.expiresAt}, NULL, NULL, ${params.now});`,
  );

  return `${lines.join("\n")}\n`;
};

const main = async (): Promise<void> => {
  const { options, requestedHelp } = parseArguments(process.argv.slice(2));

  if (requestedHelp) {
    printHelp();
    return;
  }

  if (!options) {
    printHelp();
    throw new CliError("Missing required mode flag. Specify either --local or --remote.");
  }

  const now = Date.now();
  const preflightSql = [
    "SELECT COUNT(*) AS userCount FROM users",
    `SELECT COUNT(*) AS activeBootstrapInviteCount FROM invites WHERE created_by_user_id = ${escapeSqlString(SYSTEM_BOOTSTRAP_INVITE_CREATOR_ID)} AND accepted_at IS NULL AND expires_at > ${now}`,
  ].join("; ");
  const preflight = await runWranglerJson(options, preflightSql);
  const userCount = getNumericCell(preflight, 0, "userCount");
  const activeBootstrapInviteCount = getNumericCell(preflight, 1, "activeBootstrapInviteCount");

  if (userCount > 0) {
    throw new CliError(
      `Refusing to seed a bootstrap invite because ${userCount} user row${userCount === 1 ? "" : "s"} already exist.`,
    );
  }

  if (activeBootstrapInviteCount > 0 && !options.force) {
    throw new CliError(
      `Refusing to seed a bootstrap invite because ${activeBootstrapInviteCount} unused sentinel bootstrap invite${activeBootstrapInviteCount === 1 ? " already exists" : "s already exist"}. Re-run with --force to replace it.`,
    );
  }

  const token = generateOpaqueToken(32);
  const inviteId = generateDurableEntityId("inv", now);
  const expiresAt = now + Math.round(options.expiresInHours * 60 * 60 * 1000);
  const tokenHash = await hashSha256(token);
  const sql = buildBootstrapInviteSql({
    inviteId,
    tokenHash,
    now,
    expiresAt,
    replaceExistingUnusedBootstrapInvites: options.force && activeBootstrapInviteCount > 0,
  });

  if (options.printSql) {
    process.stdout.write(`${sql}\n`);
  }

  if (!options.dryRun) {
    const tempDirectory = await mkdtemp(join(tmpdir(), "anvil-bootstrap-invite-"));
    const sqlFile = join(tempDirectory, "seed-bootstrap-invite.sql");

    try {
      await writeFile(sqlFile, sql, "utf8");
      await runWranglerFile(options, sqlFile, options.json);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }

  if (options.json) {
    const output: SeedBootstrapInviteJsonOutput = {
      mode: options.mode,
      database: options.database,
      inviteId,
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      sentinelCreator: SYSTEM_BOOTSTRAP_INVITE_CREATOR_ID,
      dryRun: options.dryRun,
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }

  const outputLines = [
    options.dryRun
      ? "Bootstrap invite dry run complete. No database changes were made."
      : "Bootstrap invite seeded successfully.",
    `Mode: ${options.mode}`,
    `Database: ${options.database}`,
    `Invite ID: ${inviteId}`,
    `Sentinel creator: ${SYSTEM_BOOTSTRAP_INVITE_CREATOR_ID}`,
    `Expires at: ${new Date(expiresAt).toISOString()}`,
    options.dryRun ? `Dry-run token (not persisted): ${token}` : `Invite token: ${token}`,
    options.dryRun
      ? "Warning: this dry-run token was not inserted and will not work."
      : "Warning: treat this token as a one-time secret until it is redeemed or expires.",
  ];

  process.stdout.write(`${outputLines.join("\n")}\n`);
};

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

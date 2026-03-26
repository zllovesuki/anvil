import { SELF, applyD1Migrations, env, listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { asc } from "drizzle-orm";

import {
  BranchName,
  DEFAULT_DISPATCH_MODE,
  DEFAULT_EXECUTION_RUNTIME,
  type DispatchMode,
  OwnerSlug,
  ProjectId,
  ProjectSlug,
  type LoginRequest,
  type LoginResponse,
  UserId,
} from "@/contracts";
import { createSession, hashPassword } from "@/worker/auth";
import { createD1Db } from "@/worker/db/d1";
import * as d1Schema from "@/worker/db/d1/schema";
import * as projectDoSchema from "@/worker/db/durable/schema/project-do";
import { ProjectDO } from "@/worker/durable";
import type { ProjectDoContext } from "@/worker/durable/project-do/types";
import { encryptSecret } from "@/worker/security/secrets";
import { generateDurableEntityId } from "@/worker/services";

import d1MigrationJournal from "../../drizzle/d1/meta/_journal.json";

const d1MigrationFiles = import.meta.glob("../../drizzle/d1/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface MigrationJournalEntry {
  tag: string;
}

const splitMigrationStatements = (sql: string): string[] =>
  sql
    .split("--> statement-breakpoint")
    .map((query) => query.trim())
    .filter((query) => query.length > 0);

export const readAppD1Migrations = () =>
  d1MigrationJournal.entries.map((entry: MigrationJournalEntry) => {
    const fileName = `${entry.tag}.sql`;
    const filePath = `../../drizzle/d1/${fileName}`;
    const sql = d1MigrationFiles[filePath];

    if (!sql) {
      throw new Error(`Missing D1 migration file for ${fileName}.`);
    }

    return {
      name: fileName,
      queries: splitMigrationStatements(sql),
    };
  });

export interface SeededUser {
  id: UserId;
  slug: OwnerSlug;
  email: string;
  displayName: string;
  password: string;
}

export interface SeededProject {
  id: ProjectId;
  ownerUserId: UserId;
  ownerSlug: OwnerSlug;
  projectSlug: ProjectSlug;
  name: string;
  repoUrl: string;
  defaultBranch: BranchName;
  configPath: string;
}

interface SeedUserOverrides {
  id?: string;
  slug?: string;
  email?: string;
  displayName?: string;
  password?: string;
}

interface SeedProjectOverrides {
  id?: string;
  projectSlug?: string;
  name?: string;
  repoUrl?: string;
  defaultBranch?: string;
  configPath?: string;
  dispatchMode?: DispatchMode;
  repoToken?: string | null;
}

export interface ProjectDoSnapshot {
  state: typeof projectDoSchema.projectState.$inferSelect | null;
  config: typeof projectDoSchema.projectConfig.$inferSelect | null;
  runs: Array<typeof projectDoSchema.projectRuns.$inferSelect>;
  webhooks: Array<typeof projectDoSchema.projectWebhooks.$inferSelect>;
  webhookDeliveries: Array<typeof projectDoSchema.projectWebhookDeliveries.$inferSelect>;
}

export interface JsonFetchResult<T> {
  response: Response;
  status: number;
  body: T | null;
  text: string;
}

export const getDb = () => createD1Db(env.DB);

export const applyAppMigrations = async (): Promise<void> => {
  await applyD1Migrations(env.DB, readAppD1Migrations());
};

export const seedUser = async (overrides: SeedUserOverrides = {}): Promise<SeededUser> => {
  const db = getDb();
  const now = Date.now();
  const password = overrides.password ?? "correct horse battery staple";
  const user = {
    id: overrides.id ? UserId.assertDecode(overrides.id) : UserId.assertDecode(generateDurableEntityId("usr", now)),
    slug: overrides.slug ? OwnerSlug.assertDecode(overrides.slug) : OwnerSlug.assertDecode("tester"),
    email: overrides.email ?? "tester@example.com",
    displayName: overrides.displayName ?? "Test Operator",
    password,
  };

  const passwordHash = await hashPassword(password, env);

  await db.insert(d1Schema.users).values({
    id: user.id,
    slug: user.slug,
    email: user.email,
    displayName: user.displayName,
    createdAt: now,
    disabledAt: null,
  });
  await db.insert(d1Schema.passwordCredentials).values({
    userId: user.id,
    algorithm: passwordHash.algorithm,
    digest: passwordHash.digest,
    iterations: passwordHash.iterations,
    salt: passwordHash.salt,
    passwordHash: passwordHash.passwordHash,
    updatedAt: now,
  });

  return user;
};

export const seedProject = async (
  owner: Pick<SeededUser, "id" | "slug">,
  overrides: SeedProjectOverrides = {},
): Promise<SeededProject> => {
  const db = getDb();
  const now = Date.now();
  const encryptedToken = typeof overrides.repoToken === "string" ? await encryptSecret(env, overrides.repoToken) : null;

  const project = {
    id: overrides.id
      ? ProjectId.assertDecode(overrides.id)
      : ProjectId.assertDecode(generateDurableEntityId("prj", now)),
    ownerUserId: owner.id,
    ownerSlug: owner.slug,
    projectSlug: overrides.projectSlug
      ? ProjectSlug.assertDecode(overrides.projectSlug)
      : ProjectSlug.assertDecode("anvil-spec"),
    name: overrides.name ?? "Anvil Spec",
    repoUrl: overrides.repoUrl ?? "https://github.com/example/anvil-spec",
    defaultBranch: overrides.defaultBranch
      ? BranchName.assertDecode(overrides.defaultBranch)
      : BranchName.assertDecode("main"),
    configPath: overrides.configPath ?? ".anvil.yml",
  };

  await db.insert(d1Schema.projectIndex).values({
    ...project,
    createdAt: now,
    updatedAt: now,
  });

  await env.PROJECT_DO.getByName(project.id).initializeProject({
    projectId: project.id,
    name: project.name,
    repoUrl: project.repoUrl,
    defaultBranch: project.defaultBranch,
    configPath: project.configPath,
    encryptedRepoToken: encryptedToken,
    dispatchMode: overrides.dispatchMode ?? DEFAULT_DISPATCH_MODE,
    executionRuntime: DEFAULT_EXECUTION_RUNTIME,
    createdAt: now,
    updatedAt: now,
  });

  return project;
};

export const createAuthenticatedSession = async (userId: UserId): Promise<string> => {
  const { sessionId } = await createSession(env, userId, new Date(Date.now()));
  return sessionId;
};

export const authHeaders = (sessionId: string, headers?: HeadersInit): Headers => {
  const result = new Headers(headers);
  result.set("authorization", `Bearer ${sessionId}`);
  return result;
};

export const fetchJson = async <T>(path: string, init: RequestInit = {}): Promise<JsonFetchResult<T>> => {
  const response = await SELF.fetch(`https://example.com${path}`, init);
  const text = await response.text();

  return {
    response,
    status: response.status,
    body: text ? (JSON.parse(text) as T) : null,
    text,
  };
};

export const loginViaRoute = async (
  credentials: Pick<SeededUser, "email" | "password">,
): Promise<JsonFetchResult<LoginResponse>> => {
  const body = {
    email: credentials.email,
    password: credentials.password,
  } satisfies LoginRequest;

  return fetchJson("/api/public/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
};

export const getProjectStub = (projectId: ProjectId) => env.PROJECT_DO.getByName(projectId);

type ProjectDoDbAccessor = Pick<ProjectDoContext, "db">;
type ProjectDoStateAccessor = Pick<ProjectDoContext, "ctx">;

export const runInProjectDo = async <T>(
  projectId: ProjectId,
  callback: (instance: ProjectDO) => Promise<T>,
): Promise<T> => runInDurableObject(getProjectStub(projectId), callback);

export const readProjectDoRows = async (projectId: ProjectId): Promise<ProjectDoSnapshot> =>
  runInProjectDo(projectId, async (instance: ProjectDO) => {
    const { db } = instance as unknown as ProjectDoDbAccessor;
    const stateRows = await db.select().from(projectDoSchema.projectState);
    const configRows = await db.select().from(projectDoSchema.projectConfig);
    const runRows = await db
      .select()
      .from(projectDoSchema.projectRuns)
      .orderBy(asc(projectDoSchema.projectRuns.createdAt), asc(projectDoSchema.projectRuns.runId));
    const webhookRows = await db
      .select()
      .from(projectDoSchema.projectWebhooks)
      .orderBy(asc(projectDoSchema.projectWebhooks.provider), asc(projectDoSchema.projectWebhooks.createdAt));
    const webhookDeliveryRows = await db
      .select()
      .from(projectDoSchema.projectWebhookDeliveries)
      .orderBy(
        asc(projectDoSchema.projectWebhookDeliveries.receivedAt),
        asc(projectDoSchema.projectWebhookDeliveries.id),
      );

    return {
      state: stateRows[0] ?? null,
      config: configRows[0] ?? null,
      runs: runRows,
      webhooks: webhookRows,
      webhookDeliveries: webhookDeliveryRows,
    };
  });

export const drainProjectDoAlarms = async (): Promise<void> => {
  const ids = await listDurableObjectIds(env.PROJECT_DO);

  for (const id of ids) {
    const stub = env.PROJECT_DO.get(id);
    await runInDurableObject(stub, async (instance: ProjectDO) => {
      const { ctx: state } = instance as unknown as ProjectDoStateAccessor;
      await state.storage.deleteAlarm();
    });
  }
};

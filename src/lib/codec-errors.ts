import { EnGardeAssertionError } from "@cloudflare/util-en-garde";

export interface CodecIssueSummary {
  path: string;
  expected: string | null;
  message: string | null;
}

interface CodecIssueSummaryContainer {
  issues: CodecIssueSummary[];
}

type EnGardeIssueLike = EnGardeAssertionError["errors"][number];
type ContextEntryLike = EnGardeIssueLike["context"][number];

const isCodecIssueSummary = (value: unknown): value is CodecIssueSummary =>
  !!value &&
  typeof value === "object" &&
  "path" in value &&
  "expected" in value &&
  "message" in value &&
  typeof value.path === "string" &&
  (value.expected === null || typeof value.expected === "string") &&
  (value.message === null || typeof value.message === "string");

const isCodecIssueSummaryContainer = (value: unknown): value is CodecIssueSummaryContainer =>
  !!value &&
  typeof value === "object" &&
  "issues" in value &&
  Array.isArray(value.issues) &&
  value.issues.every(isCodecIssueSummary);

const formatPath = (context: readonly ContextEntryLike[] | undefined): string => {
  if (!context) {
    return "";
  }

  const keys = context.reduce<string[]>((result, entry) => {
    const key = entry.key?.trim();
    if (!key) {
      return result;
    }

    if (result[result.length - 1] === key) {
      return result;
    }

    result.push(key);
    return result;
  }, []);

  return keys.reduce((path, key) => {
    if (/^\d+$/u.test(key)) {
      return `${path}[${key}]`;
    }

    return path.length === 0 ? key : `${path}.${key}`;
  }, "");
};

const summarizeEnGardeIssue = (issue: EnGardeIssueLike): CodecIssueSummary => {
  const context = issue.context;
  const expected = context[context.length - 1]?.type?.name ?? null;

  return {
    path: formatPath(context),
    expected,
    message: issue.message ?? null,
  };
};

const getCodecIssueSummaries = (value: unknown): CodecIssueSummary[] | null => {
  if (value instanceof EnGardeAssertionError) {
    return value.errors.map((issue) => summarizeEnGardeIssue(issue));
  }

  if (isCodecIssueSummaryContainer(value)) {
    return value.issues;
  }

  return null;
};

const formatIssueSummary = (issue: CodecIssueSummary): string => {
  const subject = issue.path || "value";

  if (issue.message) {
    return `${subject}: ${issue.message}`;
  }

  if (issue.expected) {
    return `${subject}: expected ${issue.expected}`;
  }

  return `${subject}: invalid value`;
};

export const formatCodecIssues = (value: unknown): string | null => {
  const issues = getCodecIssueSummaries(value);
  if (!issues || issues.length === 0) {
    return null;
  }

  const messages = Array.from(new Set(issues.map(formatIssueSummary)));
  return messages.join("; ");
};

export const toCodecIssueDetails = (value: unknown): unknown => {
  const issues = getCodecIssueSummaries(value);
  if (!issues) {
    return value;
  }

  return { issues } satisfies CodecIssueSummaryContainer;
};

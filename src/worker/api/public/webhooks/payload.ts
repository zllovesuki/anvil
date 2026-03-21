import {
  BranchName,
  CommitSha,
  type WebhookProvider as WebhookProviderValue,
  type BranchName as BranchNameValue,
  type CommitSha as CommitShaValue,
} from "@/contracts";
import { type WebhookTriggerPayload } from "@/worker/contracts";
import { normalizeRepositoryUrl } from "@/worker/validation";
import { HttpError } from "@/worker/http";

export type ParsedJsonObject = Record<string, unknown>;

const textDecoder = new TextDecoder();

export const parseJsonObject = (body: Uint8Array): ParsedJsonObject => {
  try {
    const parsed = JSON.parse(textDecoder.decode(body)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }

    return parsed as ParsedJsonObject;
  } catch (error) {
    throw new HttpError(400, "invalid_json", "Webhook body must be valid JSON.", error);
  }
};

export const requireRecord = (value: unknown, fieldName: string): ParsedJsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", `Webhook payload field ${fieldName} is invalid.`);
  }

  return value as ParsedJsonObject;
};

export const requireString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "invalid_request", `Webhook payload field ${fieldName} is invalid.`);
  }

  return value;
};

export const decodeCommitSha = (value: unknown, fieldName: string): CommitShaValue | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "invalid_request", `Webhook payload field ${fieldName} is invalid.`);
  }

  if (/^0+$/u.test(value)) {
    return null;
  }

  try {
    return CommitSha.assertDecode(value);
  } catch {
    throw new HttpError(400, "invalid_request", `Webhook payload field ${fieldName} is invalid.`);
  }
};

export const decodeBranchFromRef = (ref: string | null): BranchNameValue | null => {
  if (ref === null) {
    return null;
  }

  if (!ref.startsWith("refs/heads/")) {
    return null;
  }

  const branch = ref.slice("refs/heads/".length);
  try {
    return BranchName.assertDecode(branch);
  } catch {
    throw new HttpError(400, "invalid_request", "Webhook branch ref is invalid.");
  }
};

const normalizePushStylePayload = (input: {
  provider: Extract<WebhookProviderValue, "github" | "gitea">;
  payload: ParsedJsonObject;
  eventName: string;
  resolveRepositoryUrl: (repository: ParsedJsonObject) => string;
}): WebhookTriggerPayload => {
  const repository = requireRecord(input.payload.repository, "repository");
  const isPush = input.eventName === "push";
  const isPing = input.eventName === "ping";
  const ref = input.payload.ref === undefined ? null : requireString(input.payload.ref, "ref");

  return {
    provider: input.provider,
    deliveryId: "",
    eventKind: isPing ? "ping" : isPush ? "push" : "other",
    eventName: input.eventName,
    repoUrl: input.resolveRepositoryUrl(repository),
    ref,
    branch: decodeBranchFromRef(ref),
    commitSha: isPush ? decodeCommitSha(input.payload.after, "after") : null,
    beforeSha: isPush ? decodeCommitSha(input.payload.before, "before") : null,
  };
};

const normalizeGitHubPayload = (payload: ParsedJsonObject, eventName: string): WebhookTriggerPayload =>
  normalizePushStylePayload({
    provider: "github",
    payload,
    eventName,
    resolveRepositoryUrl: (repository) => {
      const fullName = requireString(repository.full_name, "repository.full_name");
      return normalizeRepositoryUrl(`https://github.com/${fullName}`);
    },
  });

const normalizeGitLabPayload = (payload: ParsedJsonObject, eventName: string): WebhookTriggerPayload => {
  const project = requireRecord(payload.project, "project");
  const repository = payload.repository === undefined ? null : requireRecord(payload.repository, "repository");
  const repoUrlValue =
    project.git_http_url ?? project.http_url ?? (repository === null ? undefined : repository.git_http_url);
  const repoUrl = normalizeRepositoryUrl(requireString(repoUrlValue, "project.git_http_url"));
  const ref = payload.ref === undefined ? null : requireString(payload.ref, "ref");
  const objectKind = payload.object_kind === undefined ? null : requireString(payload.object_kind, "object_kind");
  const payloadEventName = payload.event_name === undefined ? null : requireString(payload.event_name, "event_name");
  // GitLab system hooks and test-system-hook payloads are not push or ping
  // events in v1, so they stay in the generic non-push bucket.
  const isPush = eventName === "Push Hook" && objectKind === "push" && payloadEventName === "push";
  const commitSha = isPush ? decodeCommitSha(payload.checkout_sha ?? payload.after, "checkout_sha") : null;

  return {
    provider: "gitlab",
    deliveryId: "",
    eventKind: isPush ? "push" : "other",
    eventName,
    repoUrl,
    ref,
    branch: decodeBranchFromRef(ref),
    commitSha,
    beforeSha: isPush ? decodeCommitSha(payload.before, "before") : null,
  };
};

const normalizeGiteaPayload = (payload: ParsedJsonObject, eventName: string): WebhookTriggerPayload =>
  normalizePushStylePayload({
    provider: "gitea",
    payload,
    eventName,
    resolveRepositoryUrl: (repository) =>
      normalizeRepositoryUrl(requireString(repository.clone_url, "repository.clone_url")),
  });

export const webhookPayloadNormalizers = {
  github: normalizeGitHubPayload,
  gitlab: normalizeGitLabPayload,
  gitea: normalizeGiteaPayload,
} as const satisfies Record<
  WebhookProviderValue,
  (payload: ParsedJsonObject, eventName: string) => WebhookTriggerPayload
>;

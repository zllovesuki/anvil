import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

const DURABLE_ENTITY_ID_PATTERN = /^(usr|prj|run|inv|whk)_[0-9A-Za-z]{22}$/u;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/u;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/u;
const COMMIT_SHA_PATTERN = /^[A-Fa-f0-9]{7,64}$/u;

const brandedString = <Name extends string>(name: Name, predicate: (value: string) => boolean) =>
  eg.brand(name, eg.string, predicate);

const isIsoDateTime = (value: string): boolean =>
  ISO_DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

const isNonEmptyString = (value: string): boolean => value.length > 0;

export const EntityId = brandedString("DurableEntityId", (value) => DURABLE_ENTITY_ID_PATTERN.test(value));
export type EntityId = TypeFromCodec<typeof EntityId>;

export const OpaqueId = brandedString("OpaqueId", isNonEmptyString);
export type OpaqueId = TypeFromCodec<typeof OpaqueId>;

export const UserId = brandedString("UserId", (value) => /^usr_[0-9A-Za-z]{22}$/u.test(value));
export type UserId = TypeFromCodec<typeof UserId>;

export const ProjectId = brandedString("ProjectId", (value) => /^prj_[0-9A-Za-z]{22}$/u.test(value));
export type ProjectId = TypeFromCodec<typeof ProjectId>;

export const RunId = brandedString("RunId", (value) => /^run_[0-9A-Za-z]{22}$/u.test(value));
export type RunId = TypeFromCodec<typeof RunId>;

export const InviteId = brandedString("InviteId", (value) => /^inv_[0-9A-Za-z]{22}$/u.test(value));
export type InviteId = TypeFromCodec<typeof InviteId>;

export const WebhookId = brandedString("WebhookId", (value) => /^whk_[0-9A-Za-z]{22}$/u.test(value));
export type WebhookId = TypeFromCodec<typeof WebhookId>;

export const SessionId = brandedString("SessionId", (value) => SESSION_TOKEN_PATTERN.test(value));
export type SessionId = TypeFromCodec<typeof SessionId>;

export const IsoDateTime = brandedString("IsoDateTime", isIsoDateTime);
export type IsoDateTime = TypeFromCodec<typeof IsoDateTime>;

export const UnixTimestampMs = eg.brand("UnixTimestampMs", eg.number, (value) => Number.isInteger(value) && value >= 0);
export type UnixTimestampMs = TypeFromCodec<typeof UnixTimestampMs>;

export const OwnerSlug = brandedString("OwnerSlug", (value) => SLUG_PATTERN.test(value));
export type OwnerSlug = TypeFromCodec<typeof OwnerSlug>;

export const ProjectSlug = brandedString("ProjectSlug", (value) => SLUG_PATTERN.test(value));
export type ProjectSlug = TypeFromCodec<typeof ProjectSlug>;

export const BranchName = brandedString("BranchName", isNonEmptyString);
export type BranchName = TypeFromCodec<typeof BranchName>;

export const CommitSha = brandedString("CommitSha", (value) => COMMIT_SHA_PATTERN.test(value));
export type CommitSha = TypeFromCodec<typeof CommitSha>;

export const TriggerType = eg.union([eg.literal("manual"), eg.literal("webhook")]);
export type TriggerType = TypeFromCodec<typeof TriggerType>;

export const RunStatus = eg.union([
  eg.literal("queued"),
  eg.literal("starting"),
  eg.literal("running"),
  eg.literal("cancel_requested"),
  eg.literal("canceling"),
  eg.literal("passed"),
  eg.literal("failed"),
  eg.literal("canceled"),
]);
export type RunStatus = TypeFromCodec<typeof RunStatus>;

export const isRunStatus = (value: unknown): value is RunStatus => RunStatus.is(value);

export const toRunStatusOrNull = (value: string | undefined): RunStatus | null =>
  value && isRunStatus(value) ? value : null;

export const WebhookProvider = eg.union([eg.literal("github"), eg.literal("gitlab"), eg.literal("gitea")]);
export type WebhookProvider = TypeFromCodec<typeof WebhookProvider>;

export const UserSummary = eg.exactStrict(
  eg.object({
    id: UserId,
    slug: OwnerSlug,
    email: eg.string,
    displayName: eg.string,
    createdAt: IsoDateTime,
    disabledAt: eg.union([IsoDateTime, eg.null]),
  }),
);
export type UserSummary = TypeFromCodec<typeof UserSummary>;

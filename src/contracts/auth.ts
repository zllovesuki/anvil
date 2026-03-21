import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import { InviteId, IsoDateTime, OwnerSlug, SessionId, UserSummary } from "@/contracts/common";

export const MIN_PASSWORD_LENGTH = 8;
export const MIN_INVITE_TTL_HOURS = 1;
export const MAX_INVITE_TTL_HOURS = 24 * 30;

export const InviteTtlSeconds = eg.brand(
  "InviteTtlSeconds",
  eg.number,
  (value) => Number.isInteger(value) && value > 0,
);
export type InviteTtlSeconds = TypeFromCodec<typeof InviteTtlSeconds>;

export const LoginRequest = eg.exactStrict(
  eg.object({
    email: eg.string,
    password: eg.string,
  }),
);
export type LoginRequest = TypeFromCodec<typeof LoginRequest>;

export const LoginResponse = eg.exactStrict(
  eg.object({
    sessionId: SessionId,
    expiresAt: IsoDateTime,
    user: UserSummary,
    inviteTtlSeconds: InviteTtlSeconds,
  }),
);
export type LoginResponse = TypeFromCodec<typeof LoginResponse>;

export const GetMeResponse = eg.exactStrict(
  eg.object({
    user: UserSummary,
    inviteTtlSeconds: InviteTtlSeconds,
  }),
);
export type GetMeResponse = TypeFromCodec<typeof GetMeResponse>;

export const AcceptInviteRequest = eg.exactStrict(
  eg.object({
    token: eg.string,
    email: eg.string,
    displayName: eg.string,
    slug: OwnerSlug,
    password: eg.string,
  }),
);
export type AcceptInviteRequest = TypeFromCodec<typeof AcceptInviteRequest>;

export const CreateInviteRequest = eg.exactStrict(
  eg.object({
    expiresInHours: eg.number.optional,
  }),
);
export type CreateInviteRequest = TypeFromCodec<typeof CreateInviteRequest>;

export const CreateInviteResponse = eg.exactStrict(
  eg.object({
    inviteId: InviteId,
    token: eg.string,
    expiresAt: IsoDateTime,
    createdAt: IsoDateTime,
  }),
);
export type CreateInviteResponse = TypeFromCodec<typeof CreateInviteResponse>;

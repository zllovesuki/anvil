import { CreateInviteRequest, MAX_INVITE_TTL_HOURS, MIN_INVITE_TTL_HOURS } from "@/contracts";
import type { AppContext } from "@/worker/hono";
import { insertInvite } from "@/worker/db/d1/repositories";
import { HttpError, parseJson } from "@/worker/http";
import { serializeInvite } from "@/worker/presentation/serializers";
import { createLogger, generateDurableEntityId, generateOpaqueToken, hashSha256 } from "@/worker/services";
import { getConfig } from "@/worker/config";

const logger = createLogger("worker.invites");

export const handleCreateInvite = async (c: AppContext): Promise<Response> => {
  const user = c.get("user");
  const db = c.get("db");
  const payload = await parseJson(c.req.raw, CreateInviteRequest);
  const now = Date.now();
  const defaultHours = getConfig(c.env).inviteTtlSeconds / 60 / 60;
  const requestedHours = payload.expiresInHours ?? defaultHours;

  if (requestedHours < MIN_INVITE_TTL_HOURS || requestedHours > MAX_INVITE_TTL_HOURS) {
    throw new HttpError(
      400,
      "invalid_invite_ttl",
      `expiresInHours must be between ${MIN_INVITE_TTL_HOURS} and ${MAX_INVITE_TTL_HOURS}.`,
    );
  }

  const token = generateOpaqueToken(Number(c.env.INVITE_TOKEN_BYTES));
  const tokenHash = await hashSha256(token);
  const invite = {
    id: generateDurableEntityId("inv", now),
    createdByUserId: user.id,
    tokenHash,
    expiresAt: now + requestedHours * 60 * 60 * 1000,
    acceptedByUserId: null,
    acceptedAt: null,
    createdAt: now,
  };

  await insertInvite(db, invite);
  logger.info("invite_created", { inviteId: invite.id, userId: user.id });

  return c.json(serializeInvite(invite, token), 201);
};

import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import { IsoDateTime, UserId } from "@/contracts";
import { generateOpaqueToken } from "@/worker/services";

const SessionRecord = eg.exactStrict(
  eg.object({
    userId: UserId,
    issuedAt: IsoDateTime,
    expiresAt: IsoDateTime,
    version: eg.number,
  }),
);

export type SessionRecord = TypeFromCodec<typeof SessionRecord>;

const sessionKey = (sessionId: string) => `sess:${sessionId}`;

export const createSession = async (
  env: Env,
  userId: string,
  now = new Date(),
): Promise<{ sessionId: string; record: SessionRecord }> => {
  const ttlSeconds = Number(env.AUTH_SESSION_TTL_SECONDS);
  const sessionId = generateOpaqueToken(32);
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const record = SessionRecord.assertDecode({
    userId,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    version: Number(env.SESSION_VERSION),
  });

  await env.SESSIONS.put(sessionKey(sessionId), JSON.stringify(record), {
    expirationTtl: ttlSeconds,
  });

  return { sessionId, record };
};

export const readSession = async (env: Env, sessionId: string): Promise<SessionRecord | null> => {
  const rawValue = await env.SESSIONS.get(sessionKey(sessionId));

  if (!rawValue) {
    return null;
  }

  let record: SessionRecord;

  try {
    record = SessionRecord.assertDecode(JSON.parse(rawValue) as unknown);
  } catch {
    await env.SESSIONS.delete(sessionKey(sessionId));
    return null;
  }

  const expiresAtMs = Date.parse(record.expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    await env.SESSIONS.delete(sessionKey(sessionId));
    return null;
  }

  return record;
};

export const maybeRefreshSession = async (
  env: Env,
  sessionId: string,
  record: SessionRecord,
  now = new Date(),
): Promise<SessionRecord> => {
  const refreshThresholdMs = Number(env.AUTH_SESSION_REFRESH_THRESHOLD_SECONDS) * 1000;
  const expiresAtMs = Date.parse(record.expiresAt);

  if (Number.isNaN(expiresAtMs)) {
    throw new Error("Session record has an invalid expiresAt timestamp.");
  }

  const remainingMs = expiresAtMs - now.getTime();

  if (remainingMs >= refreshThresholdMs) {
    return record;
  }

  const ttlSeconds = Number(env.AUTH_SESSION_TTL_SECONDS);
  const refreshedRecord = SessionRecord.assertDecode({
    userId: record.userId,
    issuedAt: record.issuedAt,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    version: record.version + 1,
  });

  await env.SESSIONS.put(sessionKey(sessionId), JSON.stringify(refreshedRecord), {
    expirationTtl: ttlSeconds,
  });

  return refreshedRecord;
};

export const deleteSession = async (env: Env, sessionId: string): Promise<void> => {
  await env.SESSIONS.delete(sessionKey(sessionId));
};

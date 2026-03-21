export interface AppConfig {
  authSessionTtlSeconds: number;
  authSessionRefreshThresholdSeconds: number;
  inviteTtlSeconds: number;
  inviteTokenBytes: number;
  sessionVersion: number;
  passwordPbkdf2Digest: string;
  passwordPbkdf2Iterations: number;
  appEncryptionKeyCurrentVersion: number;
  appEncryptionKeysJson: string;
}

export const getConfig = (env: Env): AppConfig => ({
  authSessionTtlSeconds: Number(env.AUTH_SESSION_TTL_SECONDS),
  authSessionRefreshThresholdSeconds: Number(env.AUTH_SESSION_REFRESH_THRESHOLD_SECONDS),
  inviteTtlSeconds: Number(env.INVITE_TTL_SECONDS),
  inviteTokenBytes: Number(env.INVITE_TOKEN_BYTES),
  sessionVersion: Number(env.SESSION_VERSION),
  passwordPbkdf2Digest: env.PASSWORD_PBKDF2_DIGEST,
  passwordPbkdf2Iterations: Number(env.PASSWORD_PBKDF2_ITERATIONS),
  appEncryptionKeyCurrentVersion: Number(env.APP_ENCRYPTION_KEY_CURRENT_VERSION),
  appEncryptionKeysJson: env.APP_ENCRYPTION_KEYS_JSON,
});

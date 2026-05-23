export interface AppConfig {
  authSessionTtlSeconds: number;
  authSessionRefreshThresholdSeconds: number;
  sessionVersion: number;
  appEncryptionKeyCurrentVersion: number;
  appEncryptionKeysJson: string;
}

export const getConfig = (env: Env): AppConfig => ({
  authSessionTtlSeconds: Number(env.AUTH_SESSION_TTL_SECONDS),
  authSessionRefreshThresholdSeconds: Number(env.AUTH_SESSION_REFRESH_THRESHOLD_SECONDS),
  sessionVersion: Number(env.SESSION_VERSION),
  appEncryptionKeyCurrentVersion: Number(env.APP_ENCRYPTION_KEY_CURRENT_VERSION),
  appEncryptionKeysJson: env.APP_ENCRYPTION_KEYS_JSON,
});

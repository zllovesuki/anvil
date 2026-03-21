export type AuthMode = "mock" | "live";

const AUTH_MODE_KEY = "anvil.auth.mode";
const SESSION_ID_KEY = "anvil.auth.session-id";
const D1_BOOKMARK_KEY = "anvil.d1.bookmark";
const LOCALHOST_AUTH_MODE_HOSTS = new Set(["127.0.0.1", "localhost"]);

const canUseStorage = (): boolean => typeof window !== "undefined";
const getWindowHostname = (): string | null => (typeof window === "undefined" ? null : window.location.hostname);

export const canUseMockAuthMode = (hostname: string | null): boolean =>
  hostname !== null && LOCALHOST_AUTH_MODE_HOSTS.has(hostname);

export const resolveAuthModeForHost = (hostname: string | null, storedMode: AuthMode): AuthMode =>
  canUseMockAuthMode(hostname) ? storedMode : "live";

export const readStoredString = (key: string): string | null => {
  if (!canUseStorage()) {
    return null;
  }

  return window.localStorage.getItem(key);
};

export const writeStoredString = (key: string, value: string): void => {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(key, value);
};

export const removeStoredString = (key: string): void => {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(key);
};

export const getStoredAuthMode = (): AuthMode => {
  const value = readStoredString(AUTH_MODE_KEY);
  return value === "live" ? "live" : "mock";
};

export const getEffectiveAuthMode = (): AuthMode => resolveAuthModeForHost(getWindowHostname(), getStoredAuthMode());

export const isMockAuthModeSelectable = (): boolean => canUseMockAuthMode(getWindowHostname());

export const setStoredAuthMode = (mode: AuthMode): void => {
  writeStoredString(AUTH_MODE_KEY, mode);
};

export const getStoredSessionId = (): string | null => readStoredString(SESSION_ID_KEY);

export const setStoredSessionId = (sessionId: string): void => {
  writeStoredString(SESSION_ID_KEY, sessionId);
};

export const clearStoredSessionId = (): void => {
  removeStoredString(SESSION_ID_KEY);
};

export const getStoredBookmark = (): string | null => readStoredString(D1_BOOKMARK_KEY);

export const setStoredBookmark = (bookmark: string): void => {
  writeStoredString(D1_BOOKMARK_KEY, bookmark);
};

export const clearStoredBookmark = (): void => {
  removeStoredString(D1_BOOKMARK_KEY);
};

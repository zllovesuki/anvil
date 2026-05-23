const D1_BOOKMARK_KEY = "anvil.d1.bookmark";

const canUseStorage = (): boolean => typeof window !== "undefined";

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

export const getStoredBookmark = (): string | null => readStoredString(D1_BOOKMARK_KEY);

export const setStoredBookmark = (bookmark: string): void => {
  writeStoredString(D1_BOOKMARK_KEY, bookmark);
};

export const clearStoredBookmark = (): void => {
  removeStoredString(D1_BOOKMARK_KEY);
};

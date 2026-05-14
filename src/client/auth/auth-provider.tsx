import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import type { LoginRequest, UserSummary } from "@/contracts";
import { ApiError } from "@/client/lib/api-contract";
import { getApiClient } from "@/client/lib/api";
import { SESSION_EXPIRED_EVENT } from "@/client/lib/live-api-request";
import {
  type AuthMode,
  clearStoredBookmark,
  clearStoredSessionId,
  getEffectiveAuthMode,
  getStoredAuthMode,
  getStoredSessionId,
  isMockAuthModeSelectable,
  setStoredAuthMode,
  setStoredSessionId,
} from "@/client/lib/storage";
import { useToast } from "@/client/toast";
import { AuthContext, type AuthContextValue, type StartupErrorState } from "@/client/auth/auth-context";

const clearClientAuthState = (): void => {
  clearStoredSessionId();
  clearStoredBookmark();
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const { pushToast } = useToast();
  const [mode, setModeState] = useState<AuthMode>(() => getEffectiveAuthMode());
  const [user, setUser] = useState<UserSummary | null>(null);
  const [inviteTtlSeconds, setInviteTtlSeconds] = useState<number | null>(null);
  const [startupError, setStartupError] = useState<StartupErrorState | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const canSelectMode = isMockAuthModeSelectable();
  const handleSessionExpired = useEffectEvent(() => {
    if (user === null) return;
    clearClientAuthState();
    setUser(null);
    setInviteTtlSeconds(null);
    pushToast({
      tone: "error",
      title: "Session expired",
      message: "Your session was invalidated. Please sign in again.",
    });
  });

  useEffect(() => {
    const storedMode = getStoredAuthMode();
    if (storedMode === mode) {
      return;
    }

    setStoredAuthMode(mode);
    clearClientAuthState();
  }, [mode]);

  useEffect(() => {
    let canceled = false;

    const hydrateSession = async () => {
      setStartupError(null);

      if (mode === "live") {
        try {
          await getApiClient(mode).getAppConfig();
        } catch (error) {
          if (error instanceof ApiError && error.code === "encryption_not_configured") {
            if (!canceled) {
              setUser(null);
              setInviteTtlSeconds(null);
              setStartupError({
                code: error.code,
                message: error.message,
              });
              setIsInitializing(false);
            }
            return;
          }
        }
      }

      const sessionId = getStoredSessionId();
      if (!sessionId) {
        if (!canceled) {
          setUser(null);
          setIsInitializing(false);
        }
        return;
      }

      try {
        const response = await getApiClient(mode).getMe();
        if (!canceled) {
          setUser(response.user);
          setInviteTtlSeconds(response.inviteTtlSeconds);
        }
      } catch {
        clearClientAuthState();
        if (!canceled) {
          setUser(null);
          setInviteTtlSeconds(null);
        }
      } finally {
        if (!canceled) {
          setIsInitializing(false);
        }
      }
    };

    void hydrateSession();

    return () => {
      canceled = true;
    };
  }, [mode]);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const signIn = async (payload: LoginRequest): Promise<void> => {
    const response = await getApiClient(mode).login(payload);
    setStoredSessionId(response.sessionId);
    setUser(response.user);
    setInviteTtlSeconds(response.inviteTtlSeconds);
    pushToast({
      tone: "success",
      title: "Signed in",
      message: `Session ready for ${response.user.displayName}.`,
    });
  };

  const signOut = async (): Promise<void> => {
    try {
      await getApiClient(mode).logout();
    } finally {
      clearClientAuthState();
      setUser(null);
      setInviteTtlSeconds(null);
      pushToast({
        tone: "info",
        title: "Signed out",
        message: "Local auth state was cleared from this browser.",
      });
    }
  };

  const loginDirect = (sessionId: string, directUser: UserSummary, nextInviteTtlSeconds: number): void => {
    setStoredSessionId(sessionId);
    setUser(directUser);
    setInviteTtlSeconds(nextInviteTtlSeconds);
  };

  const setMode = (nextMode: AuthMode): void => {
    const resolvedMode = canSelectMode ? nextMode : "live";
    if (resolvedMode === mode) {
      return;
    }

    setStoredAuthMode(resolvedMode);
    clearClientAuthState();
    setUser(null);
    setInviteTtlSeconds(null);
    setStartupError(null);
    setIsInitializing(true);
    setModeState(resolvedMode);
    pushToast({
      tone: "info",
      title: `Transport switched to ${resolvedMode}`,
      message: "Session and D1 bookmark state were reset for the new mode.",
    });
  };

  const value: AuthContextValue = {
    mode,
    canSelectMode,
    user,
    inviteTtlSeconds,
    startupError,
    isAuthenticated: user !== null,
    isInitializing,
    signIn,
    signOut,
    setMode,
    loginDirect,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

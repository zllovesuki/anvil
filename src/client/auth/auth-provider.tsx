import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import type { UserSummary } from "@/contracts";
import { ApiError } from "@/client/lib/api-contract";
import { getApiClient } from "@/client/lib/api";
import { SESSION_EXPIRED_EVENT } from "@/client/lib/live-api-request";
import { clearStoredBookmark } from "@/client/lib/storage";
import { useToast } from "@/client/toast";
import { AuthContext, type AuthContextValue, type StartupErrorState } from "@/client/auth/auth-context";

const clearClientAuthState = (): void => {
  clearStoredBookmark();
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const { pushToast } = useToast();
  const [user, setUser] = useState<UserSummary | null>(null);
  const [startupError, setStartupError] = useState<StartupErrorState | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const handleSessionExpired = useEffectEvent(() => {
    if (user === null) return;
    clearClientAuthState();
    setUser(null);
    pushToast({
      tone: "error",
      title: "Session expired",
      message: "Your session was invalidated. Please sign in again.",
    });
  });

  useEffect(() => {
    let canceled = false;

    const hydrateSession = async () => {
      setStartupError(null);

      try {
        await getApiClient().getAppConfig();
      } catch (error) {
        if (error instanceof ApiError && error.code === "encryption_not_configured") {
          if (!canceled) {
            setUser(null);
            setStartupError({
              code: error.code,
              message: error.message,
            });
            setIsInitializing(false);
          }
          return;
        }
      }

      try {
        const response = await getApiClient().getMe();
        if (!canceled) {
          setUser(response.user);
        }
      } catch (error) {
        clearClientAuthState();
        if (!canceled) {
          setUser(null);
          if (error instanceof ApiError && error.status !== 403 && error.code !== "invalid_session") {
            setStartupError({
              code: error.code,
              message: error.message,
            });
          }
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
  }, []);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const signOut = async (): Promise<void> => {
    try {
      await getApiClient().logout();
    } finally {
      clearClientAuthState();
      setUser(null);
      pushToast({
        tone: "info",
        title: "Signed out",
        message: "Your browser session was cleared.",
      });
    }
  };

  const value: AuthContextValue = {
    user,
    startupError,
    isAuthenticated: user !== null,
    isInitializing,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

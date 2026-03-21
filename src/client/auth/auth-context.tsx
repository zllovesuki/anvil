import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { LoginRequest, UserSummary } from "@/contracts";
import {
  type AuthMode,
  clearStoredBookmark,
  clearStoredSessionId,
  getEffectiveAuthMode,
  getApiClient,
  getStoredAuthMode,
  getStoredSessionId,
  isMockAuthModeSelectable,
  setStoredAuthMode,
  setStoredSessionId,
} from "@/client/lib";
import { useToast } from "@/client/toast";
import { SESSION_EXPIRED_EVENT } from "@/client/lib/live-api-request";

interface AuthContextValue {
  mode: AuthMode;
  canSelectMode: boolean;
  user: UserSummary | null;
  inviteTtlSeconds: number | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  signIn(payload: LoginRequest): Promise<void>;
  signOut(): Promise<void>;
  setMode(mode: AuthMode): void;
  loginDirect(sessionId: string, user: UserSummary, inviteTtlSeconds: number): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const clearClientAuthState = (): void => {
  clearStoredSessionId();
  clearStoredBookmark();
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const { pushToast } = useToast();
  const [mode, setModeState] = useState<AuthMode>(() => getEffectiveAuthMode());
  const [user, setUser] = useState<UserSummary | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  const [inviteTtlSeconds, setInviteTtlSeconds] = useState<number | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const canSelectMode = isMockAuthModeSelectable();

  useEffect(() => {
    const storedMode = getStoredAuthMode();
    if (storedMode === mode) {
      return;
    }

    setStoredAuthMode(mode);
    clearClientAuthState();
    setUser(null);
    setInviteTtlSeconds(null);
  }, [mode]);

  useEffect(() => {
    let canceled = false;

    const hydrateSession = async () => {
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

    setIsInitializing(true);
    void hydrateSession();

    return () => {
      canceled = true;
    };
  }, [mode]);

  useEffect(() => {
    const handleSessionExpired = () => {
      if (userRef.current === null) return;
      clearClientAuthState();
      setUser(null);
      setInviteTtlSeconds(null);
      pushToast({
        tone: "error",
        title: "Session expired",
        message: "Your session was invalidated. Please sign in again.",
      });
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [pushToast]);

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
    setModeState(resolvedMode);
    pushToast({
      tone: "info",
      title: `Transport switched to ${resolvedMode}`,
      message: "Session and D1 bookmark state were reset for the new mode.",
    });
  };

  return (
    <AuthContext.Provider
      value={{
        mode,
        canSelectMode,
        user,
        inviteTtlSeconds,
        isAuthenticated: user !== null,
        isInitializing,
        signIn,
        signOut,
        setMode,
        loginDirect,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return value;
};

import { createContext } from "react";
import type { LoginRequest, UserSummary } from "@/contracts";
import type { AuthMode } from "@/client/lib";

export interface StartupErrorState {
  code: string;
  message: string;
}

export interface AuthContextValue {
  mode: AuthMode;
  canSelectMode: boolean;
  user: UserSummary | null;
  inviteTtlSeconds: number | null;
  startupError: StartupErrorState | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  signIn(payload: LoginRequest): Promise<void>;
  signOut(): Promise<void>;
  setMode(mode: AuthMode): void;
  loginDirect(sessionId: string, user: UserSummary, inviteTtlSeconds: number): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

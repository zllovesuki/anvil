import { createContext } from "react";
import type { UserSummary } from "@/contracts";

export interface StartupErrorState {
  code: string;
  message: string;
}

export interface AuthContextValue {
  user: UserSummary | null;
  startupError: StartupErrorState | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

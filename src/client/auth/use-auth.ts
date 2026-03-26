import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "@/client/auth/auth-context";

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return value;
};

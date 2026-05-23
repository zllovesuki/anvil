import { LogIn } from "lucide-react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { Button, Card, ErrorBanner, PageHeader } from "@/client/components/ui";

const DEFAULT_RETURN_TO = "/app/projects";

const oidcErrorMessages: Record<string, string> = {
  identity_conflict:
    "tessera returned an identity that cannot be safely linked to an anvil account. Ask an operator to review the account binding.",
  oidc_provider_error: "tessera could not complete sign-in. Try again or ask an operator to check the OIDC provider.",
  oidc_session_expired: "The sign-in session expired. Start a new tessera sign-in.",
  oidc_unverified_email: "tessera did not return a verified email address for this account.",
  tessera_email_conflict:
    "tessera returned an email address already assigned to another anvil account. Ask an operator to resolve the conflict.",
  user_disabled: "This anvil account is disabled.",
};

const sanitizeReturnTo = (value: string | null): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/api/")) {
    return DEFAULT_RETURN_TO;
  }

  return value === "/app/login" || value.startsWith("/app/login?") ? DEFAULT_RETURN_TO : value;
};

const getOidcErrorMessage = (code: string | null): string | null => {
  if (!code) return null;
  return oidcErrorMessages[code] ?? "Sign-in could not be completed. Start a new tessera sign-in.";
};

export const LoginPage = () => {
  const { isAuthenticated, isInitializing } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = location.state as { returnTo?: unknown } | null;
  const stateReturnTo = typeof state?.returnTo === "string" ? state.returnTo : null;
  const returnTo = sanitizeReturnTo(searchParams.get("return_to") ?? stateReturnTo);
  const errorMessage = getOidcErrorMessage(searchParams.get("error"));

  if (!isInitializing && isAuthenticated) {
    return <Navigate to={returnTo} replace />;
  }

  const startOidc = () => {
    window.location.assign(`/api/public/oidc/start?return_to=${encodeURIComponent(returnTo)}`);
  };

  return (
    <div className="mx-auto max-w-3xl animate-slide-up space-y-6">
      <PageHeader title="Sign in" description="Use your tessera account to open an anvil session." />

      <Card>
        <div className="space-y-5">
          {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

          <div>
            <Button
              variant="primary"
              type="button"
              disabled={isInitializing}
              icon={<LogIn className="h-4 w-4" aria-hidden="true" />}
              onClick={startOidc}
            >
              Sign in with tessera
            </Button>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              You will be redirected to tessera and returned here after OIDC verification.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

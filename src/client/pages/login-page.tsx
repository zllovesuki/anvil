import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { TurnstileChallenge } from "@/client/components";
import { Button, Card, ErrorBanner, Input, PageHeader } from "@/client/components/ui";
import { type AuthMode, formatApiError } from "@/client/lib";
import { MOCK_DEMO_EMAIL, MOCK_DEMO_PASSWORD } from "@/client/lib/mock";

const MOCK_TURNSTILE_TOKEN = "mock-turnstile-token";

interface LoginFormProps {
  canSelectMode: boolean;
  isInitializing: boolean;
  mode: AuthMode;
  signIn: ReturnType<typeof useAuth>["signIn"];
}

const LoginForm = ({ canSelectMode, isInitializing, mode, signIn }: LoginFormProps) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => (mode === "mock" ? MOCK_DEMO_EMAIL : ""));
  const [password, setPassword] = useState(() => (mode === "mock" ? MOCK_DEMO_PASSWORD : ""));
  const [turnstileState, setTurnstileState] = useState<{ mode: AuthMode; token: string | null }>({
    mode,
    token: null,
  });
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const turnstileToken = turnstileState.mode === mode ? turnstileState.token : null;
  const isTurnstileBlocked = mode === "live" && !turnstileToken;

  return (
    <div className="mx-auto max-w-3xl animate-slide-up space-y-6">
      <PageHeader
        title="Sign in"
        description={
          !canSelectMode
            ? "Use an invited account provisioned in D1."
            : mode === "mock"
              ? "Mock mode — use the prefilled demo account to open the seeded local workspace."
              : "Live mode — use an invited account provisioned in D1."
        }
      />

      <Card>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const nextTurnstileToken = mode === "mock" ? MOCK_TURNSTILE_TOKEN : turnstileToken;

            if (!nextTurnstileToken) {
              setError("Human verification failed. Please try again.");
              return;
            }

            setSubmitting(true);
            setError(null);

            void signIn({ email, password, turnstileToken: nextTurnstileToken })
              .then(() => {
                navigate("/app/projects", { replace: true });
              })
              .catch((reason: unknown) => {
                setError(formatApiError(reason));
                if (mode === "live") {
                  setTurnstileState({ mode, token: null });
                  setTurnstileResetKey((current) => current + 1);
                }
              })
              .finally(() => {
                setSubmitting(false);
              });
          }}
        >
          <Input
            label="Email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />

          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
          />

          {mode === "live" ? (
            <TurnstileChallenge
              action="login"
              onTokenChange={(token) => setTurnstileState({ mode, token })}
              resetKey={turnstileResetKey}
            />
          ) : null}

          {error ? <ErrorBanner message={error} /> : null}

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={submitting || isInitializing || isTurnstileBlocked}
              loading={submitting}
              icon={!submitting ? <ArrowRight className="h-4 w-4" /> : undefined}
            >
              Sign In
            </Button>
            <Link
              to="/app/invite/accept"
              className="text-xs font-medium text-accent-400 transition-colors hover:text-accent-300"
            >
              Have an invite token?
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
};

export const LoginPage = () => {
  const { canSelectMode, isAuthenticated, isInitializing, mode, signIn } = useAuth();

  if (!isInitializing && isAuthenticated) {
    return <Navigate to="/app/projects" replace />;
  }

  return (
    <LoginForm key={mode} canSelectMode={canSelectMode} isInitializing={isInitializing} mode={mode} signIn={signIn} />
  );
};

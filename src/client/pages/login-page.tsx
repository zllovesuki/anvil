import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { Button, Card, ErrorBanner, Input, PageHeader } from "@/client/components/ui";
import { formatApiError } from "@/client/lib";

const MOCK_MODE_EMAIL = "anvil@devbin.tools";
const MOCK_MODE_PASSWORD = "anvil-demo";

export const LoginPage = () => {
  const navigate = useNavigate();
  const { canSelectMode, isAuthenticated, isInitializing, mode, signIn } = useAuth();
  const [email, setEmail] = useState(() => (mode === "mock" ? MOCK_MODE_EMAIL : ""));
  const [password, setPassword] = useState(() => (mode === "mock" ? MOCK_MODE_PASSWORD : ""));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode === "mock") {
      setEmail(MOCK_MODE_EMAIL);
      setPassword(MOCK_MODE_PASSWORD);
      return;
    }

    setEmail("");
    setPassword("");
  }, [mode]);

  if (!isInitializing && isAuthenticated) {
    return <Navigate to="/app/projects" replace />;
  }

  return (
    <div className="mx-auto max-w-3xl animate-slide-up space-y-6">
      <PageHeader
        title="Sign in"
        description={
          !canSelectMode
            ? "Use an invited account provisioned in D1."
            : mode === "mock"
              ? "Mock mode — any non-empty credentials will seed a local workspace."
              : "Live mode — use an invited account provisioned in D1."
        }
      />

      <Card>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitting(true);
            setError(null);

            void signIn({ email, password })
              .then(() => {
                navigate("/app/projects", { replace: true });
              })
              .catch((reason: unknown) => {
                setError(formatApiError(reason));
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

          {error ? <ErrorBanner message={error} /> : null}

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={submitting || isInitializing}
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

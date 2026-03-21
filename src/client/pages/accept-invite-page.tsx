import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { MIN_PASSWORD_LENGTH } from "@/contracts";
import { useAuth } from "@/client/auth";
import { Button, Card, ErrorBanner, Input, PageHeader } from "@/client/components/ui";
import { buildProjectSlug, formatApiError, getApiClient } from "@/client/lib";
import { useToast } from "@/client/toast";

interface InviteFormState {
  token: string;
  email: string;
  displayName: string;
  slug: string;
  password: string;
  confirmPassword: string;
}

export const AcceptInvitePage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isInitializing, mode, loginDirect } = useAuth();
  const { pushToast } = useToast();

  const [form, setForm] = useState<InviteFormState>(() => ({
    token: searchParams.get("token") ?? "",
    email: "",
    displayName: "",
    slug: "",
    password: "",
    confirmPassword: "",
  }));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  if (!isInitializing && isAuthenticated) {
    return <Navigate to="/app/projects" replace />;
  }

  const updateField = (field: keyof InviteFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateDisplayName = (value: string) => {
    setForm((current) => {
      const next = { ...current, displayName: value };
      if (!slugTouched) {
        next.slug = buildProjectSlug(value);
      }
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-3xl animate-slide-up space-y-6">
      <PageHeader
        title="Accept invite"
        description="anvil is invite-only. Use the token from an existing operator to create your account."
      />

      <Card>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (form.password !== form.confirmPassword) {
              setError("Passwords do not match.");
              return;
            }

            if (form.password.length < MIN_PASSWORD_LENGTH) {
              setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
              return;
            }

            setSubmitting(true);
            setError(null);

            void getApiClient(mode)
              .acceptInvite({
                token: form.token,
                email: form.email,
                displayName: form.displayName,
                slug: form.slug,
                password: form.password,
              })
              .then((response) => {
                loginDirect(response.sessionId, response.user, response.inviteTtlSeconds);
                pushToast({
                  tone: "success",
                  title: "Signed in",
                  message: `Session ready for ${response.user.displayName}.`,
                });
                navigate("/app/projects", { replace: true });
              })
              .catch((reason: unknown) => {
                const message = formatApiError(reason);
                setError(message);
                pushToast({
                  tone: "error",
                  title: "Invite acceptance failed",
                  message,
                });
              })
              .finally(() => {
                setSubmitting(false);
              });
          }}
        >
          <Input
            label="Invite token"
            className="font-mono text-sm"
            value={form.token}
            onChange={(event) => updateField("token", event.target.value)}
            placeholder="Paste your invite token"
            helperText="The opaque token provided by an existing operator."
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => updateField("email", event.target.value)}
              placeholder="you@example.com"
              required
            />
            <Input
              label="Display name"
              value={form.displayName}
              onChange={(event) => updateDisplayName(event.target.value)}
              placeholder="Jane Operator"
              required
            />
          </div>

          <Input
            label="Operator slug"
            value={form.slug}
            onChange={(event) => {
              setSlugTouched(true);
              updateField("slug", buildProjectSlug(event.target.value));
            }}
            placeholder="jane"
            helperText="Alphanumeric, hyphens, and underscores only. This becomes your canonical owner slug."
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              required
            />
            <Input
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(event) => updateField("confirmPassword", event.target.value)}
              placeholder="Repeat your password"
              required
            />
          </div>

          {error ? <ErrorBanner message={error} /> : null}

          <div className="flex items-center justify-between gap-3 pt-2">
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={submitting || isInitializing}
              loading={submitting}
              icon={!submitting ? <ArrowRight className="h-4 w-4" /> : undefined}
            >
              Create Account
            </Button>
            <Link to="/app/login">
              <Button variant="ghost" size="sm">
                Already have an account?
              </Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
};

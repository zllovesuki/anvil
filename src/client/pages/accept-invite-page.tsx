import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { MIN_PASSWORD_LENGTH } from "@/contracts";
import { useAuth } from "@/client/auth";
import { TurnstileWidget } from "@/client/components";
import { Button, ButtonLink, Card, ErrorBanner, Input, PageHeader } from "@/client/components/ui";
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

const MOCK_TURNSTILE_TOKEN = "mock-turnstile-token";
const TURNSTILE_UNAVAILABLE_MESSAGE = "Human verification is temporarily unavailable.";

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
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(() =>
    mode === "mock" ? MOCK_TURNSTILE_TOKEN : null,
  );
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [turnstileConfigError, setTurnstileConfigError] = useState<string | null>(null);
  const [loadingTurnstileConfig, setLoadingTurnstileConfig] = useState(mode === "live");

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

  useEffect(() => {
    if (mode !== "live") {
      setTurnstileSiteKey(null);
      setTurnstileToken(MOCK_TURNSTILE_TOKEN);
      setTurnstileConfigError(null);
      setLoadingTurnstileConfig(false);
      return;
    }

    let canceled = false;

    setTurnstileSiteKey(null);
    setTurnstileToken(null);
    setTurnstileConfigError(null);
    setLoadingTurnstileConfig(true);

    void getApiClient(mode)
      .getAppConfig()
      .then((config) => {
        if (canceled) {
          return;
        }

        if (!config.turnstileSiteKey) {
          setTurnstileConfigError(TURNSTILE_UNAVAILABLE_MESSAGE);
          return;
        }

        setTurnstileSiteKey(config.turnstileSiteKey);
      })
      .catch((reason: unknown) => {
        if (canceled) {
          return;
        }

        setTurnstileConfigError(formatApiError(reason));
      })
      .finally(() => {
        if (!canceled) {
          setLoadingTurnstileConfig(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [mode]);

  const isTurnstileBlocked = mode === "live" && (loadingTurnstileConfig || !turnstileSiteKey || !turnstileToken);

  if (!isInitializing && isAuthenticated) {
    return <Navigate to="/app/projects" replace />;
  }

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
            const nextTurnstileToken = mode === "mock" ? MOCK_TURNSTILE_TOKEN : turnstileToken;

            if (form.password !== form.confirmPassword) {
              setError("Passwords do not match.");
              return;
            }

            if (form.password.length < MIN_PASSWORD_LENGTH) {
              setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
              return;
            }

            if (!nextTurnstileToken) {
              setError("Human verification failed. Please try again.");
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
                turnstileToken: nextTurnstileToken,
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
                if (mode === "live") {
                  setTurnstileToken(null);
                  setTurnstileResetKey((current) => current + 1);
                }
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

          {mode === "live" ? (
            loadingTurnstileConfig ? null : turnstileSiteKey ? (
              <TurnstileWidget
                action="accept_invite"
                onTokenChange={setTurnstileToken}
                resetKey={turnstileResetKey}
                siteKey={turnstileSiteKey}
              />
            ) : (
              <ErrorBanner message={turnstileConfigError ?? TURNSTILE_UNAVAILABLE_MESSAGE} />
            )
          ) : null}

          {error ? <ErrorBanner message={error} /> : null}

          <div className="flex items-center justify-between gap-3 pt-2">
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={submitting || isInitializing || isTurnstileBlocked}
              loading={submitting}
              icon={!submitting ? <ArrowRight className="h-4 w-4" /> : undefined}
            >
              Create Account
            </Button>
            <ButtonLink to="/app/login" variant="ghost" size="sm">
              Already have an account?
            </ButtonLink>
          </div>
        </form>
      </Card>
    </div>
  );
};

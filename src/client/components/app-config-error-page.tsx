import { AlertTriangle, RefreshCw } from "lucide-react";
import { useAuth } from "@/client/auth";
import { Button } from "@/client/components/ui";

export const AppConfigErrorPage = ({ message }: { message: string }) => {
  const { canSelectMode } = useAuth();

  return (
    <section
      aria-labelledby="app-config-error-title"
      className="mx-auto flex min-h-[60vh] max-w-2xl animate-slide-up flex-col items-center justify-center text-center"
    >
      <div className="mb-6 inline-flex rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300">
        <AlertTriangle className="h-10 w-10" aria-hidden="true" />
      </div>
      <h1 id="app-config-error-title" className="text-3xl font-semibold tracking-tight text-zinc-100">
        App encryption keys are not configured
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-300">{message}</p>
      <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400">
        Configure{" "}
        <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-200">APP_ENCRYPTION_KEY_CURRENT_VERSION</code> and{" "}
        <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-200">APP_ENCRYPTION_KEYS_JSON</code>, then reload
        the app.
      </p>
      {canSelectMode ? (
        <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
          On localhost, you can switch to mock mode from the header while the live worker configuration is being fixed.
        </p>
      ) : null}
      <Button
        variant="secondary"
        className="mt-8 inline-flex items-center gap-2"
        onClick={() => window.location.reload()}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Retry configuration check
      </Button>
    </section>
  );
};

import { Calendar, KeyRound, Mail, User } from "lucide-react";
import { useAuth } from "@/client/auth";
import { Button, Card, PageHeader } from "@/client/components/ui";
import { type AuthMode, formatTimestamp } from "@/client/lib";
const modeButtonClass = (active: boolean): string =>
  [
    "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
    active ? "bg-accent-500/15 text-accent-300" : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200",
  ].join(" ");
const ModeToggle = ({ currentMode, onChange }: { currentMode: AuthMode; onChange(mode: AuthMode): void }) => (
  <div className="inline-flex rounded-xl border border-zinc-800/70 bg-zinc-900/80 p-1">
    <button type="button" className={modeButtonClass(currentMode === "mock")} onClick={() => onChange("mock")}>
      Mock API
    </button>
    <button type="button" className={modeButtonClass(currentMode === "live")} onClick={() => onChange("live")}>
      Live API
    </button>
  </div>
);
export const ProfilePage = () => {
  const { user, canSelectMode, mode, setMode, signOut } = useAuth();
  if (!user) return null;
  return (
    <div className="animate-slide-up space-y-6">
      <PageHeader label="Account" title="Profile & Settings" />

      <div className={["grid gap-5", canSelectMode ? "lg:grid-cols-2" : null].filter(Boolean).join(" ")}>
        {/* User info card */}
        <Card>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-500/15 text-accent-400">
              <User className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-zinc-100">{user.displayName}</h2>
              <p className="mt-0.5 text-sm text-zinc-500">@{user.slug}</p>
            </div>
          </div>

          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex items-center gap-3 text-zinc-400">
              <Mail className="h-4 w-4 shrink-0 text-zinc-500" />
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">Email</dt>
                <dd className="mt-0.5 text-zinc-300">{user.email}</dd>
              </div>
            </div>
            <div className="flex items-center gap-3 text-zinc-400">
              <Calendar className="h-4 w-4 shrink-0 text-zinc-500" />
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">Member since</dt>
                <dd className="mt-0.5 text-zinc-300">{formatTimestamp(user.createdAt)}</dd>
              </div>
            </div>
          </dl>

          <div className="mt-6">
            <Button
              variant="danger"
              onClick={() => {
                void signOut();
              }}
            >
              Sign Out
            </Button>
          </div>
        </Card>

        {canSelectMode ? (
          <Card>
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-accent-500/10 p-2 text-accent-300">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-zinc-100">Developer Settings</h3>
                <p className="mt-1 text-sm text-zinc-500">API transport and session configuration.</p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-300">API Transport</p>
                <ModeToggle currentMode={mode} onChange={setMode} />
                <p className="mt-3 text-xs leading-5 text-zinc-500">
                  {mode === "mock"
                    ? "Mock mode uses browser localStorage for persistence. No backend required."
                    : "Live mode calls Worker routes directly with bearer session ID and D1 bookmark headers."}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Active transport</p>
                <p className="mt-1 text-sm font-medium text-zinc-200">{mode}</p>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
};

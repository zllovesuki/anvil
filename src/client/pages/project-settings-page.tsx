import type { DispatchMode, ProjectConfigSummary } from "@/contracts";
import { Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { LoadingPanel } from "@/client/components";
import { Badge, Breadcrumbs, Button, Card, ErrorBanner, Input, PageHeader } from "@/client/components/ui";
import { formatApiError, getApiClient, inferRepositoryProvider } from "@/client/lib";
import { useToast } from "@/client/toast";

interface SettingsFormState {
  name: string;
  repoUrl: string;
  defaultBranch: string;
  configPath: string;
  repoToken: string;
  dispatchMode: DispatchMode;
}

export const ProjectSettingsPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { canSelectMode, mode } = useAuth();
  const { pushToast } = useToast();

  const [project, setProject] = useState<ProjectConfigSummary | null>(null);
  const [form, setForm] = useState<SettingsFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requestIdRef = useRef(0);

  const loadProject = useCallback(async () => {
    if (!projectId) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);

    try {
      const detail = await getApiClient(mode).getProjectDetail(projectId);
      if (requestId !== requestIdRef.current) return;

      setProject(detail.project);
      setForm({
        name: detail.project.name,
        repoUrl: detail.project.repoUrl,
        defaultBranch: detail.project.defaultBranch,
        configPath: detail.project.configPath,
        repoToken: "",
        dispatchMode: detail.project.dispatchMode,
      });
    } catch (reason) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(formatApiError(reason));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [mode, projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const updateField = (field: keyof SettingsFormState, value: string) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || !form || !project || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    const payload: Record<string, string | null | undefined> = {};
    if (form.name !== project.name) payload.name = form.name;
    if (form.repoUrl !== project.repoUrl) payload.repoUrl = form.repoUrl;
    if (form.defaultBranch !== project.defaultBranch) payload.defaultBranch = form.defaultBranch;
    if (form.configPath !== project.configPath) payload.configPath = form.configPath;
    if (form.repoToken) payload.repoToken = form.repoToken;
    if (form.dispatchMode !== project.dispatchMode) payload.dispatchMode = form.dispatchMode;

    if (Object.keys(payload).length === 0) {
      pushToast({ tone: "success", title: "No changes", message: "Nothing to update." });
      setSubmitting(false);
      return;
    }

    void getApiClient(mode)
      .updateProject(projectId, payload)
      .then((response) => {
        pushToast({
          tone: "success",
          title: "Project updated",
          message: `${response.project.ownerSlug}/${response.project.projectSlug} settings saved.`,
        });
        navigate(`/app/projects/${projectId}`, { replace: true });
      })
      .catch((reason: unknown) => {
        const message = formatApiError(reason);
        setSubmitError(message);
        pushToast({ tone: "error", title: "Update failed", message });
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  if (loading) {
    return <LoadingPanel label="Loading project settings..." />;
  }

  if (loadError || !project || !form) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "Error" }]} />
        <ErrorBanner message={loadError ?? "Failed to load project."} />
      </div>
    );
  }

  return (
    <div className="animate-slide-up space-y-5">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/app/projects" },
          { label: project.name, href: `/app/projects/${projectId}` },
          { label: "Settings" },
        ]}
      />

      <PageHeader
        label="Project Settings"
        title="Update project"
        description="Change the project name, repository URL, default branch, config path, or repository token."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <Card>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Project name"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="Docs Forge"
                  helperText="Operator-facing project label shown across the shell."
                  required
                />
                <Input
                  label="Project slug"
                  value={`${project.ownerSlug}/${project.projectSlug}`}
                  disabled
                  helperText="Immutable owner-scoped identifier."
                />
              </div>

              <Input
                label="Repository URL"
                value={form.repoUrl}
                onChange={(event) => updateField("repoUrl", event.target.value)}
                placeholder="https://github.com/owner/repo"
                helperText="HTTPS clone URL only in v1."
                required
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Default branch"
                  value={form.defaultBranch}
                  onChange={(event) => updateField("defaultBranch", event.target.value)}
                  placeholder="main"
                  helperText="Branch used for manual runs unless overridden."
                  required
                />
                <Input
                  label="Config path"
                  value={form.configPath}
                  onChange={(event) => updateField("configPath", event.target.value)}
                  placeholder=".anvil.yml"
                  helperText="Repository-defined pipeline config path."
                />
              </div>

              <Input
                label="Repository token"
                type="password"
                value={form.repoToken}
                onChange={(event) => updateField("repoToken", event.target.value)}
                placeholder="Leave empty to keep current token"
                helperText="Enter a new token to replace, or leave empty to keep the existing one."
              />

              {submitError ? <ErrorBanner message={submitError} /> : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  variant="primary"
                  type="submit"
                  disabled={submitting}
                  loading={submitting}
                  icon={!submitting ? <Save className="h-4 w-4" /> : undefined}
                >
                  Save Changes
                </Button>
                <Link to={`/app/projects/${projectId}`}>
                  <Button variant="secondary">Cancel</Button>
                </Link>
              </div>
            </form>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Repository host</p>
            <p className="mt-2 text-lg font-semibold text-zinc-100">
              {form.repoUrl ? inferRepositoryProvider(form.repoUrl) : "not set"}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Dispatch</p>
            <div
              className="mt-2 flex rounded-lg border border-zinc-800/70 bg-zinc-900/80 p-0.5"
              role="radiogroup"
              aria-label="Dispatch mode"
            >
              {(["queue", "workflows"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={form.dispatchMode === option}
                  className={[
                    "flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                    form.dispatchMode === option
                      ? "bg-accent-500/15 text-accent-300"
                      : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200",
                  ].join(" ")}
                  onClick={() => updateField("dispatchMode", option)}
                >
                  {option === "queue" ? "Queue" : "Workflows"}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-zinc-500">
              {form.dispatchMode === "queue"
                ? "Runs are dispatched via Cloudflare Queues with at-least-once delivery."
                : "Runs use Cloudflare Workflows for durable execution with automatic retries."}
            </p>
          </Card>

          {canSelectMode ? (
            <Card className="p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Transport</p>
              <div className="mt-2">
                <Badge variant={mode === "live" ? "accent" : "default"}>{mode}</Badge>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
};

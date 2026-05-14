import type { DispatchMode, ProjectConfigSummary, ProjectDetail, UpdateProjectRequest } from "@/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { LoadingPanel } from "@/client/components";
import { Badge, Breadcrumbs, Button, ButtonLink, Card, ErrorBanner, Input, PageHeader } from "@/client/components/ui";
import { formatApiError, getApiClient, inferRepositoryProvider, queryKeys, type AuthMode } from "@/client/lib";
import { useToast } from "@/client/toast";

interface SettingsFormState {
  name: string;
  repoUrl: string;
  defaultBranch: string;
  configPath: string;
  repoToken: string;
  dispatchMode: DispatchMode;
}

interface ProjectSettingsFormProps {
  canSelectMode: boolean;
  mode: AuthMode;
  project: ProjectConfigSummary;
  projectId: string;
}

const buildInitialForm = (project: ProjectConfigSummary): SettingsFormState => ({
  name: project.name,
  repoUrl: project.repoUrl,
  defaultBranch: project.defaultBranch,
  configPath: project.configPath,
  repoToken: "",
  dispatchMode: project.dispatchMode,
});

const ProjectSettingsForm = ({ canSelectMode, mode, project, projectId }: ProjectSettingsFormProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [form, setForm] = useState<SettingsFormState>(() => buildInitialForm(project));

  const updateProjectMutation = useMutation({
    mutationFn: (payload: UpdateProjectRequest) => getApiClient(mode).updateProject(projectId, payload),
    onSuccess: (response) => {
      queryClient.setQueryData<ProjectDetail>(queryKeys.projectDetail(mode, projectId), (current) =>
        current ? { ...current, project: response.project } : current,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectDetail(mode, projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectsRoot(mode) });

      pushToast({
        tone: "success",
        title: "Project updated",
        message: `${response.project.ownerSlug}/${response.project.projectSlug} settings saved.`,
      });
      navigate(`/app/projects/${projectId}`, { replace: true });
    },
    onError: (reason) => {
      pushToast({ tone: "error", title: "Update failed", message: formatApiError(reason) });
    },
  });

  const updateField = <Field extends keyof SettingsFormState>(field: Field, value: SettingsFormState[Field]) => {
    updateProjectMutation.reset();
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (updateProjectMutation.isPending) return;

    updateProjectMutation.reset();

    const payload: UpdateProjectRequest = {};
    if (form.name !== project.name) payload.name = form.name;
    if (form.repoUrl !== project.repoUrl) payload.repoUrl = form.repoUrl;
    if (form.defaultBranch !== project.defaultBranch) payload.defaultBranch = form.defaultBranch;
    if (form.configPath !== project.configPath) payload.configPath = form.configPath;
    if (form.repoToken) payload.repoToken = form.repoToken;
    if (form.dispatchMode !== project.dispatchMode) payload.dispatchMode = form.dispatchMode;

    if (Object.keys(payload).length === 0) {
      pushToast({ tone: "success", title: "No changes", message: "Nothing to update." });
      return;
    }

    updateProjectMutation.mutate(payload);
  };

  const submitError = updateProjectMutation.isError ? formatApiError(updateProjectMutation.error) : null;
  const submitting = updateProjectMutation.isPending;

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
                <ButtonLink to={`/app/projects/${projectId}`} variant="ghost">
                  Cancel
                </ButtonLink>
              </div>
            </form>
          </Card>
        </div>

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

export const ProjectSettingsPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { canSelectMode, mode } = useAuth();
  const resolvedProjectId = projectId ?? "";

  const detailQuery = useQuery({
    queryKey: queryKeys.projectDetail(mode, resolvedProjectId),
    queryFn: () => getApiClient(mode).getProjectDetail(resolvedProjectId),
    enabled: resolvedProjectId.length > 0,
  });

  if (!projectId) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "Error" }]} />
        <ErrorBanner message="Missing project id." />
      </div>
    );
  }

  if (detailQuery.isPending) {
    return <LoadingPanel label="Loading project settings..." />;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "Error" }]} />
        <ErrorBanner message={detailQuery.isError ? formatApiError(detailQuery.error) : "Failed to load project."} />
      </div>
    );
  }

  return (
    <ProjectSettingsForm
      key={`${mode}:${projectId}:${detailQuery.data.project.updatedAt}`}
      canSelectMode={canSelectMode}
      mode={mode}
      project={detailQuery.data.project}
      projectId={projectId}
    />
  );
};

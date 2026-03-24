import { FlaskConical, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { Badge, Breadcrumbs, Button, Card, ErrorBanner, Input, PageHeader } from "@/client/components/ui";
import { buildProjectSlug, formatApiError, getApiClient, inferRepositoryProvider } from "@/client/lib";
import { useToast } from "@/client/toast";

interface ProjectFormState {
  name: string;
  projectSlug: string;
  repoUrl: string;
  defaultBranch: string;
  configPath: string;
  repoToken: string;
}

const initialFormState: ProjectFormState = {
  name: "",
  projectSlug: "",
  repoUrl: "",
  defaultBranch: "main",
  configPath: ".anvil.yml",
  repoToken: "",
};

export const CreateProjectPage = () => {
  const navigate = useNavigate();
  const { canSelectMode, mode } = useAuth();
  const { pushToast } = useToast();
  const [form, setForm] = useState<ProjectFormState>(initialFormState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  const updateField = (field: keyof ProjectFormState, value: ProjectFormState[keyof ProjectFormState]) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  useEffect(() => {
    if (slugTouched) {
      return;
    }

    setForm((current) => ({
      ...current,
      projectSlug: buildProjectSlug(current.name),
    }));
  }, [slugTouched, form.name]);

  const loadExample = () => {
    setForm({
      name: "Edge Docs",
      projectSlug: "edge-docs",
      repoUrl: "https://github.com/rachel/edge-docs",
      defaultBranch: "main",
      configPath: ".anvil.yml",
      repoToken: "",
    });
    setSlugTouched(true);
  };

  return (
    <div className="animate-slide-up space-y-5">
      <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "New Project" }]} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-5">
          <PageHeader
            label="Project Setup"
            title="Create a project"
            description="Connect a repository over HTTPS, choose the default branch, and point anvil at the repo-defined config file."
          />

          <Card>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitting(true);
                setError(null);

                void getApiClient(mode)
                  .createProject({
                    name: form.name,
                    projectSlug: form.projectSlug,
                    repoUrl: form.repoUrl,
                    defaultBranch: form.defaultBranch,
                    configPath: form.configPath || undefined,
                    repoToken: form.repoToken ? form.repoToken : undefined,
                  })
                  .then((response) => {
                    pushToast({
                      tone: "success",
                      title: "Project created",
                      message: `${response.project.ownerSlug}/${response.project.projectSlug} is now tracked.`,
                    });
                    navigate("/app/projects", { replace: true });
                  })
                  .catch((reason: unknown) => {
                    const message = formatApiError(reason);
                    setError(message);
                    pushToast({
                      tone: "error",
                      title: "Project creation failed",
                      message,
                    });
                  })
                  .finally(() => {
                    setSubmitting(false);
                  });
              }}
            >
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
                  value={form.projectSlug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    updateField("projectSlug", buildProjectSlug(event.target.value));
                  }}
                  placeholder="docs-forge"
                  helperText="Stable owner-scoped identifier used in URLs."
                  required
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
                placeholder="Optional personal access token"
                helperText="Leave empty for public repos."
              />

              {error ? <ErrorBanner message={error} /> : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  variant="primary"
                  type="submit"
                  disabled={submitting}
                  loading={submitting}
                  icon={!submitting ? <Save className="h-4 w-4" /> : undefined}
                >
                  Create Project
                </Button>
                <Link to="/app/projects">
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

          {canSelectMode ? (
            <Card className="p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Transport</p>
              <div className="mt-2">
                <Badge variant={mode === "live" ? "accent" : "default"}>{mode}</Badge>
              </div>
            </Card>
          ) : null}

          <Button
            variant="secondary"
            className="w-full"
            icon={<FlaskConical className="h-4 w-4" />}
            onClick={loadExample}
          >
            Load Example
          </Button>
        </div>
      </div>
    </div>
  );
};

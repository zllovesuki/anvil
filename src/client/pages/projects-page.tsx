import type { ProjectSummary, RunStatus } from "@/contracts";
import { FolderGit2, FolderPlus, GitBranch, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { StatusPill } from "@/client/components";
import { Badge, Button, EmptyState, ErrorBanner, PageHeader, Skeleton } from "@/client/components/ui";
import { formatApiError, formatProjectUpdatedLabel, getApiClient, inferRepositoryProvider } from "@/client/lib";
import { useToast } from "@/client/toast";

const countByStatus = (projects: ProjectSummary[], target: RunStatus): number =>
  projects.filter((project) => project.lastRunStatus === target).length;

const pad2 = (n: number) => String(n).padStart(2, "0");

const ProjectCard = ({ project }: { project: ProjectSummary }) => (
  <Link
    to={`/app/projects/${project.id}`}
    className="group flex flex-col gap-3 rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-4 hover:-translate-y-0.5 hover:border-zinc-700/60 hover:bg-zinc-900/80 transition-transform"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-zinc-100 group-hover:text-accent-100">{project.name}</p>
        <p className="mt-0.5 truncate text-sm text-zinc-500">
          {project.ownerSlug}/{project.projectSlug}
        </p>
      </div>
      <StatusPill status={project.lastRunStatus} />
    </div>
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <Badge>{inferRepositoryProvider(project.repoUrl)}</Badge>
      <span className="inline-flex items-center gap-1">
        <GitBranch className="h-3 w-3" />
        {project.defaultBranch}
      </span>
    </div>
    <p className="text-xs text-zinc-600">updated {formatProjectUpdatedLabel(project)}</p>
  </Link>
);

const ProjectCardSkeleton = () => (
  <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1.5 h-4 w-28" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
    <div className="flex items-center gap-2">
      <Skeleton className="h-5 w-14" />
      <Skeleton className="h-4 w-16" />
    </div>
    <Skeleton className="h-3.5 w-24" />
  </div>
);

export const ProjectsPage = () => {
  const { mode, user } = useAuth();
  const { pushToast } = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = async (signal?: { canceled: boolean }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await getApiClient(mode).getProjects();
      if (signal?.canceled) return;
      setProjects(response.projects);
    } catch (reason) {
      if (signal?.canceled) return;
      const message = formatApiError(reason);
      setError(message);
      pushToast({
        tone: "error",
        title: "Projects failed to load",
        message,
      });
    } finally {
      if (!signal?.canceled) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!user) {
      return;
    }

    const signal = { canceled: false };
    void loadProjects(signal);

    return () => {
      signal.canceled = true;
    };
  }, [mode, user?.id]);

  const activeCount =
    countByStatus(projects, "queued") +
    countByStatus(projects, "starting") +
    countByStatus(projects, "running") +
    countByStatus(projects, "cancel_requested") +
    countByStatus(projects, "canceling");
  const healthyCount = countByStatus(projects, "passed");

  return (
    <div className="animate-slide-up space-y-5">
      <PageHeader
        label="Workspace"
        title="Projects"
        description={
          loading
            ? undefined
            : `${projects.length} project${projects.length === 1 ? "" : "s"} connected to this workspace.`
        }
        actions={
          <>
            <Link to="/app/projects/new">
              <Button variant="primary" icon={<FolderPlus className="h-4 w-4" />}>
                New Project
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              aria-label="Refresh"
              onClick={() => {
                void loadProjects();
              }}
            />
          </>
        }
      />

      {!loading && projects.length > 0 ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Total</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-100">{pad2(projects.length)}</p>
          </div>
          <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Active</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-100">{pad2(activeCount)}</p>
          </div>
          <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Passing</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-100">{pad2(healthyCount)}</p>
          </div>
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 className="h-6 w-6" />}
          title="No projects yet"
          description="Create the first repository connection for this workspace."
          action={
            <Link to="/app/projects/new">
              <Button variant="primary">Create Project</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
};

import type { ProjectDetail, RunSummary } from "@/contracts";
import { Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { WebhookCard, ProjectMetadataCard, RunRow } from "@/client/components";
import { Breadcrumbs, Button, EmptyState, ErrorBanner, Skeleton } from "@/client/components/ui";
import { formatApiError, getApiClient } from "@/client/lib";
import { useToast } from "@/client/toast";
const ProjectDetailSkeleton = () => (
  <div className="animate-slide-up space-y-5">
    <Skeleton className="h-5 w-48" />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-3 h-7 w-10" />
        </div>
      ))}
    </div>
    <div className="grid gap-5 lg:grid-cols-[minmax(230px,400px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-6 w-44" />
          <Skeleton className="mt-2 h-4 w-32" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-36" />
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-6 w-16 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1.5 h-3.5 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);
export const ProjectDetailPage = () => {
  const { projectId } = useParams<{
    projectId: string;
  }>();
  const { mode } = useAuth();
  const { pushToast } = useToast();
  const projectKey = projectId ? `${mode}:${projectId}` : null;
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadedProjectKey, setLoadedProjectKey] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorProjectKey, setErrorProjectKey] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const loadedProjectKeyRef = useRef(loadedProjectKey);
  loadedProjectKeyRef.current = loadedProjectKey;
  const projectKeyRef = useRef(projectKey);
  projectKeyRef.current = projectKey;
  const requestIdRef = useRef(0);
  const loadProject = useCallback(
    async ({
      clearState = false,
      showToast = true,
    }: {
      clearState?: boolean;
      showToast?: boolean;
    } = {}) => {
      if (!projectId || !projectKey) {
        setDetail(null);
        setLoadedProjectKey(null);
        setRuns([]);
        setNextCursor(null);
        setError(null);
        setErrorProjectKey(null);
        setLoading(false);
        return;
      }
      const requestId = ++requestIdRef.current;
      const shouldShowSpinner = clearState || detailRef.current === null || loadedProjectKeyRef.current !== projectKey;
      if (clearState) {
        setDetail(null);
        setLoadedProjectKey(null);
        setRuns([]);
        setNextCursor(null);
        setError(null);
        setErrorProjectKey(null);
      }
      if (shouldShowSpinner) {
        setLoading(true);
      }
      try {
        const client = getApiClient(mode);
        const [detailResponse, runsResponse] = await Promise.all([
          client.getProjectDetail(projectId),
          client.getProjectRuns(projectId, { limit: 20 }),
        ]);
        if (requestId !== requestIdRef.current || projectKeyRef.current !== projectKey) {
          return;
        }
        setDetail(detailResponse);
        setLoadedProjectKey(projectKey);
        setRuns(runsResponse.runs);
        setNextCursor(runsResponse.nextCursor);
        setError(null);
        setErrorProjectKey(null);
      } catch (reason) {
        if (requestId !== requestIdRef.current || projectKeyRef.current !== projectKey) {
          return;
        }
        const message = formatApiError(reason);
        setError(message);
        setErrorProjectKey(projectKey);
        if (clearState) {
          setDetail(null);
          setLoadedProjectKey(null);
          setRuns([]);
          setNextCursor(null);
        }
        if (showToast) {
          pushToast({ tone: "error", title: "Failed to load project", message });
        }
      } finally {
        if (shouldShowSpinner && requestId === requestIdRef.current && projectKeyRef.current === projectKey) {
          setLoading(false);
        }
      }
    },
    [mode, projectId, projectKey, pushToast],
  );
  useEffect(() => {
    void loadProject({ clearState: true, showToast: false });
  }, [loadProject]);
  useEffect(() => {
    setTriggering(false);
    setLoadingMore(false);
    setLoadMoreError(null);
  }, [projectKey]);
  // Polling when active/pending runs exist
  useEffect(() => {
    const hasActivity =
      detailRef.current !== null && loadedProjectKeyRef.current === projectKey
        ? detailRef.current.activeRun !== null || detailRef.current.pendingRuns.length > 0
        : false;
    if (!hasActivity) {
      return;
    }
    const interval = setInterval(() => {
      void loadProject({ showToast: false });
    }, 7000);
    return () => clearInterval(interval);
  }, [loadProject, projectKey]);
  const handleTriggerRun = async () => {
    if (!projectId || triggering) return;
    const activeProjectKey = projectKeyRef.current;
    if (!activeProjectKey) return;
    setTriggering(true);
    try {
      const response = await getApiClient(mode).triggerRun(projectId);
      if (projectKeyRef.current !== activeProjectKey) {
        return;
      }
      pushToast({ tone: "success", title: "Run triggered", message: `Run ${response.runId} queued.` });
      await loadProject();
    } catch (reason) {
      if (projectKeyRef.current !== activeProjectKey) {
        return;
      }
      pushToast({ tone: "error", title: "Trigger failed", message: formatApiError(reason) });
    } finally {
      if (projectKeyRef.current === activeProjectKey) {
        setTriggering(false);
      }
    }
  };
  const handleLoadMore = async () => {
    if (!projectId || !nextCursor || loadingMore) return;
    const activeProjectKey = projectKeyRef.current;
    if (!activeProjectKey) return;
    setLoadingMore(true);
    try {
      const response = await getApiClient(mode).getProjectRuns(projectId, { limit: 20, cursor: nextCursor });
      if (projectKeyRef.current !== activeProjectKey) {
        return;
      }
      setRuns((prev) => [...prev, ...response.runs]);
      setNextCursor(response.nextCursor);
      setLoadMoreError(null);
    } catch (reason) {
      if (projectKeyRef.current !== activeProjectKey) {
        return;
      }
      setLoadMoreError(formatApiError(reason));
    } finally {
      if (projectKeyRef.current === activeProjectKey) {
        setLoadingMore(false);
      }
    }
  };
  const hasCurrentDetail = detail !== null && loadedProjectKey === projectKey;
  const currentError = errorProjectKey === projectKey ? error : null;
  if (loading || (projectKey !== null && !hasCurrentDetail && currentError === null)) {
    return <ProjectDetailSkeleton />;
  }
  if (currentError && !hasCurrentDetail) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "Error" }]} />
        <ErrorBanner message={currentError} />
      </div>
    );
  }
  if (!hasCurrentDetail || !detail) return null;
  const { project, activeRun, pendingRuns } = detail;
  return (
    <div className="animate-slide-up space-y-5">
      <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: project.name }]} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Dispatch</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">{project.dispatchMode}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Runs loaded</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">{String(runs.length).padStart(2, "0")}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Active</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">{activeRun ? "01" : "00"}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Pending</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">{String(pendingRuns.length).padStart(2, "0")}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(230px,400px)_minmax(0,1fr)]">
        {/* Left column */}
        <div className="space-y-4">
          <ProjectMetadataCard project={project} settingsHref={`/app/projects/${projectId}/settings`} />
          <WebhookCard projectId={projectId!} project={project} />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Run history</p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-100">Recent runs</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={triggering}
                loading={triggering}
                icon={!triggering ? <Play className="h-3.5 w-3.5" /> : undefined}
                onClick={() => {
                  void handleTriggerRun();
                }}
              >
                Trigger Run
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                aria-label="Refresh"
                onClick={() => {
                  void loadProject();
                }}
              />
            </div>
          </div>

          {currentError ? <ErrorBanner message={currentError} /> : null}

          {runs.length === 0 ? (
            <EmptyState
              icon={<Play className="h-6 w-6" />}
              title="No runs yet"
              description="Trigger a run to get started."
            />
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          )}

          {nextCursor ? (
            <Button
              variant="secondary"
              className="w-full"
              disabled={loadingMore}
              loading={loadingMore}
              onClick={() => {
                void handleLoadMore();
              }}
            >
              Load more
            </Button>
          ) : null}

          {loadMoreError ? (
            <div className="space-y-2">
              <ErrorBanner message={loadMoreError} />
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setLoadMoreError(null);
                  void handleLoadMore();
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

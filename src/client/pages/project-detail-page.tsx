import type { ProjectDetail } from "@/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";
import { useParams } from "react-router-dom";
import { ProjectMetadataCard, RunRow, WebhookCard } from "@/client/components";
import { Breadcrumbs, Button, EmptyState, ErrorBanner, Skeleton } from "@/client/components/ui";
import { formatApiError, getApiClient, queryKeys } from "@/client/lib";
import { useToast } from "@/client/toast";

const RUN_PAGE_LIMIT = 20;

const hasRunActivity = (detail: ProjectDetail | undefined): boolean =>
  detail !== undefined && (detail.activeRun !== null || detail.pendingRuns.length > 0);

const ProjectDetailSkeleton = () => (
  <div className="animate-slide-up space-y-5">
    <Skeleton className="h-5 w-48" />
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
  const { projectId } = useParams<{ projectId: string }>();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const resolvedProjectId = projectId ?? "";

  const detailQuery = useQuery({
    queryKey: queryKeys.projectDetail(resolvedProjectId),
    queryFn: () => getApiClient().getProjectDetail(resolvedProjectId),
    enabled: resolvedProjectId.length > 0,
    refetchInterval: (query) => (hasRunActivity(query.state.data) ? 7_000 : false),
  });

  const runsQuery = useInfiniteQuery({
    queryKey: queryKeys.projectRuns(resolvedProjectId),
    queryFn: ({ pageParam }) =>
      getApiClient().getProjectRuns(resolvedProjectId, {
        limit: RUN_PAGE_LIMIT,
        cursor: pageParam ?? undefined,
      }),
    enabled: resolvedProjectId.length > 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    refetchInterval: hasRunActivity(detailQuery.data) ? 7_000 : false,
  });

  const triggerRunMutation = useMutation({
    mutationFn: () => getApiClient().triggerRun(resolvedProjectId),
    onSuccess: async (response) => {
      pushToast({ tone: "success", title: "Run triggered", message: `Run ${response.runId} queued.` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projectDetail(resolvedProjectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectRuns(resolvedProjectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectsRoot() }),
      ]);
    },
    onError: (reason) => {
      pushToast({ tone: "error", title: "Trigger failed", message: formatApiError(reason) });
    },
  });

  const handleRefresh = async () => {
    await Promise.all([detailQuery.refetch(), runsQuery.refetch()]);
  };

  const pageTitle = detailQuery.data?.project.name ?? projectId?.slice(0, 8) ?? "";

  if (!projectId) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "Error" }]} />
        <ErrorBanner message="Missing project id." />
      </div>
    );
  }

  if (detailQuery.isPending || runsQuery.isPending) {
    return (
      <>
        <h1 className="sr-only">{pageTitle}</h1>
        <ProjectDetailSkeleton />
      </>
    );
  }

  if (detailQuery.isError && !detailQuery.data) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "Error" }]} />
        <ErrorBanner message={formatApiError(detailQuery.error)} />
      </div>
    );
  }

  if (!detailQuery.data) return null;

  const { project } = detailQuery.data;
  const runs = runsQuery.data?.pages.flatMap((page) => page.runs) ?? [];
  const runsError = runsQuery.isError ? formatApiError(runsQuery.error) : null;
  const loadingMore = runsQuery.isFetchingNextPage;
  const triggering = triggerRunMutation.isPending;

  return (
    <div className="animate-slide-up space-y-5">
      <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: project.name }]} />

      <div className="grid gap-5 lg:grid-cols-[minmax(230px,400px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <ProjectMetadataCard project={project} settingsHref={`/app/projects/${projectId}/settings`} />
          <WebhookCard projectId={projectId} project={project} />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Run history</p>
              <h2 className="mt-1 font-display text-lg font-semibold text-zinc-100">Recent runs</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={triggering}
                loading={triggering}
                icon={!triggering ? <Play className="h-3.5 w-3.5" /> : undefined}
                onClick={() => triggerRunMutation.mutate()}
              >
                Trigger Run
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                aria-label="Refresh"
                onClick={() => {
                  void handleRefresh();
                }}
              />
            </div>
          </div>

          {detailQuery.isError ? <ErrorBanner message={formatApiError(detailQuery.error)} /> : null}

          {runsError && runs.length === 0 ? <ErrorBanner message={runsError} /> : null}

          {runs.length === 0 && !runsError ? (
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

          {runsQuery.hasNextPage ? (
            <Button
              variant="secondary"
              className="w-full"
              disabled={loadingMore}
              loading={loadingMore}
              onClick={() => {
                void runsQuery.fetchNextPage();
              }}
            >
              Load more
            </Button>
          ) : null}

          {runsError && runs.length > 0 ? (
            <div className="space-y-2">
              <ErrorBanner message={runsError} />
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  void runsQuery.fetchNextPage();
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

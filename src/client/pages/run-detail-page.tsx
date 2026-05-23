import type { LogEvent, RunDetail, RunWsStateMessage } from "@/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, GitBranch, GitCommitHorizontal, Terminal, Timer, XCircle, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { LoadingPanel, LogViewer, StatusPill, StepRow } from "@/client/components";
import { Breadcrumbs, Button, Card, ConfirmDialog, ErrorBanner } from "@/client/components/ui";
import { useLogStream } from "@/client/hooks";
import {
  TRIGGER_TYPE_LABELS,
  formatApiError,
  formatDuration,
  formatRunFailureMessage,
  formatTimestamp,
  getApiClient,
  mergeLogEventBySeq,
  queryKeys,
} from "@/client/lib";
import { useToast } from "@/client/toast";

const TERMINAL_STATUSES = new Set(["passed", "failed", "canceled"]);

interface RunDetailContentProps {
  detail: RunDetail;
  projectName: string | null;
  runId: string;
}

const isTerminalStatus = (status: string): boolean => TERMINAL_STATUSES.has(status);

const mergeLogs = (currentLogs: LogEvent[], incomingLogs: LogEvent[]): LogEvent[] =>
  incomingLogs.reduce((merged, event) => mergeLogEventBySeq(merged, event), currentLogs);

const RunDetailContent = ({ detail, projectName, runId }: RunDetailContentProps) => {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [streamLogs, setStreamLogs] = useState<LogEvent[]>(() => detail.recentLogs);
  const { run, steps, currentStep, errorMessage, detailAvailable } = detail;
  const isTerminal = isTerminalStatus(run.status);

  const cancelRunMutation = useMutation({
    mutationFn: () => getApiClient().cancelRun(runId),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.runDetail(runId), result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectDetail(result.run.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectRuns(result.run.projectId) });
      pushToast({ tone: "success", title: "Cancel requested", message: "Run cancellation has been requested." });
    },
    onError: (reason) => {
      pushToast({ tone: "error", title: "Cancel failed", message: formatApiError(reason) });
    },
  });

  const handleLogEvent = (event: LogEvent) => {
    setStreamLogs((current) => mergeLogEventBySeq(current, event));
  };

  const handleStateUpdate = (message: RunWsStateMessage) => {
    queryClient.setQueryData<RunDetail>(queryKeys.runDetail(runId), (current) => {
      const source = current ?? detail;
      return {
        ...source,
        run: {
          ...source.run,
          status: message.run.status,
          startedAt: message.run.startedAt,
          finishedAt: message.run.finishedAt,
          exitCode: message.run.exitCode,
        },
        currentStep: message.run.currentStep,
        errorMessage: message.run.errorMessage,
        steps: message.steps,
        detailAvailable: true,
      };
    });

    if (isTerminalStatus(message.run.status)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runDetail(runId) });
    }
  };

  const logStreamStatus = useLogStream({
    runId,
    enabled: !isTerminal,
    onEvent: handleLogEvent,
    onStateUpdate: handleStateUpdate,
  });

  const displayedLogs = useMemo(
    () => (isTerminal ? mergeLogs(streamLogs, detail.recentLogs) : streamLogs),
    [detail.recentLogs, isTerminal, streamLogs],
  );

  const pageTitle = `Run ${runId.slice(0, 12)}`;
  const commitDisplay = run.commitSha ? run.commitSha.slice(0, 7) : "\u2014";
  const canCancel = !isTerminalStatus(run.status);
  const isCancelPending = run.status === "cancel_requested" || run.status === "canceling";
  const canceling = cancelRunMutation.isPending;

  return (
    <div className="animate-slide-up space-y-5">
      <h1 className="sr-only">{pageTitle}</h1>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 pb-1">
        <Breadcrumbs
          items={[
            { label: "Projects", href: "/app/projects" },
            { label: projectName ?? run.projectId.slice(0, 8), href: `/app/projects/${run.projectId}` },
            { label: `Run ${run.id.slice(0, 12)}` },
          ]}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
          <StatusPill status={run.status} />
          <span className="inline-flex items-center gap-1">
            <GitBranch className="h-3.5 w-3.5 text-zinc-500" />
            {run.branch}
          </span>
          <span className="hidden items-center gap-1 font-mono text-xs sm:inline-flex">
            <GitCommitHorizontal className="h-3.5 w-3.5 text-zinc-500" />
            {commitDisplay}
          </span>
          <span className="hidden items-center gap-1 sm:inline-flex">
            <Zap className="h-3.5 w-3.5 text-zinc-500" />
            {TRIGGER_TYPE_LABELS[run.triggerType] ?? run.triggerType}
          </span>
          {run.startedAt && run.finishedAt ? (
            <span className="inline-flex items-center gap-1 text-zinc-500">
              <Timer className="h-3.5 w-3.5" />
              {formatDuration(run.startedAt, run.finishedAt)}
            </span>
          ) : null}
          <span
            className="hidden items-center gap-1 text-zinc-500 sm:inline-flex"
            title={`Queued ${formatTimestamp(run.queuedAt)}`}
          >
            <Clock className="h-3.5 w-3.5" />
            Queued {formatTimestamp(run.queuedAt)}
          </span>
        </div>
      </div>

      {!detailAvailable ? (
        <div className="rounded-2xl border border-accent-500/20 bg-accent-500/10 p-4 text-sm text-accent-400">
          Detailed run data is no longer available.
        </div>
      ) : null}

      {errorMessage ? <ErrorBanner message={formatRunFailureMessage(errorMessage)} /> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(230px,400px)_minmax(0,1fr)]">
        <div className="space-y-4">
          {steps.length > 0 ? (
            <Card>
              <h2 className="mb-4 flex items-center gap-2 font-display text-sm font-semibold text-zinc-100">
                <Terminal className="h-4 w-4 text-zinc-400" />
                Steps
              </h2>
              <div className="space-y-2">
                {steps.map((step) => (
                  <StepRow key={step.id} step={step} isActive={step.position === currentStep} />
                ))}
              </div>
            </Card>
          ) : null}

          {canCancel ? (
            <>
              <Button
                variant="danger"
                className="w-full"
                disabled={canceling || isCancelPending}
                loading={canceling || isCancelPending}
                icon={!(canceling || isCancelPending) ? <XCircle className="h-4 w-4" /> : undefined}
                onClick={() => setConfirmCancelOpen(true)}
              >
                Cancel Run
              </Button>
              <ConfirmDialog
                open={confirmCancelOpen}
                onConfirm={() => {
                  setConfirmCancelOpen(false);
                  cancelRunMutation.mutate();
                }}
                onCancel={() => setConfirmCancelOpen(false)}
                title="Cancel this run?"
                description="This run will be cancelled. This action cannot be undone."
                confirmLabel="Cancel Run"
                variant="danger"
              />
            </>
          ) : null}
        </div>

        <LogViewer logs={displayedLogs} logStreamStatus={logStreamStatus} />
      </div>
    </div>
  );
};

export const RunDetailPage = () => {
  const { runId } = useParams<{ runId: string }>();
  const resolvedRunId = runId ?? "";

  const runQuery = useQuery({
    queryKey: queryKeys.runDetail(resolvedRunId),
    queryFn: () => getApiClient().getRunDetail(resolvedRunId),
    enabled: resolvedRunId.length > 0,
    refetchInterval: (query) => {
      const detail = query.state.data;
      return detail !== undefined && !isTerminalStatus(detail.run.status) ? 30_000 : false;
    },
  });

  const projectId = runQuery.data?.run.projectId ?? "";
  const projectNameQuery = useQuery({
    queryKey: queryKeys.projectDetail(projectId),
    queryFn: () => getApiClient().getProjectDetail(projectId),
    enabled: projectId.length > 0,
    staleTime: 60_000,
  });

  const pageTitle = `Run ${runId?.slice(0, 12) ?? ""}`;

  if (!runId) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "Error" }]} />
        <ErrorBanner message="Missing run id." />
      </div>
    );
  }

  if (runQuery.isPending) {
    return (
      <>
        <h1 className="sr-only">{pageTitle}</h1>
        <LoadingPanel label="Loading run..." />
      </>
    );
  }

  if (runQuery.isError && !runQuery.data) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "Error" }]} />
        <ErrorBanner message={formatApiError(runQuery.error)} />
      </div>
    );
  }

  if (!runQuery.data) return null;

  return (
    <>
      {runQuery.isError ? <ErrorBanner message={formatApiError(runQuery.error)} /> : null}
      <RunDetailContent
        key={runId}
        detail={runQuery.data}
        projectName={projectNameQuery.data?.project.name ?? null}
        runId={runId}
      />
    </>
  );
};

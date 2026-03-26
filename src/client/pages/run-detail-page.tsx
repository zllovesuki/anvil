import type { LogEvent, RunDetail, RunWsStateMessage } from "@/contracts";
import { Clock, GitBranch, GitCommitHorizontal, Terminal, Timer, XCircle, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { LoadingPanel, StatusPill, LogViewer, StepRow } from "@/client/components";
import { Breadcrumbs, Button, Card, ErrorBanner } from "@/client/components/ui";
import { useLogStream } from "@/client/hooks";
import {
  TRIGGER_TYPE_LABELS,
  formatApiError,
  formatDuration,
  formatRunFailureMessage,
  formatTimestamp,
  getApiClient,
  mergeLogEventBySeq,
} from "@/client/lib";
import { useToast } from "@/client/toast";
const TERMINAL_STATUSES = new Set(["passed", "failed", "canceled"]);
export const RunDetailPage = () => {
  const { runId } = useParams<{
    runId: string;
  }>();
  const { mode } = useAuth();
  const { pushToast } = useToast();
  const runKey = runId ? `${mode}:${runId}` : null;
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loadedRunKey, setLoadedRunKey] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRunKey, setErrorRunKey] = useState<string | null>(null);
  // overview is now header-integrated, no collapse state needed
  const maxSeqRef = useRef(0);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const loadedRunKeyRef = useRef(loadedRunKey);
  loadedRunKeyRef.current = loadedRunKey;
  const runKeyRef = useRef(runKey);
  runKeyRef.current = runKey;
  const requestIdRef = useRef(0);
  const hasCurrentDetail = detail !== null && loadedRunKey === runKey;
  const currentError = errorRunKey === runKey ? error : null;
  const isTerminal = hasCurrentDetail && detail ? TERMINAL_STATUSES.has(detail.run.status) : false;
  const isLive = mode === "live";
  const loadRun = useCallback(
    async ({
      clearState = false,
      seedLogs = false,
      showToast = true,
      fetchProjectName = false,
    }: {
      clearState?: boolean;
      seedLogs?: boolean;
      showToast?: boolean;
      fetchProjectName?: boolean;
    } = {}) => {
      if (!runId || !runKey) {
        setDetail(null);
        setLoadedRunKey(null);
        setProjectName(null);
        setLogs([]);
        maxSeqRef.current = 0;
        setError(null);
        setErrorRunKey(null);
        setLoading(false);
        return;
      }
      const requestId = ++requestIdRef.current;
      const shouldShowSpinner = clearState || detailRef.current === null || loadedRunKeyRef.current !== runKey;
      if (clearState) {
        setDetail(null);
        setLoadedRunKey(null);
        setProjectName(null);
        setLogs([]);
        maxSeqRef.current = 0;
        setError(null);
        setErrorRunKey(null);
      }
      if (shouldShowSpinner) {
        setLoading(true);
      }
      try {
        const client = getApiClient(mode);
        const result = await client.getRunDetail(runId);
        if (requestId !== requestIdRef.current || runKeyRef.current !== runKey) {
          return;
        }
        setDetail(result);
        setLoadedRunKey(runKey);
        setError(null);
        setErrorRunKey(null);
        if (seedLogs || TERMINAL_STATUSES.has(result.run.status)) {
          setLogs(result.recentLogs);
          maxSeqRef.current = result.recentLogs.reduce((max, event) => Math.max(max, event.seq), 0);
        }
        if (fetchProjectName) {
          void client
            .getProjectDetail(result.run.projectId)
            .then((projectDetail) => {
              if (requestId === requestIdRef.current && runKeyRef.current === runKey) {
                setProjectName(projectDetail.project.name);
              }
            })
            .catch(() => {
              if (requestId === requestIdRef.current && runKeyRef.current === runKey) {
                setProjectName(null);
              }
            });
        }
      } catch (reason) {
        if (requestId !== requestIdRef.current || runKeyRef.current !== runKey) {
          return;
        }
        const message = formatApiError(reason);
        setError(message);
        setErrorRunKey(runKey);
        if (clearState) {
          setDetail(null);
          setLoadedRunKey(null);
          setProjectName(null);
          setLogs([]);
          maxSeqRef.current = 0;
        }
        if (showToast) {
          pushToast({ tone: "error", title: "Failed to load run", message });
        }
      } finally {
        if (shouldShowSpinner && requestId === requestIdRef.current && runKeyRef.current === runKey) {
          setLoading(false);
        }
      }
    },
    [mode, pushToast, runId, runKey],
  );
  useEffect(() => {
    void loadRun({ clearState: true, seedLogs: true, showToast: false, fetchProjectName: true });
  }, [loadRun]);
  useEffect(() => {
    setCanceling(false);
  }, [runKey]);
  // Polling while non-terminal
  useEffect(() => {
    if (
      !runId ||
      !detailRef.current ||
      loadedRunKeyRef.current !== runKey ||
      TERMINAL_STATUSES.has(detailRef.current.run.status)
    ) {
      return;
    }
    const interval = setInterval(() => {
      void loadRun({ showToast: false });
    }, 30_000);
    return () => clearInterval(interval);
  }, [loadRun, runId, runKey]);
  // WebSocket log stream
  const handleLogEvent = useCallback((event: LogEvent) => {
    setLogs((prev) => {
      maxSeqRef.current = event.seq;
      return mergeLogEventBySeq(prev, event);
    });
  }, []);
  const handleStateUpdate = useCallback(
    (msg: RunWsStateMessage) => {
      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          run: {
            ...prev.run,
            status: msg.run.status,
            startedAt: msg.run.startedAt,
            finishedAt: msg.run.finishedAt,
            exitCode: msg.run.exitCode,
          },
          currentStep: msg.run.currentStep,
          errorMessage: msg.run.errorMessage,
          steps: msg.steps,
          detailAvailable: true,
        };
      });
      if (TERMINAL_STATUSES.has(msg.run.status)) {
        void loadRun({ seedLogs: true, showToast: false });
      }
    },
    [loadRun],
  );
  const logStreamStatus = useLogStream({
    runId: runId ?? "",
    enabled: !isTerminal && isLive && !loading,
    onEvent: handleLogEvent,
    onStateUpdate: handleStateUpdate,
  });
  // Cancel handler
  const handleCancel = async () => {
    if (!runId || canceling) return;
    const activeRunKey = runKeyRef.current;
    if (!activeRunKey) return;
    setCanceling(true);
    try {
      const result = await getApiClient(mode).cancelRun(runId);
      if (runKeyRef.current !== activeRunKey) {
        return;
      }
      setDetail(result);
      setLoadedRunKey(activeRunKey);
      setError(null);
      setErrorRunKey(null);
      if (TERMINAL_STATUSES.has(result.run.status)) {
        setLogs(result.recentLogs);
        maxSeqRef.current = result.recentLogs.reduce((max, event) => Math.max(max, event.seq), 0);
      }
      pushToast({ tone: "success", title: "Cancel requested", message: "Run cancellation has been requested." });
    } catch (reason) {
      if (runKeyRef.current !== activeRunKey) {
        return;
      }
      pushToast({ tone: "error", title: "Cancel failed", message: formatApiError(reason) });
    } finally {
      if (runKeyRef.current === activeRunKey) {
        setCanceling(false);
      }
    }
  };
  if (loading || (runKey !== null && !hasCurrentDetail && currentError === null)) {
    return <LoadingPanel label="Loading run..." />;
  }
  if (currentError && !hasCurrentDetail) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Projects", href: "/app/projects" }, { label: "Error" }]} />
        <ErrorBanner message={currentError} />
      </div>
    );
  }
  if (!hasCurrentDetail || !detail) {
    return null;
  }
  const { run, steps, currentStep, errorMessage, detailAvailable } = detail;
  const commitDisplay = run.commitSha ? run.commitSha.slice(0, 7) : "\u2014";
  const canCancel = !TERMINAL_STATUSES.has(run.status);
  const isCancelPending = run.status === "cancel_requested" || run.status === "canceling";
  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 pb-1">
        <Breadcrumbs
          items={[
            { label: "Projects", href: "/app/projects" },
            { label: projectName ?? run.projectId.slice(0, 8), href: `/app/projects/${run.projectId}` },
            { label: `Run ${run.id.slice(0, 12)}` },
          ]}
        />

        {/* Header-integrated overview */}
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

      {/* Detail unavailable banner */}
      {!detailAvailable ? (
        <div className="rounded-2xl border border-accent-500/20 bg-accent-500/10 p-4 text-sm text-accent-400">
          Detailed run data is no longer available.
        </div>
      ) : null}

      {currentError ? <ErrorBanner message={currentError} /> : null}

      {/* Error message */}
      {errorMessage ? <ErrorBanner message={formatRunFailureMessage(errorMessage)} /> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(230px,400px)_minmax(0,1fr)]">
        {/* Left column — steps */}
        <div className="space-y-4">
          {/* Steps section */}
          {steps.length > 0 ? (
            <Card>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-100">
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

          {/* Cancel button */}
          {canCancel ? (
            <Button
              variant="danger"
              className="w-full"
              disabled={canceling || isCancelPending}
              loading={canceling || isCancelPending}
              icon={!(canceling || isCancelPending) ? <XCircle className="h-4 w-4" /> : undefined}
              onClick={() => {
                void handleCancel();
              }}
            >
              Cancel Run
            </Button>
          ) : null}
        </div>

        {/* Right column — logs */}
        <LogViewer logs={logs} logStreamStatus={logStreamStatus} />
      </div>
    </div>
  );
};

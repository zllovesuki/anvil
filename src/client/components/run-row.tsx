import type { RunSummary } from "@/contracts";
import { Clock, GitBranch, GitCommitHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusPill } from "@/client/components/status-pill";
import { Badge } from "@/client/components/ui";
import { TRIGGER_TYPE_LABELS, formatDuration, formatRelativeTime } from "@/client/lib";

export const RunRow = ({ run }: { run: RunSummary }) => {
  const isTerminal = run.status === "passed" || run.status === "failed" || run.status === "canceled";
  const commitDisplay = run.commitSha ? run.commitSha.slice(0, 7) : "\u2014";

  return (
    <Link
      to={`/app/runs/${run.id}`}
      className="group flex items-center gap-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-4 hover:border-zinc-700/60 hover:bg-zinc-900/80"
    >
      <StatusPill status={run.status} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5 text-zinc-200">
            <GitBranch className="h-3.5 w-3.5 text-zinc-500" />
            {run.branch}
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-500">
            <GitCommitHorizontal className="h-3.5 w-3.5" />
            {commitDisplay}
          </span>
          <Badge>{TRIGGER_TYPE_LABELS[run.triggerType] ?? run.triggerType}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(run.queuedAt)}
          </span>
          {isTerminal && run.startedAt && run.finishedAt ? (
            <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
};

import type { RunStep } from "@/contracts";
import { StatusPill } from "@/client/components/status-pill";
import { formatDuration, getStatusMeta } from "@/client/lib";

const StepRow = ({ step, isActive }: { step: RunStep; isActive: boolean }) => {
  const meta = getStatusMeta(step.status);

  return (
    <div
      className={[
        "flex items-center gap-3 rounded-xl border p-3",
        isActive ? "border-amber-500/30 bg-amber-500/5" : "border-zinc-800/60 bg-zinc-950/40",
      ].join(" ")}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-700/60 bg-zinc-800/60 text-xs font-medium text-zinc-400">
        {step.position}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-200">{step.name}</span>
          <StatusPill status={step.status} />
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{step.command}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
          {step.startedAt && step.finishedAt ? <span>{formatDuration(step.startedAt, step.finishedAt)}</span> : null}
          {step.exitCode !== null ? <span>exit {step.exitCode}</span> : null}
        </div>
      </div>
    </div>
  );
};

export { StepRow };

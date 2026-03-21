import type { LogEvent } from "@/contracts";

const STREAM_COLORS: Record<string, string> = {
  stdout: "text-zinc-300",
  stderr: "text-red-400",
  system: "text-accent-400",
};

const CONNECTION_DOT: Record<string, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500 animate-pulse",
  reconnecting: "bg-amber-500 animate-pulse",
  closed: "bg-zinc-500",
  idle: "bg-zinc-500",
};

const LogViewer = ({
  logs,
  logStreamStatus,
  logContainerRef,
  onScroll,
}: {
  logs: LogEvent[];
  logStreamStatus: string;
  logContainerRef: React.RefObject<HTMLDivElement | null>;
  onScroll(): void;
}) => (
  <section className="flex min-h-[400px] flex-col overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-950/60 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)]">
    <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-4 py-2.5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">Logs</h2>
      <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
        <span className={`h-2 w-2 rounded-full ${CONNECTION_DOT[logStreamStatus] ?? "bg-zinc-500"}`} />
        {logStreamStatus}
      </span>
    </div>
    <div ref={logContainerRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-5">
      {logs.length === 0 ? (
        <p className="text-zinc-600">No log output yet.</p>
      ) : (
        logs.map((log) => (
          <div key={log.id} className="flex gap-3">
            <span className="w-8 shrink-0 select-none text-right text-zinc-600">{log.seq}</span>
            <span className={STREAM_COLORS[log.stream] ?? "text-zinc-300"}>{log.chunk}</span>
          </div>
        ))
      )}
    </div>
  </section>
);

export { LogViewer };

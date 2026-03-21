import type { ProjectSummary, RunStatus } from "@/contracts";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

const STATUS_META: Record<
  RunStatus | "idle",
  {
    label: string;
    tone: string;
    dot: string;
  }
> = {
  idle: {
    label: "Idle",
    tone: "border-zinc-700/70 bg-zinc-800/70 text-zinc-300",
    dot: "bg-zinc-500",
  },
  queued: {
    label: "Queued",
    tone: "border-accent-500/20 bg-accent-500/10 text-accent-400",
    dot: "bg-accent-500",
  },
  starting: {
    label: "Starting",
    tone: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-500 animate-pulse",
  },
  running: {
    label: "Running",
    tone: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-500 animate-pulse",
  },
  cancel_requested: {
    label: "Cancel Requested",
    tone: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-500 animate-pulse",
  },
  canceling: {
    label: "Canceling",
    tone: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-500 animate-pulse",
  },
  passed: {
    label: "Passed",
    tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    dot: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    tone: "border-red-500/20 bg-red-500/10 text-red-400",
    dot: "bg-red-500",
  },
  canceled: {
    label: "Canceled",
    tone: "border-zinc-700/70 bg-zinc-800/70 text-zinc-300",
    dot: "bg-zinc-500",
  },
};

const toRelativeUnit = (milliseconds: number): { value: number; unit: Intl.RelativeTimeFormatUnit } => {
  const seconds = Math.round(milliseconds / 1000);
  if (Math.abs(seconds) < 60) {
    return { value: seconds, unit: "second" };
  }

  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return { value: minutes, unit: "minute" };
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return { value: hours, unit: "hour" };
  }

  const days = Math.round(hours / 24);
  return { value: days, unit: "day" };
};

export const getStatusMeta = (status: RunStatus | null) => STATUS_META[status ?? "idle"];

export const formatTimestamp = (isoDateTime: string): string => DATE_FORMATTER.format(new Date(isoDateTime));

export const formatRelativeTime = (isoDateTime: string): string => {
  const { value, unit } = toRelativeUnit(Date.parse(isoDateTime) - Date.now());
  return RELATIVE_TIME_FORMATTER.format(value, unit);
};

export const formatProjectUpdatedLabel = (project: ProjectSummary): string =>
  `${formatRelativeTime(project.updatedAt)} • ${formatTimestamp(project.updatedAt)}`;

export const inferRepositoryProvider = (repoUrl: string): string => {
  try {
    const hostname = new URL(repoUrl).hostname.replace(/^www\./u, "");
    const [first, second] = hostname.split(".");
    if (first && second) {
      return `${first}.${second}`;
    }

    return hostname;
  } catch {
    return "custom";
  }
};

export const TRIGGER_TYPE_LABELS: Record<string, string> = {
  manual: "Manual",
  webhook: "Webhook",
};

export const formatDuration = (startedAt: string, finishedAt: string): string => {
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

export const buildProjectSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

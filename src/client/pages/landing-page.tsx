import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { StatusPill } from "@/client/components";
import { Badge, Button } from "@/client/components/ui";

const valueProps = [
  {
    title: "Pipeline config lives in the repo",
    description: "anvil reads `.anvil.yml` from your branch — review it, revert it, override it per branch.",
  },
  {
    title: "Serialized runs, no extra locking",
    description: "One active run per project, everything else in a durable FIFO queue.",
  },
  {
    title: "Logs stream while the run is live",
    description: "See what's running, what failed, and what's queued next — during the run, not after.",
  },
  {
    title: "Runs on Cloudflare end-to-end",
    description: "Durable Objects, Queues, D1, and Sandbox SDK — no glue services in between.",
  },
];

const workflow = [
  {
    step: "01",
    title: "Connect a repo",
    description:
      "Point anvil at a repository and choose the default branch. Access stays invite-only until you're ready to widen it.",
  },
  {
    step: "02",
    title: "Commit `.anvil.yml`",
    description:
      "Define steps in a YAML file checked into the repo. Branch it, review it, revert it — same workflow as the rest of your code.",
  },
  {
    step: "03",
    title: "Trigger and watch",
    description:
      "Start a run manually or via webhook. Queue position, active steps, and the live log tail all show up in one view.",
  },
];

const previewRuns = [
  {
    id: "#218",
    name: "deploy-docs",
    detail: "manual trigger by rachel",
    status: "running" as const,
  },
  {
    id: "#219",
    name: "smoke-check",
    detail: "queued from push to main",
    status: "queued" as const,
  },
  {
    id: "#220",
    name: "release-verify",
    detail: "queued from release branch",
    status: "queued" as const,
  },
];

const previewLogs = [
  "$ git fetch origin main --depth=1",
  "$ anvil run deploy-docs",
  "build  passed in 18.4s",
  "test   passed in 43.1s",
  "deploy uploading assets to edge...",
];

const LandingActions = ({ isAuthenticated }: { isAuthenticated: boolean }) =>
  isAuthenticated ? (
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/app/projects">
        <Button variant="primary">Go to Dashboard</Button>
      </Link>
      <Link to="/app/projects/new">
        <Button variant="secondary">New Project</Button>
      </Link>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/app/invite/accept">
        <Button variant="primary">Accept Invite</Button>
      </Link>
      <Link to="/app/login">
        <Button variant="secondary">Sign In</Button>
      </Link>
    </div>
  );

const ProductPreview = () => (
  <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
    {/* Terminal header */}
    <div className="flex items-center justify-between border-b border-zinc-800/60 bg-zinc-900/50 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex gap-1.5 min-w-[54px]">
          <span className="h-3 w-3 rounded-full bg-zinc-700" />
          <span className="h-3 w-3 rounded-full bg-zinc-700" />
          <span className="h-3 w-3 rounded-full bg-zinc-700" />
        </span>
        <span className="ml-4 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          anvil exec --tail edge-docs
        </span>
      </div>
      <Badge variant="accent" className="font-mono text-[10px]">
        branch: main
      </Badge>
    </div>

    {/* Terminal Output Area */}
    <div className="grid divide-y divide-zinc-800/60 lg:grid-cols-[minmax(300px,380px)_1fr] lg:divide-x lg:divide-y-0">
      {/* Queue status */}
      <div className="bg-zinc-900/20 p-5">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-zinc-100">Queue Status</h3>
          <span className="font-mono text-[10px] text-zinc-500">SERIALIZED FIFO</span>
        </div>

        <div className="space-y-3">
          {previewRuns.map((run) => (
            <div
              key={run.id}
              className="group relative -mx-2 flex items-start gap-3 rounded-lg border border-transparent p-2 transition-colors hover:border-zinc-800 hover:bg-zinc-900/40"
            >
              <StatusPill status={run.status} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-sm text-zinc-200 transition-colors group-hover:text-accent-400">
                    {run.id} {run.name}
                  </p>
                </div>
                <p className="mt-0.5 truncate text-xs text-zinc-500">{run.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Stream */}
      <div className="bg-zinc-950 p-5 font-mono text-xs leading-relaxed text-zinc-400 lg:p-6">
        <div className="mb-6 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Live Output
          </span>
          <span className="text-[10px] uppercase tracking-widest text-zinc-600">ID: RUN_01HQK...</span>
        </div>
        <div className="space-y-1.5">
          {previewLogs.map((line, i) => {
            const isCmd = line.startsWith("$");
            const isActive = line.includes("active") || line.includes("uploading");
            return (
              <p
                key={i}
                className={
                  isCmd ? "mb-2 mt-4 font-medium text-zinc-100" : isActive ? "text-accent-400" : "text-zinc-400"
                }
              >
                {line}
              </p>
            );
          })}
          <div className="flex gap-2">
            <span className="animate-pulse text-accent-400">_</span>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const LandingPage = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div className="pb-16 pt-8">
      {/* Hero Section */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-24">
        <div className="relative">
          <Badge
            variant="accent"
            className="mb-6 inline-flex border-accent-500/30 font-mono text-[10px] uppercase tracking-widest"
          >
            System Active
          </Badge>
          <div className="grid gap-12 lg:grid-cols-[1fr_auto]">
            <div className="animate-slide-up max-w-4xl">
              <h1 className="font-display text-5xl font-bold tracking-tight text-zinc-100 sm:text-7xl lg:text-[5rem] lg:leading-[0.95]">
                <span className="block text-zinc-500">EDGE-NATIVE CI/CD.</span>
                <span className="block">BUILT FOR VELOCITY.</span>
              </h1>
            </div>
            <div className="animate-slide-up flex flex-col justify-end lg:pb-4" style={{ animationDelay: "120ms" }}>
              <p className="max-w-sm text-base leading-7 text-zinc-400">
                A streamlined, serialized execution engine built on Cloudflare Durable Objects. No glue services. No
                yaml bloat.
              </p>
              <div className="mt-8">
                <LandingActions isAuthenticated={isAuthenticated} />
              </div>
            </div>
          </div>
        </div>

        <div className="animate-slide-up mt-16 sm:mt-24" style={{ animationDelay: "240ms" }}>
          <ProductPreview />
        </div>
      </section>

      {/* Why anvil section */}
      <section className="mx-auto max-w-7xl border-t border-zinc-800/40 px-4 py-16 sm:px-6 lg:py-24">
        <div className="max-w-3xl">
          <h2 className="font-display text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
            A CI designed for personal project velocity.
          </h2>
          <p className="mt-4 text-lg text-zinc-400">
            No complex DAGs. No infrastructure mapping. Just a single execution queue connected to your Cloudflare edge
            infrastructure.
          </p>
        </div>

        <div className="mt-16 grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {valueProps.map((feature, i) => (
            <div
              key={feature.title}
              className="group relative animate-slide-up opacity-0"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="font-display text-6xl font-black text-zinc-800/50 transition-colors group-hover:text-accent-500/20">
                0{i + 1}
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold tracking-wide text-zinc-100">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works section */}
      <section className="mx-auto max-w-7xl border-t border-zinc-800/40 px-4 py-16 sm:px-6 lg:py-24">
        <div className="grid gap-16 lg:grid-cols-[1fr_1.5fr]">
          <div className="max-w-md">
            <h2 className="font-display text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
              Implementation path.
            </h2>
            <p className="mt-4 leading-relaxed text-zinc-400">
              Go from an empty queue to a live edge deployment in under three minutes, entirely defined in your git
              history.
            </p>
          </div>

          <div className="relative space-y-16 border-l border-zinc-800/60 pl-8">
            {workflow.map((item, i) => (
              <div
                key={item.step}
                className="relative animate-slide-up opacity-0"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="absolute -left-[37px] top-1.5 rounded-full bg-zinc-950 p-1">
                  <div className="h-2 w-2 rounded-full bg-accent-500" />
                </div>
                <p className="mb-2 font-mono text-xs uppercase tracking-widest text-accent-500">{item.step}</p>
                <h3 className="font-display text-xl font-bold tracking-tight text-zinc-100">{item.title}</h3>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="border border-zinc-800/60 bg-zinc-900/40 p-8 sm:p-12">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-center">
            <div className="max-w-xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent-500/20 bg-accent-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-accent-400">
                <Lock className="h-3.5 w-3.5" />
                invite-only access
              </div>
              <h2 className="font-display text-3xl font-bold tracking-tight text-zinc-100">Ready to execute?</h2>
            </div>
            <div className="shrink-0">
              <LandingActions isAuthenticated={isAuthenticated} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

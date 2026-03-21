import { ArrowRight, Cloud, GitBranch, Lock, Radio, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { StatusPill } from "@/client/components";
import { Badge, Button, Card } from "@/client/components/ui";

const valueProps = [
  {
    icon: GitBranch,
    title: "Pipeline config lives in the repo",
    description: "anvil reads `.anvil.yml` from your branch — review it, revert it, override it per branch.",
  },
  {
    icon: Workflow,
    title: "Serialized runs, no extra locking",
    description: "One active run per project, everything else in a durable FIFO queue.",
  },
  {
    icon: Radio,
    title: "Logs stream while the run is live",
    description: "See what's running, what failed, and what's queued next — during the run, not after.",
  },
  {
    icon: Cloud,
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
        <Button variant="primary">
          Go to Dashboard
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
      <Link to="/app/projects/new">
        <Button variant="secondary">New Project</Button>
      </Link>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/app/invite/accept">
        <Button variant="primary">
          Accept Invite
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
      <Link to="/app/login">
        <Button variant="secondary">Sign In</Button>
      </Link>
    </div>
  );

const ProductPreview = () => (
  <Card
    variant="accent"
    className="relative overflow-hidden border-accent-500/20 bg-gradient-to-br from-zinc-900/95 via-zinc-950 to-zinc-950"
  >
    <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.1)_0%,transparent_70%)]" />

    <div className="relative space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Project overview</p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-100">edge-docs</h2>
          <p className="mt-1 text-sm text-zinc-400">Repo-defined CI for a docs deploy pipeline running on the edge.</p>
        </div>
        <Badge variant="accent">main</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Queued</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">02</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Running</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">01</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Last commit</p>
          <p className="mt-2 font-mono text-sm text-zinc-200">9a8c12e</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-200">Run queue</p>
            <Badge>serialized</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {previewRuns.map((run) => (
              <div key={run.id} className="rounded-xl border border-zinc-800/70 bg-zinc-900/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-100">
                      {run.id} {run.name}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">{run.detail}</p>
                  </div>
                  <StatusPill status={run.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/90 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-200">Live logs</p>
            <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              streaming
            </span>
          </div>
          <div className="mt-4 rounded-xl border border-zinc-800/70 bg-zinc-950/80 p-3 font-mono text-xs leading-6 text-zinc-300">
            {previewLogs.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="success">build passed</Badge>
            <Badge variant="success">test passed</Badge>
            <Badge variant="accent">deploy active</Badge>
          </div>
        </div>
      </div>
    </div>
  </Card>
);

export const LandingPage = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div className="pb-16">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="relative overflow-hidden rounded-[2rem] border border-zinc-800/60 bg-gradient-to-b from-zinc-900/70 via-zinc-950 to-zinc-950 px-6 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          <div className="pointer-events-none absolute -left-20 top-10 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.1)_0%,transparent_70%)]" />
          <div className="pointer-events-none absolute bottom-0 right-0 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.1)_0%,transparent_70%)]" />

          <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,540px)] lg:items-center">
            <div className="max-w-2xl">
              <Badge variant="accent">Invite-only beta</Badge>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-zinc-100 sm:text-5xl lg:text-6xl">
                CI that runs on the edge and lives in your repo.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-zinc-300 sm:text-lg">
                Define your pipeline in <span className="font-mono text-zinc-100">.anvil.yml</span>, push, and watch
                runs queue and execute — logs streaming in real time.
              </p>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-500">
                Powered by <span className="text-zinc-300">Cloudflare</span> — Durable Objects, Queues, D1, and Sandbox
                SDK handle orchestration, storage, and execution.
              </p>

              <div className="mt-8">
                <LandingActions isAuthenticated={isAuthenticated} />
              </div>
            </div>

            <ProductPreview />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Why anvil</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-100">
              Repo-defined pipelines, ordered runs, and live visibility.
            </h2>
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {valueProps.map((feature) => (
            <Card
              key={feature.title}
              className="h-full border-zinc-800/60 bg-zinc-900/50 hover:border-zinc-700/60 hover:bg-zinc-900/80"
            >
              <div className="mb-5 inline-flex rounded-xl bg-accent-500/10 p-2.5 text-accent-400">
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="text-xl font-semibold text-zinc-100">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{feature.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="rounded-[2rem] border border-zinc-800/60 bg-zinc-900/40 p-6 sm:p-8 lg:p-10">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-100">
              Three steps from repo to running pipeline.
            </h2>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {workflow.map((item) => (
              <div key={item.step} className="rounded-2xl border border-zinc-800/60 bg-zinc-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-accent-400">{item.step}</p>
                <h3 className="mt-3 text-xl font-semibold text-zinc-100">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
        <div className="rounded-[2rem] border border-accent-500/20 bg-gradient-to-r from-zinc-900/90 to-zinc-950 px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent-500/20 bg-accent-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-accent-400">
              <Lock className="h-3.5 w-3.5" />
              invite-only access
            </div>
            <LandingActions isAuthenticated={isAuthenticated} />
          </div>
        </div>
      </section>
    </div>
  );
};

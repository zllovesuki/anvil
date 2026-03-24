# 🔨 anvil

**Your CI, on the edge.** Define your pipeline in `.anvil.yml`, push to trigger, and watch runs execute in isolated containers — all on Cloudflare Workers. No servers to manage, no runners to babysit.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zllovesuki/anvil)

> 💡 Container execution requires a [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/) ($5/mo). D1, Queues, KV, and Durable Objects work on Free with limits.

Built with [GPT-5.4](https://openai.com/index/introducing-gpt-5-4/) and [Claude Opus 4.6](https://www.anthropic.com/claude/opus) agentic workflows. 🤖✨

---

## 🎯 What is anvil?

anvil is a Cloudflare-native CI runner built for personal projects and small teams. If you've ever wanted a simple, self-hosted CI that doesn't require maintaining VMs, Docker daemons, or long-running processes — anvil runs entirely on Cloudflare's managed platform.

Push code → anvil picks it up → runs your steps in an isolated container → streams logs back to your browser in real time. That's it.

---

## 📋 Your pipeline in 10 lines

```yaml
# .anvil.yml
version: 1
checkout:
  depth: 1
run:
  workingDirectory: .
  timeoutSeconds: 720
  steps:
    - name: install
      run: npm ci
    - name: test
      run: npm test
    - name: build
      run: npm run build
```

Drop this in your repo root, point anvil at it, and you're running CI. ⚡

---

## ✨ Features

🔧 **Repository-defined pipelines** — version your CI config in `.anvil.yml`, right next to your code

📦 **Isolated sandbox execution** — every run gets a fresh container. No leftover state, no cross-run contamination

📡 **Live log streaming** — watch stdout/stderr flow in real time via WebSocket, with ANSI color support

🔗 **Webhook triggers** — push to GitHub, GitLab, or Gitea and anvil picks it up automatically. Per-provider secrets with rotation and delivery history

▶️ **Manual triggers** — kick off a run from the dashboard with optional branch override

📊 **FIFO run queue** — one active run per project, the rest queue up in order. No race conditions, no surprises

🔒 **Invite-only access** — no open registration. Add teammates via time-bounded invite links

🌐 **Any HTTPS Git repo** — GitHub, GitLab, Gitea, or any repo reachable over HTTPS with optional token auth

🛡️ **Security baked in** — encrypted credentials at rest, automatic secret redaction in logs, strict CSP, PBKDF2 password hashing

---

## 🏗️ How it works

- **Workers** — stateless HTTP frontdoor: routing, auth, queue dispatch
- **ProjectDO** — per-project state machine: active run lock, pending queue, webhook config
- **RunDO** — per-run state: steps, rolling logs, WebSocket fanout to browsers
- **D1** — durable relational index: users, projects, run history, invites
- **KV** — ephemeral session storage with TTL
- **Queue** — FIFO run dispatch, max batch size 1
- **Sandbox** — isolated container per run via `@cloudflare/sandbox`

---

## 🧰 Tech stack

|     | What                                             | Why                                               |
| --- | ------------------------------------------------ | ------------------------------------------------- |
| 🖥️  | React 19, React Router 7, Tailwind CSS 4, Vite 7 | Modern frontend with fast HMR                     |
| ⚙️  | Hono on Cloudflare Workers                       | Lightweight, edge-native HTTP framework           |
| 💾  | D1 (SQLite), Durable Objects (SQLite), KV        | Right storage for each access pattern             |
| 🗄️  | Drizzle ORM                                      | Type-safe database access across D1 and DO SQLite |
| 📦  | Cloudflare Containers, Queues                    | Isolated execution with ordered dispatch          |
| ✅  | `@cloudflare/util-en-garde`                      | Runtime codec validation at every boundary        |
| 🔤  | TypeScript (strict) throughout                   | One language, zero escape hatches                 |

---

## ⚡ Quick start

```bash
git clone <repo-url>
cd anvil
npm install

cp .dev.vars.example .dev.vars       # local encryption keys
npm run db:migrate:d1:local          # set up local D1
npm run db:seed-initial-user -- --local  # create bootstrap invite

npm run dev                          # 🚀 go
```

Open the URL from the terminal, accept the invite, and you're in. 🎉

> 🧪 **Frontend-only?** On localhost, the frontend starts in **mock mode** — a localStorage-backed API that simulates the full backend. No Workers, no D1, no migrations needed. Great for UI work and especially useful for agentic workflows where an AI agent browses the local dev server to verify frontend changes.

---

## 📁 Project structure

```
src/
  client/           🖥️  React frontend (pages, components, hooks)
  worker/           ⚙️  Cloudflare Workers backend
    api/                 Route handlers (public + private)
    auth/                Sessions and password handling
    db/                  D1 and Durable Object schemas (Drizzle)
    durable/             ProjectDO and RunDO
    queue/               Run queue consumer and execution
    sandbox/             Container lifecycle
  contracts/        📝  Shared client/server API types
  lib/              🔧  Shared utilities
tests/
  worker/           ⚡  Fast Vitest unit tests
  e2e/              🎭  Playwright browser tests
  integration/      🔗  Queue runner integration test
drizzle/            📦  Generated migrations (do not edit)
docker/             🐳  Runner container image
reference/          📖  Specs and design docs
```

---

## 📜 Common scripts

| Command               | What it does                                |
| --------------------- | ------------------------------------------- |
| `npm run dev`         | Start local dev server                      |
| `npm run build`       | Production build                            |
| `npm test`            | Fast Vitest suite                           |
| `npm run test:e2e`    | Playwright browser tests                    |
| `npm run typecheck`   | Full TypeScript type check                  |
| `npm run db:generate` | Regenerate Drizzle migrations from schema   |
| `npm run deploy`      | Remote D1 migrate, production build, deploy |
| `npm run format`      | Prettier formatting                         |

See [OPERATOR.md](OPERATOR.md) for the full script reference, deployment guide, database operations, testing strategy, and Cloudflare binding details.

---

## 🚢 Deploying

```bash
npx wrangler login
npm run deploy
```

`npm run deploy` applies remote D1 migrations first, then builds and deploys the Worker. For the full deployment guide, environment setup, and binding reference, see [OPERATOR.md](OPERATOR.md). 📘

---

## 🛡️ Security

anvil takes security seriously even at v1:

- 🔐 AES-GCM encryption at rest for repo tokens and webhook secrets
- 🙈 Automatic secret redaction in all run logs
- 🛑 Strict CSP — no inline scripts, no `eval`
- 🔑 PBKDF2 password hashing (SHA-256, 100k iterations, per-user salt)
- 👥 Invite-only registration — no open signup surface
- 🚪 KV sessions with TTL — Bearer auth, not cookies

For rate limiting and WAF configuration, see [waf.md](waf.md). 🧱

---

## 🤝 Contributing

anvil is under active development. The codebase uses strict TypeScript throughout, with codec-validated boundaries and a clear separation between Workers (stateless) and Durable Objects (stateful, transactional).

If you're diving in, start with the [spec](reference/anvil-spec.md) and the [operator guide](OPERATOR.md).

---

## 📄 License

[MIT](LICENSE) — Rachel Chen, 2026

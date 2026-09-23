# char.pub

An open registry, collaboration network and interoperability layer for AI creations — characters, worlds and stories.

> **GitHub can host a Char, char.pub can discover it, agents can understand it, runtimes can run it — but no single platform owns it.**

- Specs: [`spec/canonical-model.md`](spec/canonical-model.md), [`spec/context-ir-v0.md`](spec/context-ir-v0.md) (CC-BY-4.0)
- Decisions: [`DECISIONS.md`](DECISIONS.md)
- Design: [`docs/design/`](docs/design/)

## Repository layout

| Path | What |
|---|---|
| `packages/core` | Canonical Model, canonicalization & digest, publish checks, Resolver → Context IR, Diff, Contribution merge. Zero IO, runs in Node / browsers / Workers. |
| `apps/*` | server (api / admin / worker), web, admin, edge |
| `spec/` | Specification text, conformance suite, generated JSON Schema |
| `infra/` | Local docker compose, deployment notes |

## Local development

Requirements: Node ≥ 22.12 (24 LTS recommended), pnpm (version pinned in `package.json#packageManager`), Docker.

```sh
corepack enable        # or install pnpm yourself
pnpm install
pnpm infra:up          # Postgres 16 (127.0.0.1:54329) + MinIO (127.0.0.1:59000, console :59001)
                       # + Mailpit (SMTP 127.0.0.1:51025, web UI and API http://127.0.0.1:58025)
pnpm test              # unit tests
pnpm ci:all            # everything CI runs
pnpm infra:down
```

Local-only credentials live in `infra/docker-compose.yml`; production secrets are never committed (see `.env.example` for variable names).

### Run the whole stack

```sh
pnpm dev               # starts the containers if needed, migrates, then runs api, worker and web
                       # open http://localhost:5173 (API on :3000, worker health on :3001)
pnpm dev:login alice   # in another terminal: creates a local account and prints one line to paste
                       # into the browser console to sign in, no OAuth app needed
```

- The api and worker run from TypeScript source and restart when you change server code; the web app hot-reloads.
- If a port is taken, use another one: `DEV_API_PORT=3200 DEV_WORKER_PORT=3201 DEV_WEB_PORT=5174 pnpm dev`. Pass the same variables to `pnpm dev:login`.
- The first run generates a local session secret in `.dev/state.json` (git-ignored). Variables in a git-ignored `.env` at the repository root override the defaults, for example a GitHub OAuth client whose callback is `http://localhost:5173/v1/auth/callback/github`.
- Ctrl-C stops the processes; the containers keep running until `pnpm infra:down`.

### Guest verification locally (optional)

Guest verification needs Turnstile and an SMTP server. Locally, every email goes to Mailpit, which never delivers anything outside your machine; open http://127.0.0.1:58025 to read it. Cloudflare publishes testing keys that always pass. The server accepts results from those keys only when `NODE_ENV=development` and rejects them in every other environment.

```sh
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA   # Cloudflare's public "always passes" testing secret
SMTP_URL=smtp://127.0.0.1:51025
EMAIL_FROM="char.pub (local) <no-reply@localhost>"
GUEST_HMAC_KEY=$(openssl rand -base64 32)
```

In the browser, render the widget with the matching testing site key `1x00000000000000000000AA`. It produces the token `XXXX.DUMMY.TOKEN.XXXX`, the only token the testing secret accepts. These are the values from Cloudflare's public testing documentation, not secrets. Never use them outside local development.

## License

Code: [Apache-2.0](LICENSE). Specification and conformance suite: [CC-BY-4.0](spec/LICENSE).

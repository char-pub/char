# char.pub

**An open registry, collaboration network and interoperability layer for AI creations.**

**English** · [简体中文](README.zh-CN.md)

Create characters, worlds, lorebooks, relationships, scenarios, personas, styles, presets and prompt modules. Compose reusable content and policy, then publish versions other tools can understand and run.

> GitHub can host a Char, char.pub can discover it, agents can understand it, runtimes can run it — but no single platform owns it.

[Canonical Model](spec/canonical-model.md) · [Context IR](spec/context-ir-v0.md) · [Assembly assets and author tests](spec/assembly-assets-v0.md) · [Architecture](llmdoc/execution-model.mdx) · [Release readiness](llmdoc/engineering/release-readiness.mdx)

## What you can build

- **Create through your preferred workflow.** Use the Web editor, import CCv3 cards or PNGs, or author in GitHub with the CLI and Publish Action. These paths share one canonical content model.
- **Compose and publish.** Reference specific versions of worlds and lorebooks, inspect dependencies, and publish immutable Releases with content digests.
- **Pin and verify a runtime setup.** Lock a Scenario to an exact Preset, runtime profile and implementation versions; test activation, ordering, budgets and visibility with public synthetic Sessions without calling a model.
- **Collaborate with review.** Propose changes through Contributions, inspect conflicts and sensitive changes, and accept them into a draft before publishing.
- **Understand the resulting context.** Preview the resolved content and its origins, inspect assembly traces, and compare versions with Context Diff.
- **Use content across runtimes.** Download public Context IR and assets without signing in, or export CCv3 with a Loss Report that explains conversion limits.

The Registry owns content, permissions and publication state. Runtime applications consume the published context and run conversations. The pure Core and reference Assembler support Node, browsers and Workers; see the [execution model](llmdoc/execution-model.mdx) for the boundaries.

## Project status

char.pub is under active development toward **v0**. The Canonical Model and Context IR are **draft specifications**. Conformance expectations still require human acceptance; a passing draft run does not establish a frozen protocol.

The implementation includes the Registry, creator Web app, Admin app, CLI and GitHub publishing workflow. Final readiness also depends on human review, production end-to-end checks, backup recovery, operational setup and package publication. Track those gates in [release readiness](llmdoc/engineering/release-readiness.mdx).

## Run locally

You need **Node.js ≥ 22.12** (CI uses Node 24), **pnpm** at the version pinned in [`package.json`](package.json), and a running **Docker** engine with Compose.

```sh
git clone --recurse-submodules https://github.com/char-pub/char.git
cd char
pnpm install
pnpm dev
```

For an existing checkout, run `git submodule update --init` first. The brand-assets submodule is required by the frontends.

`pnpm dev` starts local Postgres, MinIO and Mailpit when needed, applies database migrations, then starts the API, worker and Web development server. Open **http://localhost:5173**.

MinIO is built locally from pinned upstream source for both development and integration tests. The first run needs network access and extra build time; later runs reuse Docker build layers.

In a second terminal, create a local account:

```sh
pnpm dev:login alice
```

Follow the command's browser-console instruction to sign in. This local shortcut does not require an OAuth app.

| Service | Local address |
| --- | --- |
| Web | http://localhost:5173 |
| API | http://127.0.0.1:3000 |
| Worker health | http://127.0.0.1:3001/healthz |
| Mailpit inbox | http://127.0.0.1:58025 |
| MinIO console | http://127.0.0.1:59001 |
| Postgres | `127.0.0.1:54329` |

The API and worker restart on source changes; Web uses Vite hot reload. Local credentials are in [`infra/docker-compose.yml`](infra/docker-compose.yml), and generated development secrets live in the ignored `.dev/state.json`. A root `.env` can override local configuration; see [`.env.example`](.env.example) for variable names.

If a port is busy:

```sh
DEV_API_PORT=3200 DEV_WORKER_PORT=3201 DEV_WEB_PORT=5174 pnpm dev
```

Use the same overrides with `pnpm dev:login`. Ctrl-C stops the application processes; `pnpm infra:down` stops the containers. Admin and production integrations have separate setup in the [deployment guide](infra/DEPLOY.md).

<details>
<summary>Optional: guest verification with local email</summary>

Mailpit captures local email without delivering it externally. To exercise guest verification, add the following to your ignored root `.env`:

```dotenv
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
SMTP_URL=smtp://127.0.0.1:51025
EMAIL_FROM="char.pub (local) <no-reply@localhost>"
GUEST_HMAC_KEY=<base64-encoded 32-byte random key>
```

Generate the HMAC key locally with `openssl rand -base64 32`, then start Web with the matching public Turnstile testing site key:

```sh
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm dev
```

These Turnstile values are public testing keys, not credentials. The server accepts their dummy token only in development. All four server variables must be configured together; leave them all unset to disable guest verification. Read messages in Mailpit at http://127.0.0.1:58025.

</details>

## Development checks

Run commands from the repository root:

| Command | Purpose |
| --- | --- |
| `pnpm test` | Unit tests for packages, server, Web and Admin |
| `pnpm typecheck` | TypeScript checks |
| `pnpm deps` | Package and application dependency boundaries |
| `pnpm test:conformance` | Node, browser and workerd conformance runs |
| `pnpm test:integration` | Server integration tests with real services |
| `pnpm e2e:fullstack` | Local browser → API → worker → storage flows |
| `pnpm dev:smoke` | Check local startup, login and shutdown |
| `pnpm ci:all` | Full local gate: lint, types, boundaries, tests, build, E2E, Action bundle and secrets |

Docker is needed for integration and full-stack checks. Browser checks need Playwright Chromium; the CI setup uses `pnpm --dir spec/conformance exec playwright install --with-deps chromium`. Install `gitleaks` to run the secret scan and commit hooks. CodeQL and dependency review run separately in GitHub Actions.

Choose checks by the boundary you changed. Protocol changes must update specifications and conformance cases together; expected outputs require human review. See the [verification strategy](llmdoc/engineering/verification.mdx) and [working agreements](llmdoc/engineering/working-agreements.mdx).

## Repository map

| Path | Responsibility |
| --- | --- |
| [`packages/core`](packages/core) | Canonical schemas, digests, publishing checks, Resolver, Diff and Contribution merge; no I/O |
| [`packages/assembler`](packages/assembler) | Reference context assembly and traces |
| [`packages/ccv3`](packages/ccv3) | CCv3 import/export and conversion reports |
| [`packages/cli`](packages/cli) | Local authoring and Registry commands |
| [`packages/contracts`](packages/contracts) | Shared HTTP contracts |
| [`apps/server`](apps/server) | Public API, Admin API and worker processes |
| [`apps/web`](apps/web) · [`apps/admin`](apps/admin) | Creator and operations interfaces |
| [`actions/publish`](actions/publish) | GitHub Actions publishing through OIDC |
| [`spec`](spec) | Specifications, generated JSON schemas and conformance suite |
| [`content/commons`](content/commons) | Seed content and its human review process |
| [`infra`](infra) · [`.railway`](.railway) | Local services, deployment and infrastructure configuration |
| [`llmdoc`](llmdoc) | Architecture, contracts, engineering rules and operational guides |

## Find project knowledge

Start with [the execution model](llmdoc/execution-model.mdx), [architecture decisions](DECISIONS.md), or the public [Canonical Model](spec/canonical-model.md) and [Context IR](spec/context-ir-v0.md) specifications.

Use llmdoc to find the relevant design or operational guide before exploring a subsystem:

```sh
npx -y @tokenroll/llmdoc tree
npx -y @tokenroll/llmdoc search "publishing"
npx -y @tokenroll/llmdoc context --files apps/server/src/main.ts
```

llmdoc is external tooling, not a project dependency. Durable project knowledge lives in `llmdoc/`; previous design assets and historical execution logs remain available in Git history.

## License

Code is licensed under [Apache-2.0](LICENSE). Specification text and the conformance suite are licensed under [CC-BY-4.0](spec/LICENSE).

The logo and icons come from the [`char-pub/brand-assets`](https://github.com/char-pub/brand-assets) submodule. They retain that repository's own LICENSE and NOTICE and are not covered by this repository's licenses.

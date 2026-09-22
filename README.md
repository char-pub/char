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
pnpm test              # unit tests
pnpm ci:all            # everything CI runs
pnpm infra:down
```

Local-only credentials live in `infra/docker-compose.yml`; production secrets are never committed (see `.env.example` for variable names).

## License

Code: [Apache-2.0](LICENSE). Specification and conformance suite: [CC-BY-4.0](spec/LICENSE).

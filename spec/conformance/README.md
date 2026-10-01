# char.pub Conformance Suite

This directory is the public conformance suite for the char.pub Canonical Model and Context IR
(1-draft). Any implementation of the Resolver, the publish checks, an Assembler or a CCv3
converter can run these cases and compare its output.

Licensed under [CC-BY-4.0](../LICENSE), like the specification.

## Layout

```text
spec/conformance/
├── README.md
├── cases/<NNN-slug>/
│   ├── case.json            metadata (see below)
│   ├── input/
│   │   ├── root.json        the release being resolved or published
│   │   ├── deps/*.json      releases in its dependency closure (loaded in file-name order)
│   │   ├── registry.json    publish cases: label, used labels, asset states, blocked digests, owner namespaces
│   │   ├── options.json     build/resolver options, including the exact default_policy pin
│   │   ├── assemble.json    assembler cases: named scenarios: profile, turn, optional selection refs and source_texts
│   │   └── card.json        ccv3 cases: the input character card
│   ├── expected/            human-reviewed expected output (only for reviewed cases)
│   │   ├── context-ir.json  resolver cases that succeed
│   │   ├── error.json       cases that must fail: { "code", "subject"? }
│   │   ├── publish.json     publish cases: { "ok", "errors": [codes], "warnings": [codes] }
│   │   ├── trace.json       assembler cases: per scenario, messages_digest and trace decisions, or an error code
│   │   └── loss-report.json ccv3 cases: the comparable part of the round trip (see below)
│   └── draft/               current implementation output awaiting review (never committed)
├── runner/
│   ├── types.ts             data format
│   ├── run.ts               pure runner: run a case and judge the result (no file system, no Node APIs)
│   ├── assemble.ts          assembler scenarios and trace comparison
│   ├── ccv3.ts              CCv3 round trip and loss summary comparison
│   ├── cases.gen.json       all cases bundled into one file (generated, committed)
│   └── conformance.test.ts  the test, run in Node, Chromium and workerd
└── scripts/                 Node-only tooling: bundle, draft, accept
```

Case IDs: `001`–`013` follow the first batch listed in the Context IR specification
(section “Conformance tests”); a letter suffix splits one listed case into several focused cases.
`101`–`109` are one counter-example for each of the nine publish rules.

### `case.json`

| Field | Meaning |
|---|---|
| `id` | Equal to the directory name. |
| `title` | What the case demonstrates. |
| `kind` | `resolver`, `publish`, `assembler` or `ccv3`. |
| `expect` | Result shape: `context-ir`, `error`, `publish`, `trace` or `loss-report`. |
| `spec_refs` | Clauses of the specification or decisions the case verifies. |
| `status` | `draft` (inputs exist, expected output not reviewed) or `reviewed`. |
| `reviewed_by`, `reviewed_at` | Who approved the expected output, and when (`YYYY-MM-DD`). |
| `expected_digest` | For `context-ir` cases: `sha256:` of the expected file content. |
| `notes` | What a reviewer should check. |

## Comparison rules

- **Context IR** — the implementation serializes the IR with RFC 8785 (JCS). The output must be
  byte-for-byte identical to `expected/context-ir.json`. The expected file is a single line of
  JCS text; the only normalization is removing one trailing `\n` from the file if present.
- **Errors** — `code` must match. When the expected file has a `subject`, it must match too.
- **Publish reports** — `ok` must match, and the lists of error-level and warning-level issue
  codes must match in order.
- **Assembler messages and traces** — `input/assemble.json` lists named scenarios
  (`{ "scenarios": [{ "name", "profile", "turn", "preset"?, "selection"?, "source_texts"? }] }`).
  `preset`, when present, is a complete `{ creation, release, semantic_digest }` snapshot,
  verified by `resolvePreset`. Each case first builds a complete CreationArtifact. Its
  `input/options.json` explicitly declares an exact `default_policy` whose published snapshot
  is in `input/deps/`; the runner never manufactures a missing policy. The empty conformance
  policy is test content, not a production fallback. Pure resolver cases still call `resolve`.
  The runner derives a validated SelectionPlan from optional fixed `selection` refs and the
  current catalog. `source_texts` maps IR asset IDs to exact UTF-8 bodies, verified by assembly.
  Assembly uses the `estimate` tokenizer. `expected/trace.json` records
  `{ "scenarios": [{ "name", "messages_digest", "entries": [{ "id", "decision", "reason" }] }] }`,
  or `{ "name", "error": { "code" } }` for a failing scenario. Successful cases compare both
  the ordered final message digest and the ordered trace decisions. A reviewed success without
  `messages_digest` fails comparison; migration does not fill accepted expectations automatically.
  Message digests include content and attachment identities but exclude deployment-specific URLs.
  Independently of review status, successful assembly fails if a `{{late:*}}` placeholder reaches
  Creative or Session content. Exact source-delimited policy text is excluded from that check.
  Preset fixture tests additionally assert message order, selected policy identity, source-body
  validation and budget/capability errors in all three runtimes. Draft execution remains separate
  from human acceptance of expected output.
- **CCv3 round trips** — the card in `input/card.json` is imported, canonicalized, resolved and
  exported. `expected/loss-report.json` holds only the stable part: from the import, the omitted
  policy field names, each lorebook entry's source id / derived fragment id / activation, and
  the fragments marked `stable: false`; from the Loss Report, flattened dependencies (without
  token counts), activation downgrades, private visibility, extra participants, context assets,
  dropped locales, policy fields with their `restored` flag and other losses (subjects only);
  from the exported card, whether `system_prompt` and `post_history_instructions` are empty.
  Token estimates and human-readable details are never compared. The summary is compared as
  RFC 8785 canonical JSON.

Cases with `status: "draft"` are executed (they must not crash) but not compared.

## Expected output must be reviewed by a human

Expected output is the specification. It is never produced by copying whatever the current
implementation emits, because that would freeze bugs into the spec.

1. Write or change the case inputs under `cases/<case>/input/` and `case.json`
   (`status: "draft"`, with `notes` describing what the output must show).
2. `pnpm conformance:draft <case>` runs the current implementation and writes the output to
   `cases/<case>/draft/`. This directory is git-ignored.
3. A reviewer reads the draft against the specification and the case notes. If it is wrong, fix
   the implementation (or the case) and draft again.
   `pnpm conformance:precheck` checks drafted Context IR for mechanical invariants, and
   `pnpm conformance:review` writes `REVIEW.md` (not committed) with a readable summary of every
   draft — including a table of trace decisions per assembler scenario — to review against.
4. When the output is correct:
   `pnpm conformance:accept <case> --reviewer <name>`
   moves the draft to `expected/`, sets `status: "reviewed"`, records reviewer, date and the
   expected digest, and regenerates `runner/cases.gen.json`.
5. After editing any case by hand, run `pnpm conformance:bundle`. A test fails when the bundle
   is out of date.

## Running

```sh
pnpm test:conformance      # Node, Chromium (Playwright) and workerd
```

Chromium must be installed once: `pnpm exec playwright install chromium`.

Each runtime also recomputes the digest of every reviewed Context IR case and compares it with
`expected_digest`; all three passing shows that the runtimes produce identical bytes.

The workerd run does not enable `nodejs_compat` for the code under test. The test harness itself
needs some Node APIs and the pool adds them to its runner worker, so the absence of Node APIs in
the core library is enforced separately by the repository's dependency rules.

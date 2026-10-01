# Story v1 portable fixtures

These JSON inputs cover the three fixture families in [Story §14](../../story-v1.md): evaluation, viewpoint filtering, and Catalog/context preparation. Each case uses the shared conformance loader and runner in Node, Chromium, and workerd. They are **draft**, not accepted conformance baselines.

## Cases

| Case | Inputs and independently authored semantic assertions |
| --- | --- |
| `201-open-story` | A two-person scene with no variables, branches, or authored options. Free input has no declarative effect; explicit presence changes remain possible. |
| `202-story-lifecycle` | Three-valued judgments, explicit confirmation and duplicate rejection, scene conditions/entry knowledge, actual presence, bool/int/enum/item-set/value-set state, bounded increments, ordered effects, continue/stop endings, and invalid snapshot rejection. Plotline/Timeline order does not authorize or prohibit an operation. A condition above the declared integer maximum emits a warning but remains a valid, false condition. |
| `203-story-view` | A real built Scenario and three full TurnViews: Bob before entry, Bob following Alice into an Alice-only authored scene, and Bob no longer present. Private Alice material remains private after Bob learns the separately controlled secret. |
| `206-exact-plan-replay` | Reuses the original successful Plan across scenarios. CRLF/LF, NFD/NFC, and trailing-space changes in history/focus/overlay reject it; identical strings with reordered JSON keys replay unchanged. |
| `205-progressive-source` | Three nested groups expose descriptions before selecting their leaf; a separate Source branch loads only the selected Markdown section from exact BOM/CRLF/NFD bytes. Unselected and private Source text remains absent. |
| `204-story-context` | The same views through the actual Catalog, fixed SelectionPlan, and final messages. Unknown/private material is excluded from Selector inputs; known selected material appears; required/direct material survives an explicit skip with discovery disabled. |

Each directory has `case.json` and `input/story.json`. View/context cases additionally contain the actual root, dependency snapshots, and an exact default-policy pin. Runtime participant/late-slot identities follow the public stable-key contract; inputs include the implicit user binding required by full preparation.

## Running and reviewing

From the repository root:

```sh
pnpm conformance:bundle
pnpm exec vitest run --project conformance-node --project conformance-browser --project conformance-workerd spec/conformance/runner/story-portability.test.ts
```

`input/assertions.json` was authored from the specification before executing the fixtures. The shared `story-portability.test.ts` checks these selected semantic claims, including error codes, unchanged input, actual messages, and filtered provider surfaces. These assertions are executable tests, **not human acceptance** of a complete output. They intentionally do not invent message digests or derive expected state from the implementation's result.

The normal conformance runner exposes the complete per-step state or per-scenario view/Catalog/Plan/messages/Trace result. Its draft/review workflow may produce candidate output under `draft/` for inspection. Only the separate, explicit human review/accept workflow can establish `expected/story.json` and reviewed metadata. No case here was accepted while authoring this slice; a draft run or three-runtime semantic test pass is not a claim of complete Story support.

The `input` evaluation operation records text and deliberately performs no state operation. This proves only that the declarative evaluator does not automatically interpret free text as `confirm` or `enter`. It does not exercise an AI interpreter or prove that a live Runtime understands arbitrary player actions. Actual semantics are exercised by public `evaluateCondition`, `availableChoices`/`availableTargets`, `confirm`, `enterScene`, `setPresent`, `validateStoryState`, `viewOf`, and preparation calls.

Groups currently contain fragments and nested groups, not Sources. Case 205 exercises the real group → group → group → fragment expansion path and the separate work → Source → section path; it does not invent a group-to-Source edge. The fixed selector records each real expansion in the Plan.

Stale Plan rejection, additional Source authorization boundaries, and repeated Character instances have other targeted fixtures/tests; these six cases do not replace those gates or complete U2/U5/U7 individually.

Context scenarios may declare `plan_from: "earlier-scenario-name"` to reuse that scenario’s unchanged Plan. It is mutually exclusive with `selection` and `plan`; the named scenario must precede this one and must have completed successfully. A forward, self, unknown, or failed source cannot manufacture a plan. Reused plans are validated against the new scenario before Source loading or message preparation; no implicit rebinding takes place.

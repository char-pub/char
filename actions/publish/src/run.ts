/**
 * `char-pub/publish` Action：在 CI 中检查并构建 char.yaml，然后用 GitHub OIDC token 向
 * Registry 发布。仓库不需要保存任何长期密钥。
 *
 * 信任模型：OIDC token 只能证明“绑定的仓库在允许的 ref 和事件上运行了某个 workflow”，
 * 不能证明运行的就是这个 Action。所以 Registry 不采信这里算出的 digest，而是用 GitHub App
 * 在 `GITHUB_SHA` 对应的 commit 上重新读取源文件并重新计算，不一致就拒绝。
 */
import * as core from "@actions/core";
import { buildLocal, cmdTest } from "@char-pub/cli";
import { type OidcPublishRequest, ProblemSchema, PublishResponseSchema } from "@char-pub/contracts";
import { CharError, isCharError, isLabel } from "@char-pub/core";
import { setOutput } from "./output.js";

export interface ActionEnv {
  GITHUB_SHA?: string;
  GITHUB_REF?: string;
  GITHUB_REF_NAME?: string;
  GITHUB_REF_TYPE?: string;
  GITHUB_EVENT_NAME?: string;
  GITHUB_WORKSPACE?: string;
}

export interface ActionInputs {
  path: string;
  label: string;
  visibility: string;
  registry: string;
  dryRun: boolean;
  dependencies?: string[];
}

export interface ActionDeps {
  getIdToken: (audience: string) => Promise<string>;
  fetch: typeof fetch;
  log: (line: string) => void;
  setOutput: (name: string, value: string) => void;
  /** 生成幂等键：同一次 run 重试时要得到同一个值。 */
  idempotencyKey: string;
}

const ALLOWED_EVENTS = new Set(["push", "workflow_dispatch", "release"]);

/** 标签推送时默认用标签名作 label，并去掉常见的 `v` 前缀。 */
export function defaultLabel(env: ActionEnv): string | undefined {
  if (env.GITHUB_REF_TYPE !== "tag" || !env.GITHUB_REF_NAME) return undefined;
  const name = env.GITHUB_REF_NAME.replace(/^v(?=\d)/, "");
  return isLabel(name) ? name : undefined;
}

export async function run(inputs: ActionInputs, env: ActionEnv, deps: ActionDeps): Promise<void> {
  const event = env.GITHUB_EVENT_NAME ?? "";
  if (!ALLOWED_EVENTS.has(event)) {
    // pull_request / pull_request_target 等事件可能运行不受信任的代码，不允许发布。
    throw new CharError({
      code: "action.event_not_allowed",
      subject: event || "unknown",
      detail: "publishing is only allowed on push, workflow_dispatch and release events",
    });
  }
  const commit = env.GITHUB_SHA ?? "";
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new CharError({ code: "action.missing_sha", subject: "GITHUB_SHA" });
  }
  const label = inputs.label || defaultLabel(env);
  if (!label || !isLabel(label)) {
    throw new CharError({
      code: "action.label_required",
      subject: "label",
      detail: "set the 'label' input, or trigger the workflow from a tag",
    });
  }
  if (inputs.visibility !== "public" && inputs.visibility !== "private") {
    throw new CharError({ code: "action.invalid_visibility", subject: inputs.visibility });
  }

  const { creation, artifact, warnings } = await buildLocal(inputs.path, inputs.dependencies);
  const testStatus = await cmdTest(
    { file: inputs.path, ...(inputs.dependencies ? { deps: inputs.dependencies } : {}) },
    { log: deps.log, error: deps.log },
  );
  if (testStatus !== 0)
    throw new CharError({ code: "action.assembly_tests_failed", subject: inputs.path });
  deps.log(`built ${creation.ref}@${label}  ${artifact.root.semantic_digest}`);
  for (const w of warnings) deps.log(`warning: ${w.code} ${w.subject}`);
  deps.setOutput("semantic-digest", artifact.root.semantic_digest);
  if (inputs.dryRun) {
    deps.log("dry run: not publishing");
    return;
  }

  const registry = inputs.registry.replace(/\/+$/, "");
  const token = await deps.getIdToken(registry);
  const body: OidcPublishRequest = {
    creation: creation.ref,
    label,
    visibility: inputs.visibility,
    commit,
    path: inputs.path,
    semantic_digest: artifact.root.semantic_digest,
  };
  const res = await deps.fetch(`${registry}/v1/publish/oidc`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": deps.idempotencyKey,
      "user-agent": "char-pub-publish-action",
    },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const p = ProblemSchema.safeParse(json);
    throw new CharError({
      code: p.success ? p.data.code : `http.${res.status}`,
      subject: `${creation.ref}@${label}`,
      ...(p.success && p.data.detail ? { detail: p.data.detail } : {}),
    });
  }
  const out = PublishResponseSchema.parse(json);
  deps.setOutput("release", out.release);
  for (const i of out.report?.issues ?? []) deps.log(`${i.severity}: ${i.code} ${i.subject}`);
  deps.log(
    out.idempotent
      ? `already published: ${creation.ref}@${label} (${out.release})`
      : `publish ${out.state}: ${creation.ref}@${label} (${out.release})`,
  );
}

/** Action 入口。 */
export async function main(): Promise<void> {
  const env = process.env as ActionEnv;
  try {
    await run(
      {
        path: core.getInput("path") || "char.yaml",
        label: core.getInput("label"),
        visibility: core.getInput("visibility") || "public",
        registry: core.getInput("registry") || "https://api.char.pub",
        dryRun: core.getBooleanInput("dry-run"),
        dependencies: core.getMultilineInput("dependencies"),
      },
      env,
      {
        getIdToken: (aud) => core.getIDToken(aud),
        fetch,
        log: (l) => core.info(l),
        setOutput,
        idempotencyKey: `gha:${process.env.GITHUB_REPOSITORY_ID ?? ""}:${process.env.GITHUB_RUN_ID ?? ""}:${process.env.GITHUB_RUN_ATTEMPT ?? ""}`,
      },
    );
  } catch (e) {
    core.setFailed(
      isCharError(e) ? `${e.code}: ${e.subject}${e.detail ? ` — ${e.detail}` : ""}` : String(e),
    );
  }
}

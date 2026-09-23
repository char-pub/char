/**
 * 把 `infra/cloudflare/*.json` 中的 zone 规则同步到 Cloudflare（`pnpm cf:rules`）。
 *
 * 默认只读：取回线上规则，与仓库中的定义比较并打印差异。加 `--apply` 才写入。
 * 写入只替换本仓库管理的规则（按 `ref` 以 `charpub_` 开头识别），同一阶段里其他人手工
 * 加的规则原样保留。
 *
 * 调用经由 tool-bridge 的 Cloudflare API 工具（`tb call hushed-chat/cloudflare/execute`），
 * 所以本机不需要保存 Cloudflare token。源站校验头的值从本机文件读取，只在写入的请求中出现，
 * 不打印、不写入仓库。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ZONE = "char.pub";
const MANAGED = /^charpub_/;
/**
 * 部署初期在控制台手工建的规则，内容与本仓库管理的某条规则相同。按描述识别，写入时由
 * 仓库管理的那条替换，避免同一个主机名上出现两条重复规则。
 */
const ADOPTED = ["staging origin auth"];

interface Rule {
  ref: string;
  description: string;
  expression: string;
  action: string;
  enabled: boolean;
  action_parameters?: unknown;
  ratelimit?: unknown;
}

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(`${ROOT}infra/cloudflare/${name}`, "utf8")) as T;

/** 源站校验规则：每个环境一条，把该环境的密钥写进回源请求头。 */
function originAuthRules(): Rule[] {
  const cfg = readJson<{
    environments: Record<string, { hosts: string[]; secret_file: string }>;
  }>("origin-auth.json");
  return Object.entries(cfg.environments).map(([env, e]) => ({
    ref: `charpub_origin_auth_${env}`,
    description: `char.pub ${env}: origin auth header`,
    expression: `http.host in {${e.hosts.map((h) => `"${h}"`).join(" ")}}`,
    action: "rewrite",
    enabled: true,
    action_parameters: {
      headers: {
        "X-Origin-Auth": {
          operation: "set",
          value: readFileSync(e.secret_file.replace(/^~/, homedir()), "utf8").trim(),
        },
      },
    },
  }));
}

const PHASES: Record<string, () => Rule[]> = {
  http_request_firewall_custom: () => readJson<{ rules: Rule[] }>("waf-custom.json").rules,
  http_ratelimit: () => readJson<{ rules: Rule[] }>("ratelimit.json").rules,
  http_request_late_transform: originAuthRules,
};

/**
 * 在 Cloudflare 一侧执行的代码：读取每个阶段的入口规则集；apply 时用“本仓库管理的规则 +
 * 其他已有规则”整体替换。返回每个阶段的规则摘要（不含请求头的值）。
 */
const REMOTE = `async () => {
  const input = __INPUT__;
  const zone = (await cloudflare.request({ method: "GET", path: "/zones", query: { name: input.zone } })).result[0];
  const managed = new RegExp(input.managed);
  const summary = (r) => ({ ref: r.ref, description: r.description, expression: r.expression, action: r.action, enabled: r.enabled, ratelimit: r.ratelimit ?? null, headers: Object.keys(r.action_parameters?.headers ?? {}) });
  const out = {};
  for (const [phase, desired] of Object.entries(input.phases)) {
    const path = "/zones/" + zone.id + "/rulesets/phases/" + phase + "/entrypoint";
    let current = [];
    try {
      const r = await cloudflare.request({ method: "GET", path });
      if (r.success) current = r.result.rules ?? [];
    } catch (e) {
      // 还没有入口规则集：第一次写入时由 PUT 创建。
    }
    const adopted = (r) => input.adopted.includes(r.description ?? "");
    const others = current.filter((r) => !managed.test(r.ref ?? "") && !adopted(r));
    const replacing = current.filter(adopted).map((r) => r.description);
    if (input.apply) {
      const keep = others.map(({ id, version, last_updated, ...rest }) => rest);
      const put = await cloudflare.request({ method: "PUT", path, body: { rules: [...desired, ...keep] } });
      if (!put.success) throw new Error(phase + ": " + JSON.stringify(put.errors));
      current = put.result.rules;
    }
    out[phase] = { managed: current.filter((r) => managed.test(r.ref ?? "")).map(summary), others: others.map((r) => r.description), replacing };
  }
  return out;
}`;

function callRemote(apply: boolean, phases: Record<string, Rule[]>): Record<string, unknown> {
  const code = REMOTE.replace(
    "__INPUT__",
    JSON.stringify({ zone: ZONE, managed: MANAGED.source, adopted: ADOPTED, apply, phases }),
  );
  const raw = execFileSync(
    "tb",
    ["call", "hushed-chat/cloudflare/execute", JSON.stringify({ code }), "--json"],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "string" && parsed.startsWith("Error")) throw new Error(parsed);
  return (typeof parsed === "string" ? JSON.parse(parsed) : parsed) as Record<string, unknown>;
}

/** 与键的顺序无关的序列化：Cloudflare 返回的字段顺序与提交时不同。 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** 用于比较的规则形状：请求头只比较名字，值不参与（也不打印）。 */
function shape(r: Rule) {
  return {
    ref: r.ref,
    description: r.description,
    expression: r.expression,
    action: r.action,
    enabled: r.enabled,
    ratelimit: r.ratelimit ?? null,
    headers: Object.keys((r.action_parameters as { headers?: object } | undefined)?.headers ?? {}),
  };
}

function main(): void {
  const apply = process.argv.includes("--apply");
  const desired = Object.fromEntries(Object.entries(PHASES).map(([p, f]) => [p, f()]));
  // 只读比较时不需要规则内容，只传阶段名，密钥只在真正写入时离开本机。
  const phasesOnly = Object.fromEntries(Object.keys(desired).map((p) => [p, []]));
  const before = callRemote(false, phasesOnly) as Record<
    string,
    { managed: unknown[]; others: string[]; replacing: string[] }
  >;
  let changed = false;
  for (const [phase, rules] of Object.entries(desired)) {
    const want = stable(rules.map(shape));
    const have = stable(before[phase]?.managed ?? []);
    const same = want === have;
    if (!same) changed = true;
    process.stdout.write(
      `${same ? "same   " : "change "} ${phase}: ${rules.map((r) => r.ref).join(", ")}\n`,
    );
    const others = before[phase]?.others ?? [];
    if (others.length > 0) process.stdout.write(`        kept as is: ${others.join("; ")}\n`);
    const replacing = before[phase]?.replacing ?? [];
    if (replacing.length > 0) {
      changed = true;
      process.stdout.write(`        replaces manual rule: ${replacing.join("; ")}\n`);
    }
  }
  if (!apply) {
    process.stdout.write(
      changed ? "\ndry run: re-run with --apply to write these rules\n" : "\nup to date\n",
    );
    return;
  }
  const after = callRemote(true, desired) as Record<string, { managed: unknown[] }>;
  for (const [phase, rules] of Object.entries(desired)) {
    const ok = stable(after[phase]?.managed ?? []) === stable(rules.map(shape));
    process.stdout.write(`${ok ? "applied" : "MISMATCH"} ${phase}\n`);
    if (!ok) process.exitCode = 1;
  }
}

main();

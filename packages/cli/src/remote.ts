/**
 * 与 Registry API 通信的命令：`char login` 与 `char publish`。
 *
 * 认证用个人访问 Token（`cp_pat_…`）。Token 保存在用户配置目录下的 `credentials.json`，
 * 文件权限 0600；也可以用环境变量 `CHAR_PUB_TOKEN` 提供（CI 中使用）。Token 从不写进
 * 项目目录，也不会出现在命令行参数里（避免进入 shell 历史）。
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ProblemSchema, PublishResponseSchema } from "@char-pub/contracts";
import { CharError, isCharError, isLabel } from "@char-pub/core";
import { buildLocal, type Output } from "./commands.js";

export const DEFAULT_REGISTRY = "https://api.char.pub";
export const TOKEN_RE = /^cp_pat_[0-9A-Za-z]{43}$/;

export interface Credentials {
  registry: string;
  token: string;
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? homedir(), ".config");
  return path.join(base, "char-pub", "credentials.json");
}

export async function loadCredentials(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Credentials | null> {
  if (env.CHAR_PUB_TOKEN) {
    return { registry: env.CHAR_PUB_REGISTRY ?? DEFAULT_REGISTRY, token: env.CHAR_PUB_TOKEN };
  }
  try {
    const raw = JSON.parse(await readFile(credentialsPath(env), "utf8")) as Credentials;
    return typeof raw.token === "string" && typeof raw.registry === "string" ? raw : null;
  } catch {
    return null;
  }
}

export interface LoginOptions {
  registry: string;
  /** 从标准输入读取的 Token。 */
  token: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

/** 校验 Token 后保存。Token 无效时不保存。 */
export async function cmdLogin(o: LoginOptions, out: Output): Promise<number> {
  const token = o.token.trim();
  if (!TOKEN_RE.test(token)) {
    out.error("error  cli.invalid_token  expected a token starting with cp_pat_");
    return 1;
  }
  const registry = o.registry.replace(/\/+$/, "");
  const res = await (o.fetch ?? fetch)(`${registry}/v1/me/tokens`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  // 列出 Token 需要浏览器会话，Token 本身会被拒绝（403）；401 才表示 Token 无效。
  if (!res || res.status === 401) {
    out.error("error  auth.invalid_token  the registry rejected this token");
    return 1;
  }
  const file = credentialsPath(o.env);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({ registry, token } satisfies Credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(file, 0o600);
  out.log(`logged in to ${registry}`);
  return 0;
}

export interface PublishOptions {
  file: string;
  label: string;
  visibility: "public" | "private";
  deps?: string[];
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** 同一次发布重试时保持不变。缺省由 Creation、label 与内容 digest 派生。 */
  idempotencyKey?: string;
}

async function api<T>(
  f: typeof fetch,
  cred: Credentials,
  method: string,
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: T }> {
  const res = await f(`${cred.registry}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${cred.token}`,
      "content-type": "application/json",
      "user-agent": "char-cli",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => null)) as T;
  if (!res.ok) {
    const p = ProblemSchema.safeParse(json);
    throw new CharError({
      code: p.success ? p.data.code : `http.${res.status}`,
      subject: pathname,
      ...(p.success && p.data.detail ? { detail: p.data.detail } : {}),
    });
  }
  return { status: res.status, json };
}

/**
 * 发布本地的 char.yaml：先在本地检查并构建（与 Registry 用同一个 Resolver），然后
 * 上传草稿 → 创建 Revision → 发布 Release。Registry 会重新校验，不采信本地结果。
 */
export async function cmdPublish(o: PublishOptions, out: Output): Promise<number> {
  try {
    if (!isLabel(o.label)) throw new CharError({ code: "cli.invalid_label", subject: o.label });
    const cred = await loadCredentials(o.env);
    if (!cred) {
      throw new CharError({
        code: "cli.not_logged_in",
        subject: "credentials",
        detail: "run 'char login'",
      });
    }
    const f = o.fetch ?? fetch;
    const { creation, resolved, project } = await buildLocal(o.file, o.deps);
    const ref = creation.ref.slice(1);
    const base = `/v1/creations/@${ref}`;

    const draft = await api<{ version: number }>(f, cred, "GET", `${base}/draft`, undefined);
    const working = { ...project.creation };
    if (project.placeholderId) delete (working as { id?: unknown }).id;
    await api(
      f,
      cred,
      "PUT",
      `${base}/draft`,
      { working },
      { "if-match": String(draft.json.version) },
    );
    const rev = await api<{ id: string }>(f, cred, "POST", `${base}/revisions`, {
      message: `char publish ${o.label}`,
    });
    const key =
      o.idempotencyKey ?? `cli:${creation.ref}:${o.label}:${resolved.ir.root.semantic_digest}`;
    const pub = await api<unknown>(
      f,
      cred,
      "POST",
      `${base}/releases`,
      { revision: rev.json.id, label: o.label, visibility: o.visibility },
      { "idempotency-key": key },
    );
    const r = PublishResponseSchema.parse(pub.json);
    for (const i of r.report?.issues ?? [])
      out.log(`${i.severity.padEnd(7)}${i.code}  ${i.subject}`);
    out.log(
      r.idempotent
        ? `already published ${creation.ref}@${o.label} (${r.release})`
        : `publish ${r.state}: ${creation.ref}@${o.label} (${r.release})`,
    );
    return 0;
  } catch (e) {
    if (isCharError(e)) {
      out.error(`error  ${e.code}  ${e.subject}${e.detail ? `  — ${e.detail}` : ""}`);
      return 1;
    }
    throw e;
  }
}

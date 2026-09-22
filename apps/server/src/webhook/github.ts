/**
 * GitHub App webhook：验签、解析投递、把关心的事件归一化成内部事件。
 *
 * 安全要点：
 * - 只接受 `X-Hub-Signature-256`（HMAC-SHA256）。旧的 SHA-1 签名头即使存在也不使用。
 * - 签名针对**原始请求字节**计算，绝不能先 JSON.parse 再序列化：任何空白或键序差异都会
 *   让签名失效，更糟的是可能让攻击者构造出“解析结果相同、签名却不同”的请求。
 * - 比较用常量时间（由 @octokit/webhooks-methods 的 timingSafeEqual 完成），支持在轮换期间
 *   同时接受新旧两个 secret。
 * - 验签通过之前不解析 body；body 大小超过 GitHub 的投递上限直接拒绝。
 *
 * 投递只做验签、去重所需的解析与入队；真正的处理（更新 binding、同步源码）在 worker 里
 * 进行，并且必须按 delivery ID 幂等。
 */
import { CharError } from "@char-pub/core";
import { verifyWithFallback } from "@octokit/webhooks-methods";
import { z } from "zod";

/** GitHub 不投递超过 25 MB 的 payload，所以更大的请求一定不是 GitHub 发来的。 */
export const MAX_WEBHOOK_BODY_BYTES = 25 * 1024 * 1024;

/** App 订阅的事件；其他事件验签后直接忽略。 */
export const SUBSCRIBED_EVENTS = [
  "installation",
  "installation_repositories",
  "push",
  "repository",
] as const;
export type SubscribedEvent = (typeof SUBSCRIBED_EVENTS)[number];

const SIGNATURE_RE = /^sha256=[0-9a-f]{64}$/;
const DELIVERY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_RE = /^[a-z_]{1,64}$/;

export type HeaderLookup = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeaderLookup, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower) continue;
    // 同名头出现多次说明请求被篡改或经过了异常的代理，不做猜测。
    if (Array.isArray(v)) return v.length === 1 ? v[0] : undefined;
    return v;
  }
  return undefined;
}

function webhookError(code: string, detail: string): CharError {
  return new CharError({ code, subject: "webhook", detail });
}

export interface WebhookSecrets {
  /** 当前的 webhook secret。 */
  current: string;
  /** 轮换期间仍然接受的旧 secret。 */
  previous?: readonly string[];
}

export type ParsedDelivery =
  | { status: "accepted"; delivery_id: string; event: SubscribedEvent; payload: unknown }
  | { status: "ignored"; delivery_id: string; event: string };

/**
 * 验证并解析一次投递。签名无效、缺失或格式错误都抛 CharError（调用方返回 401）；
 * 不在订阅列表里的事件返回 `ignored`（调用方返回 2xx，避免 GitHub 重试）。
 */
export async function parseDelivery(
  headers: HeaderLookup,
  rawBody: Uint8Array,
  secrets: WebhookSecrets,
): Promise<ParsedDelivery> {
  if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw webhookError("webhook.body_too_large", "payload exceeds the GitHub delivery limit");
  }
  if (rawBody.byteLength === 0) {
    throw webhookError("webhook.empty_body", "delivery has no body");
  }
  if (!secrets.current) {
    throw webhookError("webhook.not_configured", "webhook secret is not configured");
  }
  const signature = header(headers, "x-hub-signature-256");
  if (signature === undefined) {
    throw webhookError("webhook.signature_missing", "X-Hub-Signature-256 is required");
  }
  if (!SIGNATURE_RE.test(signature)) {
    throw webhookError("webhook.signature_malformed", "expected sha256=<64 lowercase hex>");
  }

  // 验签库接受字符串并对它的 UTF-8 编码计算 HMAC。严格解码（非法字节直接拒绝、保留 BOM）
  // 保证字符串再编码回去与原始字节完全相同，所以实际上仍是对原始字节验签。
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBody);
  } catch {
    throw webhookError("webhook.invalid_encoding", "body is not valid UTF-8");
  }
  const ok = await verifyWithFallback(
    secrets.current,
    text,
    signature,
    secrets.previous ? [...secrets.previous].filter((s) => s.length > 0) : undefined,
  );
  if (!ok) throw webhookError("webhook.signature_invalid", "signature does not match");

  const delivery_id = header(headers, "x-github-delivery");
  if (delivery_id === undefined || !DELIVERY_RE.test(delivery_id)) {
    throw webhookError("webhook.delivery_invalid", "X-GitHub-Delivery must be a GUID");
  }
  const event = header(headers, "x-github-event");
  if (event === undefined || !EVENT_RE.test(event)) {
    throw webhookError("webhook.event_invalid", "X-GitHub-Event is missing or malformed");
  }
  const id = delivery_id.toLowerCase();
  if (!(SUBSCRIBED_EVENTS as readonly string[]).includes(event)) {
    return { status: "ignored", delivery_id: id, event };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw webhookError("webhook.invalid_json", "body is not valid JSON");
  }
  return { status: "accepted", delivery_id: id, event: event as SubscribedEvent, payload };
}

// ---------------------------------------------------------------------------
// 事件归一化
// ---------------------------------------------------------------------------

/**
 * GitHub 在 payload 里用 JSON number 表示数字 ID，JSON.parse 之后就是 JS number。
 * 当前的 GitHub ID 远小于 2^53，所以这里要求它是安全整数并转成十进制字符串（与 OIDC claim、
 * 数据库 bigint 列一致）；一旦超出安全整数范围就拒绝，而不是静默地用丢了精度的值去匹配。
 */
const GitHubId = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "id exceeds the safe integer range")
  .transform((n) => String(n));

const Account = z.object({
  id: GitHubId,
  login: z.string().min(1),
  type: z.string().min(1).optional(),
});

const Installation = z.object({
  id: GitHubId,
  account: Account.nullable().optional(),
});

const RepoRef = z.object({
  id: GitHubId,
  full_name: z.string().min(1),
});

const Repository = z.object({
  id: GitHubId,
  full_name: z.string().min(1),
  name: z.string().min(1),
  default_branch: z.string().min(1).optional(),
  owner: z.object({ id: GitHubId, login: z.string().min(1) }),
});

const InstallationPayload = z.object({
  action: z.string(),
  installation: Installation,
});

const InstallationReposPayload = z.object({
  action: z.enum(["added", "removed"]),
  installation: Installation,
  repositories_added: z.array(RepoRef).default([]),
  repositories_removed: z.array(RepoRef).default([]),
});

const RepositoryPayload = z.object({
  action: z.string(),
  repository: Repository,
  installation: z.object({ id: GitHubId }).optional(),
  changes: z.unknown().optional(),
});

const RenamedChanges = z.object({
  repository: z.object({ name: z.object({ from: z.string().min(1) }) }),
});

const TransferredChanges = z.object({
  owner: z.object({
    from: z
      .object({
        user: z.object({ id: GitHubId, login: z.string().min(1) }).optional(),
        organization: z.object({ id: GitHubId, login: z.string().min(1) }).optional(),
      })
      .refine(
        (f) => f.user !== undefined || f.organization !== undefined,
        "previous owner missing",
      ),
  }),
});

const PushPayload = z.object({
  ref: z.string().min(1),
  before: z.string().regex(/^[0-9a-f]{40}$/),
  after: z.string().regex(/^[0-9a-f]{40}$/),
  deleted: z.boolean().optional(),
  forced: z.boolean().optional(),
  repository: Repository,
  installation: z.object({ id: GitHubId }).optional(),
});

export type InstallationEvent = {
  kind:
    | "installation.created"
    | "installation.deleted"
    | "installation.suspended"
    | "installation.unsuspended";
  installation_id: string;
  account_id: string | null;
  account_login: string | null;
  account_type: string | null;
};

export interface InstallationRepositoriesEvent {
  kind: "installation.repositories_changed";
  installation_id: string;
  added: { repository_id: string; full_name: string }[];
  removed: { repository_id: string; full_name: string }[];
}

export interface RepositoryRenamedEvent {
  /** 只更新展示用的名字，不影响 binding（binding 按数字 ID 匹配）。 */
  kind: "repository.renamed";
  repository_id: string;
  repository_owner_id: string;
  full_name: string;
  previous_name: string;
}

export interface RepositoryTransferredEvent {
  /** 仓库换了所有者：对应的 binding 必须冻结，等作者确认。 */
  kind: "repository.transferred";
  repository_id: string;
  previous_owner_id: string;
  previous_owner_login: string;
  new_owner_id: string;
  new_owner_login: string;
  full_name: string;
}

export interface PushEvent {
  kind: "push";
  installation_id: string | null;
  repository_id: string;
  repository_owner_id: string;
  ref: string;
  /** 推送后的 commit；分支被删除时为 null。 */
  commit: string | null;
  default_branch: string | null;
  forced: boolean;
}

export type NormalizedEvent =
  | InstallationEvent
  | InstallationRepositoriesEvent
  | RepositoryRenamedEvent
  | RepositoryTransferredEvent
  | PushEvent;

const INSTALLATION_ACTIONS: Record<string, InstallationEvent["kind"]> = {
  created: "installation.created",
  deleted: "installation.deleted",
  suspend: "installation.suspended",
  unsuspend: "installation.unsuspended",
};

function parse<T extends z.ZodType>(schema: T, value: unknown, event: string): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const where = r.error.issues[0]?.path.join(".") || "payload";
    throw webhookError("webhook.payload_invalid", `${event}: unexpected ${where}`);
  }
  return r.data;
}

/**
 * 把一次已验签的投递归一化。返回 null 表示这个 action 与 char.pub 无关（例如
 * `repository.edited`），调用方直接确认收到即可。
 */
export function normalizeEvent(event: SubscribedEvent, payload: unknown): NormalizedEvent | null {
  switch (event) {
    case "installation": {
      const p = parse(InstallationPayload, payload, event);
      const kind = INSTALLATION_ACTIONS[p.action];
      if (!kind) return null;
      const account = p.installation.account ?? null;
      return {
        kind,
        installation_id: p.installation.id,
        account_id: account?.id ?? null,
        account_login: account?.login ?? null,
        account_type: account?.type ?? null,
      };
    }
    case "installation_repositories": {
      const p = parse(InstallationReposPayload, payload, event);
      const map = (r: z.output<typeof RepoRef>) => ({
        repository_id: r.id,
        full_name: r.full_name,
      });
      return {
        kind: "installation.repositories_changed",
        installation_id: p.installation.id,
        added: p.repositories_added.map(map),
        removed: p.repositories_removed.map(map),
      };
    }
    case "repository": {
      const p = parse(RepositoryPayload, payload, event);
      if (p.action === "renamed") {
        const c = parse(RenamedChanges, p.changes, "repository.renamed");
        return {
          kind: "repository.renamed",
          repository_id: p.repository.id,
          repository_owner_id: p.repository.owner.id,
          full_name: p.repository.full_name,
          previous_name: c.repository.name.from,
        };
      }
      if (p.action === "transferred") {
        const c = parse(TransferredChanges, p.changes, "repository.transferred");
        // refine 已保证 user 与 organization 至少有一个。
        const from = (c.owner.from.user ?? c.owner.from.organization) as {
          id: string;
          login: string;
        };
        return {
          kind: "repository.transferred",
          repository_id: p.repository.id,
          previous_owner_id: from.id,
          previous_owner_login: from.login,
          new_owner_id: p.repository.owner.id,
          new_owner_login: p.repository.owner.login,
          full_name: p.repository.full_name,
        };
      }
      return null;
    }
    case "push": {
      const p = parse(PushPayload, payload, event);
      const deleted = p.deleted === true || /^0{40}$/.test(p.after);
      return {
        kind: "push",
        installation_id: p.installation?.id ?? null,
        repository_id: p.repository.id,
        repository_owner_id: p.repository.owner.id,
        ref: p.ref,
        commit: deleted ? null : p.after,
        default_branch: p.repository.default_branch ?? null,
        forced: p.forced === true,
      };
    }
  }
}

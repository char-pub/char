/**
 * 集中式授权。所有路由都必须通过这里判断权限，路由里不允许写内联的权限判断。
 *
 * `authorize(principal, action, resource)` 是纯函数：只看传入的数据，不查数据库。
 * 调用方负责把资源的相关状态（可见性、所属 namespace、成员关系等）先加载出来。
 *
 * 拒绝时返回的状态码有讲究：
 * - 私有资源对无权访问的人一律 404，不暴露“它存在但你看不到”；
 * - 资源本身公开、只是操作不被允许时返回 403；
 * - 未登录却做需要登录的操作返回 401；
 * - 被 kill switch 关闭的功能返回 503。
 */

export type Scope =
  | "creations:read"
  | "creations:write"
  | "releases:publish"
  | "contributions:write";

export type Principal =
  | { kind: "anonymous" }
  | {
      kind: "user";
      user_id: string;
      banned: boolean;
      /** 通过个人 Token 认证时的 scope；session 认证时为 undefined（拥有全部 scope）。 */
      scopes?: readonly Scope[];
      /** 通过标记为 Agent 的个人 Token 认证。 */
      agent?: boolean;
    }
  | { kind: "guest"; guest_id: string; disabled: boolean }
  /** 通过 GitHub OIDC 换来的短期发布凭证，只能发布它所绑定的 Creation。 */
  | { kind: "oidc"; creation_id: string; binding_id: string };

export type NamespaceRole = "owner" | "maintainer";

/** 资源所在 namespace 的状态，以及当前用户在其中的角色。 */
export interface NamespaceContext {
  namespace_id: string;
  status: "active" | "suspended";
  /** 当前 principal 的角色；不是成员时为 null。 */
  role: NamespaceRole | null;
}

export type FeatureFlag =
  | "signups"
  | "uploads"
  | "publish"
  | "contributions"
  | "github_sync"
  | "guest_access"
  | "read_only";

export type ContributionPolicy = "anyone" | "signed-in" | "invited" | "closed";

export type Resource =
  | {
      type: "creation";
      id: string;
      ns: NamespaceContext;
      /** Creation 是否有任何公开可见的内容（至少一个 active 的 public Release）。 */
      has_public_release: boolean;
      status: "active" | "hidden" | "suspended";
      contribution_policy: ContributionPolicy;
      /** 当前 principal 是否被邀请提交 Contribution。 */
      invited?: boolean;
    }
  | {
      type: "release";
      id: string;
      creation_id: string;
      ns: NamespaceContext;
      visibility: "public" | "private";
      status: "active" | "yanked" | "tombstoned";
      /** 所属 Creation 被管理员隐藏时，公开读也不可见。 */
      creation_status: "active" | "hidden" | "suspended";
    }
  | { type: "namespace"; ns: NamespaceContext }
  | {
      type: "contribution";
      id: string;
      /** 目标 Creation 所在的 namespace。 */
      ns: NamespaceContext;
      author: { user_id?: string; guest_id?: string };
      status: "open" | "accepted" | "rejected" | "withdrawn";
    }
  | { type: "upload"; id: string; owner_user_id: string }
  | {
      type: "import";
      id: string;
      owner_user_id: string;
      /** 导入目标所在的 namespace。 */
      ns: NamespaceContext;
      /** 导入生成的 Creation 的状态；导入还没有成功时省略。 */
      creation_status?: "active" | "hidden" | "suspended";
    }
  | { type: "account"; user_id: string }
  | { type: "system" };

export type Action =
  | "creation.read"
  | "creation.read_draft"
  | "creation.create"
  | "creation.edit"
  | "creation.publish"
  | "creation.update_settings"
  /** 绑定、解绑 GitHub 仓库，处理冻结的 binding。 */
  | "creation.manage_source"
  | "release.read"
  | "release.yank"
  | "contribution.submit"
  | "contribution.read"
  | "contribution.decide"
  | "contribution.withdraw"
  | "upload.create"
  | "upload.read"
  | "import.create"
  | "import.read"
  /** 确认导入卡片的评级、权利与许可。 */
  | "import.confirm"
  | "namespace.create"
  | "namespace.rename"
  | "account.read"
  | "account.update_settings"
  | "account.manage_tokens"
  /** 申请与确认访客邮箱验证。 */
  | "guest.verify"
  /** 查看当前访客会话。 */
  | "guest.read_self"
  /** 退出访客会话。 */
  | "guest.sign_out"
  | "search";

export type Decision =
  | { allow: true }
  | { allow: false; status: 401 | 403 | 404 | 503; code: string };

const ALLOW: Decision = { allow: true };

function deny(status: 401 | 403 | 404 | 503, code: string): Decision {
  return { allow: false, status, code };
}

/** 动作需要的 Token scope。session 认证不受限制。 */
const REQUIRED_SCOPE: Partial<Record<Action, Scope>> = {
  "creation.read_draft": "creations:read",
  "creation.create": "creations:write",
  "creation.edit": "creations:write",
  "creation.update_settings": "creations:write",
  "creation.manage_source": "creations:write",
  "creation.publish": "releases:publish",
  "release.yank": "releases:publish",
  "contribution.submit": "contributions:write",
  "contribution.withdraw": "contributions:write",
  "contribution.decide": "creations:write",
  "upload.create": "creations:write",
  "import.create": "creations:write",
  "import.confirm": "creations:write",
};

/** 会写数据的动作：全站只读时一律拒绝。 */
const WRITE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "creation.create",
  "creation.edit",
  "creation.publish",
  "creation.update_settings",
  "creation.manage_source",
  "release.yank",
  "contribution.submit",
  "contribution.decide",
  "contribution.withdraw",
  "upload.create",
  "import.create",
  "import.confirm",
  "namespace.create",
  "namespace.rename",
  "account.update_settings",
  "account.manage_tokens",
  "guest.verify",
]);

/** 动作对应的 kill switch。 */
const ACTION_FLAG: Partial<Record<Action, FeatureFlag>> = {
  "creation.publish": "publish",
  "contribution.submit": "contributions",
  "upload.create": "uploads",
  "import.create": "uploads",
  "guest.verify": "guest_access",
};

export interface AuthzContext {
  /** 当前关闭的功能开关。 */
  disabled: ReadonlySet<FeatureFlag>;
}

const isMember = (ns: NamespaceContext) => ns.role === "owner" || ns.role === "maintainer";

export function authorize(
  principal: Principal,
  action: Action,
  resource: Resource,
  ctx: AuthzContext = { disabled: new Set() },
): Decision {
  // 先判断“能不能看见”：看不见的资源一律 404，不能因为 kill switch 或 scope 的检查顺序
  // 泄露它的存在。
  const visible = canSee(principal, resource);
  if (!visible.allow) return visible;

  if (WRITE_ACTIONS.has(action) && ctx.disabled.has("read_only")) {
    return deny(503, "feature.read_only");
  }
  const flag = ACTION_FLAG[action];
  if (flag && ctx.disabled.has(flag)) return deny(503, "feature.disabled");

  if (principal.kind === "user") {
    if (principal.banned) return deny(403, "account.banned");
    const scope = REQUIRED_SCOPE[action];
    if (scope && principal.scopes && !principal.scopes.includes(scope)) {
      return deny(403, "token.insufficient_scope");
    }
  }
  // 被停用的访客什么都不能做，只能退出（清掉浏览器里的 cookie）。
  if (principal.kind === "guest" && principal.disabled && action !== "guest.sign_out") {
    return deny(403, "guest.disabled");
  }

  return decide(principal, action, resource, ctx);
}

/** 资源对 principal 是否可见；不可见返回 404。 */
function canSee(principal: Principal, r: Resource): Decision {
  switch (r.type) {
    case "creation":
      if (isMember(r.ns) && principal.kind === "user") return ALLOW;
      // OIDC 发布凭证能看到它绑定的 Creation，即使它还没有任何公开的 Release（首次发布）。
      if (principal.kind === "oidc" && principal.creation_id === r.id) return ALLOW;
      if (r.status !== "active" || r.ns.status !== "active") return deny(404, "not_found");
      return r.has_public_release ? ALLOW : deny(404, "not_found");
    case "release":
      if (isMember(r.ns) && principal.kind === "user") return ALLOW;
      if (principal.kind === "oidc" && principal.creation_id === r.creation_id) return ALLOW;
      if (r.visibility !== "public") return deny(404, "not_found");
      if (r.creation_status !== "active" || r.ns.status !== "active") return deny(404, "not_found");
      return ALLOW;
    case "contribution": {
      if (principal.kind === "user" && isMember(r.ns)) return ALLOW;
      if (isAuthor(principal, r.author)) return ALLOW;
      return deny(404, "not_found");
    }
    case "upload":
    case "import":
      return principal.kind === "user" && principal.user_id === r.owner_user_id
        ? ALLOW
        : deny(404, "not_found");
    case "account":
      return principal.kind === "user" && principal.user_id === r.user_id
        ? ALLOW
        : deny(404, "not_found");
    case "namespace":
    case "system":
      return ALLOW;
  }
}

function isAuthor(p: Principal, author: { user_id?: string; guest_id?: string }): boolean {
  if (p.kind === "user") return author.user_id !== undefined && author.user_id === p.user_id;
  if (p.kind === "guest") return author.guest_id !== undefined && author.guest_id === p.guest_id;
  return false;
}

function requireUser(p: Principal): Decision | null {
  if (p.kind === "anonymous") return deny(401, "auth.required");
  if (p.kind !== "user") return deny(403, "forbidden");
  return null;
}

/** 在资源所在 namespace 中必须是 owner / maintainer，且 namespace 未被冻结。 */
function requireMember(p: Principal, ns: NamespaceContext): Decision {
  const u = requireUser(p);
  if (u) return u;
  if (!isMember(ns)) return deny(403, "forbidden");
  if (ns.status !== "active") return deny(403, "namespace.suspended");
  return ALLOW;
}

function decide(p: Principal, action: Action, r: Resource, ctx: AuthzContext): Decision {
  switch (action) {
    case "search":
      return ALLOW;

    case "creation.read":
      return r.type === "creation" ? ALLOW : deny(403, "bad_resource");

    case "release.read":
      return r.type === "release" ? ALLOW : deny(403, "bad_resource");

    case "creation.read_draft":
      if (r.type !== "creation") return deny(403, "bad_resource");
      // 草稿只有成员能看；对其他人来说草稿“不存在”。
      if (p.kind !== "user" || !isMember(r.ns)) return deny(404, "not_found");
      return ALLOW;

    case "namespace.create":
      // 注册新 namespace 受 signups 开关控制。
      if (ctx.disabled.has("signups")) return deny(503, "feature.disabled");
      return requireUser(p) ?? ALLOW;

    case "creation.create":
      if (r.type !== "namespace") return deny(403, "bad_resource");
      return requireMember(p, r.ns);

    case "namespace.rename": {
      // 改名影响所有作品的公共标识，只有 owner 可以操作；Token 不能改名。
      if (r.type !== "namespace") return deny(403, "bad_resource");
      const m = requireMember(p, r.ns);
      if (!m.allow) return m;
      if (r.ns.role !== "owner") return deny(403, "forbidden");
      if (p.kind === "user" && p.scopes) return deny(403, "token.not_allowed");
      return ALLOW;
    }

    case "creation.edit":
    case "creation.update_settings":
    case "creation.manage_source":
      if (r.type !== "creation") return deny(403, "bad_resource");
      if (r.status === "suspended") return deny(403, "creation.suspended");
      return requireMember(p, r.ns);

    case "creation.publish":
      if (r.type !== "creation") return deny(403, "bad_resource");
      if (r.status === "suspended") return deny(403, "creation.suspended");
      if (p.kind === "oidc") {
        return p.creation_id === r.id ? ALLOW : deny(403, "binding.mismatch");
      }
      return requireMember(p, r.ns);

    case "release.yank":
      if (r.type !== "release") return deny(403, "bad_resource");
      if (r.status === "tombstoned") return deny(403, "release.tombstoned");
      return requireMember(p, r.ns);

    case "contribution.submit": {
      if (r.type !== "creation") return deny(403, "bad_resource");
      if (r.status !== "active") return deny(403, "creation.not_active");
      switch (r.contribution_policy) {
        case "closed":
          return deny(403, "contribution.closed");
        case "invited":
          if (p.kind !== "user")
            return p.kind === "anonymous" ? deny(401, "auth.required") : deny(403, "forbidden");
          return r.invited || isMember(r.ns) ? ALLOW : deny(403, "contribution.not_invited");
        case "signed-in":
          return requireUser(p) ?? ALLOW;
        case "anyone":
          if (p.kind === "guest") {
            return ctx.disabled.has("guest_access") ? deny(503, "feature.disabled") : ALLOW;
          }
          return requireUser(p) ?? ALLOW;
      }
      return deny(403, "forbidden");
    }

    case "contribution.read":
      // 可见性已经在 canSee 中判断：作者本人与目标 namespace 的成员。
      return r.type === "contribution" ? ALLOW : deny(403, "bad_resource");

    case "contribution.decide":
      if (r.type !== "contribution") return deny(403, "bad_resource");
      if (r.status !== "open") return deny(403, "contribution.not_open");
      return requireMember(p, r.ns);

    case "contribution.withdraw":
      if (r.type !== "contribution") return deny(403, "bad_resource");
      if (r.status !== "open") return deny(403, "contribution.not_open");
      return isAuthor(p, r.author) ? ALLOW : deny(403, "forbidden");

    case "upload.create":
      return requireUser(p) ?? ALLOW;

    case "import.create":
      // 对 namespace 判断能否导入到这里；对 system 只判断能否使用导入功能
      // （请求体不合法、还不知道目标 namespace 时用它，之后必然以 422 结束）。
      if (r.type === "namespace") return requireMember(p, r.ns);
      return r.type === "system" ? (requireUser(p) ?? ALLOW) : deny(403, "bad_resource");

    case "import.read":
      return r.type === "import" ? ALLOW : deny(403, "bad_resource");

    case "import.confirm":
      if (r.type !== "import") return deny(403, "bad_resource");
      if (r.creation_status === "suspended") return deny(403, "creation.suspended");
      return requireMember(p, r.ns);

    case "upload.read":
      return r.type === "upload" ? ALLOW : deny(403, "bad_resource");

    case "account.read":
    case "account.update_settings":
    case "account.manage_tokens":
      if (r.type !== "account") return deny(403, "bad_resource");
      if (
        (action === "account.manage_tokens" || action === "account.update_settings") &&
        p.kind === "user" &&
        p.scopes
      ) {
        // Token 不能用来管理 Token，也不能修改账号设置（例如开启成人内容），只能用浏览器会话。
        return deny(403, "token.not_allowed");
      }
      return requireUser(p) ?? ALLOW;

    // 任何人都可以申请访客验证（Turnstile 与限流在路由里执行）；退出只作用于请求自带的
    // 访客 cookie，也不需要身份。
    case "guest.verify":
    case "guest.sign_out":
      return r.type === "system" ? ALLOW : deny(403, "bad_resource");

    case "guest.read_self":
      if (r.type !== "system") return deny(403, "bad_resource");
      if (p.kind === "guest") return ALLOW;
      return p.kind === "anonymous" ? deny(401, "auth.required") : deny(403, "forbidden");
  }
}

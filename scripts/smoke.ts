/**
 * `pnpm smoke --env <staging|production> [--origin <railway 域名>]`
 *
 * 部署后的冒烟测试：只做只读请求，不创建任何数据。检查：
 * - 各域名可访问，web 返回 SPA 并带安全响应头（CSP、HSTS、nosniff）；
 * - API 健康检查、公开搜索可用，错误响应是 problem+json；
 * - admin-api 不经过 Cloudflare Access 时被拦截；
 * - 可选：`--origin <railway 域名>` 时，直接访问源站（绕过 Cloudflare）必须被拒绝。
 *
 * 输出每项检查的结果，任何一项失败时以非零状态退出。结果可以直接贴进验收记录。
 */

interface Target {
  web: string;
  api: string;
  admin: string;
  adminApi: string;
  assets: string;
}

const TARGETS: Record<string, Target> = {
  production: {
    web: "https://www.char.pub",
    api: "https://api.char.pub",
    admin: "https://admin.char.pub",
    adminApi: "https://admin-api.char.pub",
    assets: "https://assets.char.pub",
  },
  staging: {
    web: "https://staging.char.pub",
    api: "https://staging-api.char.pub",
    admin: "https://staging-admin.char.pub",
    adminApi: "https://staging-admin-api.char.pub",
    assets: "https://staging-assets.char.pub",
  },
};

type Check = { name: string; run: () => Promise<string> };

class Fail extends Error {}

function expect(cond: boolean, message: string): void {
  if (!cond) throw new Fail(message);
}

async function get(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(15_000) });
}

export function checksFor(t: Target, origin?: string): Check[] {
  const checks: Check[] = [
    {
      name: "web serves the SPA with security headers",
      run: async () => {
        const r = await get(`${t.web}/playground`);
        expect(r.status === 200, `status ${r.status}`);
        const csp = r.headers.get("content-security-policy") ?? "";
        expect(csp.includes("script-src 'self'"), "missing strict CSP");
        expect(!csp.includes("unsafe-inline"), "CSP allows unsafe-inline");
        expect(
          (r.headers.get("strict-transport-security") ?? "").includes("max-age"),
          "missing HSTS",
        );
        expect(r.headers.get("x-content-type-options") === "nosniff", "missing nosniff");
        const html = await r.text();
        expect(
          html.includes('<div id="root">') || html.includes("<div id=root>"),
          "not the SPA shell",
        );
        return "200, CSP / HSTS / nosniff present";
      },
    },
    {
      name: "api health check",
      run: async () => {
        const r = await get(`${t.api}/healthz`);
        expect(r.status === 200, `status ${r.status}`);
        return "200";
      },
    },
    {
      name: "api public search works anonymously",
      run: async () => {
        const r = await get(`${t.api}/v1/search?q=world`);
        expect(r.status === 200, `status ${r.status}`);
        const body = (await r.json()) as { items?: unknown[] };
        expect(Array.isArray(body.items), "no items array");
        return `200, ${body.items?.length ?? 0} items`;
      },
    },
    {
      name: "api errors are problem+json",
      run: async () => {
        const r = await get(`${t.api}/v1/definitely-not-a-route`);
        expect(r.status === 404, `status ${r.status}`);
        expect(
          (r.headers.get("content-type") ?? "").includes("application/problem+json"),
          "not problem+json",
        );
        return "404 problem+json";
      },
    },
    {
      name: "admin-api rejects requests without Cloudflare Access",
      run: async () => {
        const r = await get(`${t.adminApi}/v1/admin/flags`);
        // Access 会重定向到登录页（302）或直接拒绝（401 / 403）；绝不能是 200。
        expect([302, 401, 403].includes(r.status), `status ${r.status}`);
        return `${r.status}`;
      },
    },
    {
      name: "admin SPA is behind Cloudflare Access",
      run: async () => {
        const r = await get(t.admin);
        expect([302, 401, 403].includes(r.status), `status ${r.status}`);
        return `${r.status}`;
      },
    },
  ];
  if (origin) {
    checks.push({
      name: "origin rejects traffic that bypasses Cloudflare",
      run: async () => {
        const r = await get(`${origin.replace(/\/+$/, "")}/v1/search?q=x`);
        expect(r.status === 403, `status ${r.status}`);
        return "403 origin.forbidden";
      },
    });
  }
  return checks;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const env = flag("--env") ?? "staging";
  const target = TARGETS[env];
  if (!target) throw new Error(`unknown --env ${env}`);
  const checks = checksFor(target, flag("--origin"));
  let failed = 0;
  console.log(`smoke test: ${env} (${new Date().toISOString()})`);
  for (const c of checks) {
    try {
      console.log(`ok    ${c.name}: ${await c.run()}`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${c.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(failed === 0 ? "all checks passed" : `${failed} check(s) failed`);
  if (failed > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

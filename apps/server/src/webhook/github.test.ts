import { createHmac } from "node:crypto";
import { isCharError } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import {
  MAX_WEBHOOK_BODY_BYTES,
  normalizeEvent,
  parseDelivery,
  type SubscribedEvent,
} from "./github.js";

// 仅用于测试的 secret，不是真实凭证。
const SECRET = "test-webhook-secret-not-real";
const OLD_SECRET = "previous-test-secret-not-real";
const DELIVERY = "72d3162e-cc78-11e3-81ab-4c9367dc0958";
const enc = new TextEncoder();

function sig(body: string | Uint8Array, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function delivery(
  event: string,
  payload: unknown,
  opts: { secret?: string; headers?: Record<string, string | string[] | undefined> } = {},
) {
  // 模拟 GitHub 的实际格式：带缩进的 JSON。验签必须基于这些原始字节。
  const body = JSON.stringify(payload, null, 2);
  return {
    body: enc.encode(body),
    headers: {
      "X-GitHub-Delivery": DELIVERY,
      "X-GitHub-Event": event,
      "X-Hub-Signature-256": sig(body, opts.secret),
      "Content-Type": "application/json",
      ...opts.headers,
    } as Record<string, string | string[] | undefined>,
  };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return isCharError(e) ? e.code : `non-char:${String(e)}`;
  }
  return undefined;
}

const owner = { login: "octo", id: 7890, type: "User" };
const repository = {
  id: 123456,
  node_id: "R_kgDOAAAAAQ",
  name: "lore",
  full_name: "octo/lore",
  private: false,
  owner,
  default_branch: "main",
};
const installation = { id: 55, node_id: "MDIzOkludGVncmF0aW9uSW5zdGFsbGF0aW9uNTU=" };

describe("parseDelivery: signature", () => {
  it("accepts a correctly signed delivery and parses the payload", async () => {
    const d = delivery("push", { hello: "world" });
    const r = await parseDelivery(d.headers, d.body, { current: SECRET });
    expect(r).toEqual({
      status: "accepted",
      delivery_id: DELIVERY,
      event: "push",
      payload: { hello: "world" },
    });
  });

  it("accepts the previous secret during rotation", async () => {
    const d = delivery("push", { a: 1 }, { secret: OLD_SECRET });
    const r = await parseDelivery(d.headers, d.body, {
      current: SECRET,
      previous: ["", OLD_SECRET],
    });
    expect(r.status).toBe("accepted");
    expect(await codeOf(parseDelivery(d.headers, d.body, { current: SECRET }))).toBe(
      "webhook.signature_invalid",
    );
  });

  it("works with a Headers object and case-insensitive plain headers", async () => {
    const d = delivery("push", { a: 1 });
    const h = new Headers(d.headers as Record<string, string>);
    expect((await parseDelivery(h, d.body, { current: SECRET })).status).toBe("accepted");
    const lower = Object.fromEntries(
      Object.entries(d.headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect((await parseDelivery(lower, d.body, { current: SECRET })).status).toBe("accepted");
  });

  it("verifies against the raw bytes, not a re-serialized body", async () => {
    const d = delivery("push", { a: 1, b: 2 });
    // 内容等价但字节不同（去掉了缩进）：签名必须失效。
    const compact = enc.encode(JSON.stringify({ a: 1, b: 2 }));
    expect(await codeOf(parseDelivery(d.headers, compact, { current: SECRET }))).toBe(
      "webhook.signature_invalid",
    );
  });

  it("rejects a tampered body", async () => {
    const d = delivery("push", { ref: "refs/heads/main" });
    const tampered = enc.encode(new TextDecoder().decode(d.body).replace("main", "evil"));
    expect(await codeOf(parseDelivery(d.headers, tampered, { current: SECRET }))).toBe(
      "webhook.signature_invalid",
    );
  });

  it.each([
    ["missing signature", { "X-Hub-Signature-256": undefined }, "webhook.signature_missing"],
    [
      "sha1 signature only",
      { "X-Hub-Signature-256": undefined, "X-Hub-Signature": "sha1=abc" },
      "webhook.signature_missing",
    ],
    [
      "sha1 value in the sha256 header",
      { "X-Hub-Signature-256": `sha1=${"a".repeat(40)}` },
      "webhook.signature_malformed",
    ],
    [
      "uppercase hex",
      { "X-Hub-Signature-256": `sha256=${"A".repeat(64)}` },
      "webhook.signature_malformed",
    ],
    ["truncated", { "X-Hub-Signature-256": "sha256=abcd" }, "webhook.signature_malformed"],
    [
      "duplicated header",
      { "X-Hub-Signature-256": [sig("x"), sig("y")] },
      "webhook.signature_missing",
    ],
    [
      "wrong but well-formed",
      { "X-Hub-Signature-256": `sha256=${"0".repeat(64)}` },
      "webhook.signature_invalid",
    ],
  ])("rejects %s", async (_name, headers, code) => {
    const d = delivery("push", { a: 1 }, { headers });
    expect(await codeOf(parseDelivery(d.headers, d.body, { current: SECRET }))).toBe(code);
  });

  it("rejects empty, oversized and non-UTF-8 bodies, and a missing secret", async () => {
    const d = delivery("push", { a: 1 });
    expect(await codeOf(parseDelivery(d.headers, new Uint8Array(0), { current: SECRET }))).toBe(
      "webhook.empty_body",
    );
    const big = new Uint8Array(MAX_WEBHOOK_BODY_BYTES + 1);
    expect(await codeOf(parseDelivery(d.headers, big, { current: SECRET }))).toBe(
      "webhook.body_too_large",
    );
    const bad = new Uint8Array([0x7b, 0xff, 0x7d]);
    const badHeaders = { ...d.headers, "X-Hub-Signature-256": sig(Buffer.from(bad)) };
    expect(await codeOf(parseDelivery(badHeaders, bad, { current: SECRET }))).toBe(
      "webhook.invalid_encoding",
    );
    expect(await codeOf(parseDelivery(d.headers, d.body, { current: "" }))).toBe(
      "webhook.not_configured",
    );
  });

  it("keeps a leading BOM when verifying", async () => {
    const BOM = String.fromCharCode(0xfeff);
    const body = BOM + JSON.stringify({ a: 1 });
    const bytes = enc.encode(body);
    const headers = {
      "X-GitHub-Delivery": DELIVERY,
      "X-GitHub-Event": "push",
      "X-Hub-Signature-256": sig(Buffer.from(bytes)),
    };
    // 签名正确，但 BOM 让 JSON 解析失败：验签基于原始字节，解析在验签之后。
    expect(await codeOf(parseDelivery(headers, bytes, { current: SECRET }))).toBe(
      "webhook.invalid_json",
    );
  });
});

describe("parseDelivery: headers and events", () => {
  it("ignores events the app does not subscribe to, after verifying", async () => {
    const d = delivery("issues", { action: "opened" });
    expect(await parseDelivery(d.headers, d.body, { current: SECRET })).toEqual({
      status: "ignored",
      delivery_id: DELIVERY,
      event: "issues",
    });
    const unsigned = delivery(
      "issues",
      { action: "opened" },
      { headers: { "X-Hub-Signature-256": undefined } },
    );
    expect(await codeOf(parseDelivery(unsigned.headers, unsigned.body, { current: SECRET }))).toBe(
      "webhook.signature_missing",
    );
  });

  it("normalizes the delivery id to lowercase", async () => {
    const d = delivery(
      "push",
      { a: 1 },
      { headers: { "X-GitHub-Delivery": DELIVERY.toUpperCase() } },
    );
    const r = await parseDelivery(d.headers, d.body, { current: SECRET });
    expect(r.delivery_id).toBe(DELIVERY);
  });

  it.each([
    ["missing delivery id", { "X-GitHub-Delivery": undefined }, "webhook.delivery_invalid"],
    ["non-GUID delivery id", { "X-GitHub-Delivery": "12345" }, "webhook.delivery_invalid"],
    ["missing event", { "X-GitHub-Event": undefined }, "webhook.event_invalid"],
    ["malformed event", { "X-GitHub-Event": "push; drop" }, "webhook.event_invalid"],
  ])("rejects %s", async (_name, headers, code) => {
    const d = delivery("push", { a: 1 }, { headers });
    expect(await codeOf(parseDelivery(d.headers, d.body, { current: SECRET }))).toBe(code);
  });

  it("rejects a signed body that is not JSON", async () => {
    const body = "not json";
    const headers = {
      "X-GitHub-Delivery": DELIVERY,
      "X-GitHub-Event": "push",
      "X-Hub-Signature-256": sig(body),
    };
    expect(await codeOf(parseDelivery(headers, enc.encode(body), { current: SECRET }))).toBe(
      "webhook.invalid_json",
    );
  });
});

describe("normalizeEvent", () => {
  const norm = (event: SubscribedEvent, payload: unknown) => normalizeEvent(event, payload);
  const codeOfSync = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return isCharError(e) ? e.code : "non-char";
    }
    return undefined;
  };

  it.each([
    ["created", "installation.created"],
    ["deleted", "installation.deleted"],
    ["suspend", "installation.suspended"],
    ["unsuspend", "installation.unsuspended"],
  ])("installation.%s", (action, kind) => {
    expect(
      norm("installation", {
        action,
        installation: { ...installation, account: owner, repository_selection: "selected" },
        sender: owner,
      }),
    ).toEqual({
      kind,
      installation_id: "55",
      account_id: "7890",
      account_login: "octo",
      account_type: "User",
    });
  });

  it("handles an installation without an account and ignores other actions", () => {
    expect(
      norm("installation", { action: "deleted", installation: { id: 55, account: null } }),
    ).toMatchObject({
      account_id: null,
      account_login: null,
      account_type: null,
    });
    expect(norm("installation", { action: "new_permissions_accepted", installation })).toBeNull();
  });

  it("installation_repositories added / removed", () => {
    const added = norm("installation_repositories", {
      action: "added",
      installation,
      repository_selection: "selected",
      repositories_added: [
        { id: 123456, node_id: "x", name: "lore", full_name: "octo/lore", private: false },
      ],
      repositories_removed: [],
    });
    expect(added).toEqual({
      kind: "installation.repositories_changed",
      installation_id: "55",
      added: [{ repository_id: "123456", full_name: "octo/lore" }],
      removed: [],
    });
    const removed = norm("installation_repositories", {
      action: "removed",
      installation,
      repositories_removed: [{ id: 99, full_name: "octo/old" }],
    });
    expect(removed).toMatchObject({
      added: [],
      removed: [{ repository_id: "99", full_name: "octo/old" }],
    });
  });

  it("repository.renamed only carries the display name change", () => {
    expect(
      norm("repository", {
        action: "renamed",
        changes: { repository: { name: { from: "old-lore" } } },
        repository,
        installation,
        sender: owner,
      }),
    ).toEqual({
      kind: "repository.renamed",
      repository_id: "123456",
      repository_owner_id: "7890",
      full_name: "octo/lore",
      previous_name: "old-lore",
    });
  });

  it("repository.transferred from a user or an organization", () => {
    const moved = { ...repository, full_name: "newco/lore", owner: { login: "newco", id: 4242 } };
    expect(
      norm("repository", {
        action: "transferred",
        changes: { owner: { from: { user: { login: "octo", id: 7890 } } } },
        repository: moved,
        installation,
      }),
    ).toEqual({
      kind: "repository.transferred",
      repository_id: "123456",
      previous_owner_id: "7890",
      previous_owner_login: "octo",
      new_owner_id: "4242",
      new_owner_login: "newco",
      full_name: "newco/lore",
    });
    expect(
      norm("repository", {
        action: "transferred",
        changes: { owner: { from: { organization: { login: "oldorg", id: 1 } } } },
        repository: moved,
      }),
    ).toMatchObject({ previous_owner_id: "1", previous_owner_login: "oldorg" });
  });

  it("ignores repository actions char.pub does not care about", () => {
    expect(norm("repository", { action: "edited", repository })).toBeNull();
  });

  it("push to a branch, a force push and a branch deletion", () => {
    const base = {
      ref: "refs/heads/main",
      before: "1".repeat(40),
      after: "2".repeat(40),
      created: false,
      deleted: false,
      forced: false,
      repository,
      installation,
      commits: [],
      pusher: { name: "octo" },
    };
    expect(norm("push", base)).toEqual({
      kind: "push",
      installation_id: "55",
      repository_id: "123456",
      repository_owner_id: "7890",
      ref: "refs/heads/main",
      commit: "2".repeat(40),
      default_branch: "main",
      forced: false,
    });
    expect(norm("push", { ...base, forced: true })).toMatchObject({ forced: true });
    expect(norm("push", { ...base, deleted: true, after: "0".repeat(40) })).toMatchObject({
      commit: null,
    });
    const { installation: _i, ...noInstall } = base;
    const { default_branch: _d, ...repoNoDefault } = repository;
    expect(norm("push", { ...noInstall, repository: repoNoDefault })).toMatchObject({
      installation_id: null,
      default_branch: null,
    });
  });

  it.each([
    ["installation without id", "installation", { action: "created", installation: {} }],
    ["numeric id as string", "installation", { action: "created", installation: { id: "55" } }],
    [
      "id beyond the safe integer range",
      "push",
      {
        ref: "refs/heads/main",
        before: "1".repeat(40),
        after: "2".repeat(40),
        repository: { ...repository, id: 2 ** 60 },
      },
    ],
    [
      "push with a bad sha",
      "push",
      { ref: "refs/heads/main", before: "x", after: "y", repository },
    ],
    ["renamed without changes", "repository", { action: "renamed", repository }],
    [
      "transferred without previous owner",
      "repository",
      {
        action: "transferred",
        changes: { owner: { from: {} } },
        repository,
      },
    ],
    [
      "repository_installation bad action",
      "installation_repositories",
      { action: "moved", installation },
    ],
  ])("rejects malformed payload: %s", (_name, event, payload) => {
    expect(codeOfSync(() => norm(event as SubscribedEvent, payload))).toBe(
      "webhook.payload_invalid",
    );
  });
});

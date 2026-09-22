/**
 * License 判断：发布前检查 Creation、依赖与 Asset 的许可是否允许 char.pub 再分发，
 * 以及组合后是否相互冲突。
 *
 * 这是一个刻意保持简单、可解释的近似判断，不是法律意见。许可用 SPDX 表达式描述，
 * 由 `spdx-expression-parse` 解析；每个许可 ID 被归纳为几条特征（能否商用、能否改编、
 * 是否要求相同方式共享、能否由他人再分发）。未知的 `LicenseRef-*` 只给警告，不直接拒绝。
 *
 * 表达式语义：`A OR B` 表示使用者可以任选其一，所以按对使用者最有利的一项判断；
 * `A AND B` 表示必须同时遵守，所以按最严格的一项判断；`WITH` 例外与 `+` 按基础许可判断。
 */
import parseSpdx from "spdx-expression-parse";
import { CharError } from "./errors.js";

/** 作者保留所有权利时使用的 LicenseRef。 */
export const ALL_RIGHTS_RESERVED = "LicenseRef-All-Rights-Reserved";

/** 只有权利人本人才能发布的许可（char.pub 以外的人不能再分发）。 */
const OWNER_ONLY_LICENSES: ReadonlySet<string> = new Set([
  ALL_RIGHTS_RESERVED,
  "LicenseRef-Proprietary",
]);

/** 要求改编作品以相同方式共享的常见许可族（前缀匹配）。 */
const SHARE_ALIKE_PREFIXES = [
  "GPL-",
  "LGPL-",
  "AGPL-",
  "MPL-",
  "EUPL-",
  "CC-BY-SA-",
  "CC-BY-NC-SA-",
];

/** 一次最多展开的备选组合数，防止恶意构造的表达式造成指数级展开。 */
const MAX_ALTERNATIVES = 64;

export type LicenseNode =
  | { license: string; plus?: true; exception?: string }
  | { conjunction: "and" | "or"; left: LicenseNode; right: LicenseNode };

export interface LicenseTraits {
  /** 允许商业使用。 */
  commercial: boolean;
  /** 允许改编（修改、翻译、删减后再发布）。 */
  derivatives: boolean;
  /** 改编作品必须以相同或兼容的许可发布。 */
  shareAlike: boolean;
  /** 权利人以外的人也可以再分发。 */
  redistributable: boolean;
  /** 是否认识这个许可。不认识时其他特征只是乐观猜测。 */
  known: boolean;
}

export type LicenseVerdict = "pass" | "warn" | "fail";

export interface LicenseReason {
  code: string;
  verdict: Exclude<LicenseVerdict, "pass">;
  detail: string;
}

export interface LicenseCheck {
  verdict: LicenseVerdict;
  reasons: LicenseReason[];
}

/** 解析 SPDX 表达式。非法时抛出 `license.invalid`。 */
export function parseLicense(expr: string): LicenseNode {
  try {
    return parseSpdx(expr) as LicenseNode;
  } catch (e) {
    throw new CharError({
      code: "license.invalid",
      subject: expr,
      detail: e instanceof Error ? e.message : "not a valid SPDX expression",
    });
  }
}

export function isValidLicense(expr: string): boolean {
  try {
    parseLicense(expr);
    return true;
  } catch {
    return false;
  }
}

/** 单个许可 ID 的特征。 */
export function licenseTraits(id: string): LicenseTraits {
  if (OWNER_ONLY_LICENSES.has(id)) {
    return {
      commercial: false,
      derivatives: false,
      shareAlike: false,
      redistributable: false,
      known: true,
    };
  }
  if (id.startsWith("LicenseRef-") || id.startsWith("DocumentRef-")) {
    return {
      commercial: true,
      derivatives: true,
      shareAlike: false,
      redistributable: true,
      known: false,
    };
  }
  const cc = id.startsWith("CC-");
  return {
    commercial: !(cc && id.includes("-NC")),
    derivatives: !(cc && id.includes("-ND")),
    shareAlike: SHARE_ALIKE_PREFIXES.some((p) => id.startsWith(p)),
    redistributable: true,
    known: true,
  };
}

/**
 * 把表达式展开成“备选项”列表：使用者可以任选一个备选项，每个备选项内的许可必须同时遵守。
 * 例如 `MIT AND (CC-BY-4.0 OR CC0-1.0)` → `[[MIT, CC-BY-4.0], [MIT, CC0-1.0]]`。
 */
export function licenseAlternatives(node: LicenseNode): string[][] {
  if ("license" in node) return [[node.license]];
  const left = licenseAlternatives(node.left);
  const right = licenseAlternatives(node.right);
  if (node.conjunction === "or") return guard([...left, ...right]);
  const out: string[][] = [];
  for (const l of left) {
    for (const r of right) {
      out.push([...l, ...r]);
      guard(out);
    }
  }
  return out;
}

function guard(alts: string[][]): string[][] {
  if (alts.length > MAX_ALTERNATIVES) {
    throw new CharError({
      code: "license.too_complex",
      subject: "license",
      detail: `expression expands to more than ${MAX_ALTERNATIVES} alternatives`,
    });
  }
  return alts;
}

/** 一组必须同时遵守的许可的合并特征：每条都取最严格的。 */
function combineAll(ids: readonly string[]): LicenseTraits {
  const all = ids.map(licenseTraits);
  return {
    commercial: all.every((t) => t.commercial),
    derivatives: all.every((t) => t.derivatives),
    shareAlike: all.some((t) => t.shareAlike),
    redistributable: all.every((t) => t.redistributable),
    known: all.every((t) => t.known),
  };
}

/** 表达式每个备选项的合并特征。 */
export function expressionTraits(expr: string): LicenseTraits[] {
  return licenseAlternatives(parseLicense(expr)).map(combineAll);
}

const VERDICT_RANK: Record<LicenseVerdict, number> = { pass: 0, warn: 1, fail: 2 };

function verdictOf(reasons: readonly LicenseReason[]): LicenseVerdict {
  let v: LicenseVerdict = "pass";
  for (const r of reasons) if (VERDICT_RANK[r.verdict] > VERDICT_RANK[v]) v = r.verdict;
  return v;
}

function result(reasons: LicenseReason[]): LicenseCheck {
  return { verdict: verdictOf(reasons), reasons };
}

/** 在多个备选项的检查结果中选对使用者最有利的一个。 */
function best(checks: readonly LicenseCheck[]): LicenseCheck {
  let out = checks[0] ?? result([]);
  for (const c of checks) if (VERDICT_RANK[c.verdict] < VERDICT_RANK[out.verdict]) out = c;
  return out;
}

/** 把多项检查合并成一个结果：取最严重的结论，原因全部保留。 */
export function combineLicenseChecks(checks: readonly LicenseCheck[]): LicenseCheck {
  return result(checks.flatMap((c) => c.reasons));
}

export interface RedistributionOptions {
  /** 发布者就是权利人（例如作者发布自己的作品、或依赖属于同一个 namespace）。 */
  same_owner?: boolean;
}

/**
 * char.pub 能否再分发某个许可下的内容。
 * 保留所有权利的内容只能由权利人本人发布；不认识的许可给出警告，交给作者确认。
 */
export function isRedistributable(expr: string, opts: RedistributionOptions = {}): LicenseCheck {
  const checks = expressionTraits(expr).map((t): LicenseCheck => {
    const reasons: LicenseReason[] = [];
    if (!t.redistributable && !opts.same_owner) {
      reasons.push({
        code: "license.not_redistributable",
        verdict: "fail",
        detail: `'${expr}' does not allow redistribution; only the rights holder can publish it`,
      });
    }
    if (!t.known) {
      reasons.push({
        code: "license.unknown",
        verdict: "warn",
        detail: `'${expr}' is not a license char.pub recognizes; make sure it allows redistribution`,
      });
    }
    return result(reasons);
  });
  return best(checks);
}

export interface DependencyLicenseInput {
  /** 引用方（正在发布的 Creation）的许可。 */
  dependent: string;
  /** 被引用的 Creation 或 Asset 的许可。 */
  dependency: string;
  /** 两者属于同一个权利人。 */
  same_owner?: boolean;
  /** 引用方改动了依赖的内容（override 的 replace、remove 或 add）。 */
  modified?: boolean;
}

/**
 * 检查引用方与一个依赖的许可是否相容：
 * - 依赖不允许再分发且不属于同一权利人 → fail；
 * - 依赖禁止改编，而引用方改动了它的内容 → fail；
 * - 依赖禁止商用，而引用方声明的许可允许商用 → warn（组合后的作品实际上不能商用）；
 * - 依赖要求相同方式共享，而引用方改动了它、却使用了不同的许可 → warn；
 * - 依赖的许可无法识别 → warn。
 */
export function checkDependencyLicense(input: DependencyLicenseInput): LicenseCheck {
  const dependentAllowsCommercial = expressionTraits(input.dependent).some((t) => t.commercial);
  const checks = expressionTraits(input.dependency).map((t): LicenseCheck => {
    const reasons: LicenseReason[] = [];
    const dep = `'${input.dependency}'`;
    if (!t.redistributable && !input.same_owner) {
      reasons.push({
        code: "license.dependency_not_redistributable",
        verdict: "fail",
        detail: `${dep} reserves all rights; only its rights holder can build on it`,
      });
    }
    if (!t.derivatives && input.modified) {
      reasons.push({
        code: "license.dependency_no_derivatives",
        verdict: "fail",
        detail: `${dep} does not allow modified versions, but this creation overrides its content`,
      });
    }
    // 保留所有权利的许可本身就禁止一切使用，“禁止商用”只对开放许可有额外意义。
    if (!t.commercial && t.redistributable && dependentAllowsCommercial) {
      reasons.push({
        code: "license.noncommercial_dependency",
        verdict: "warn",
        detail: `${dep} forbids commercial use, so '${input.dependent}' cannot actually be used commercially`,
      });
    }
    if (t.shareAlike && input.modified && input.dependent !== input.dependency) {
      reasons.push({
        code: "license.sharealike_dependency",
        verdict: "warn",
        detail: `${dep} requires modified versions to use the same license`,
      });
    }
    if (!t.known) {
      reasons.push({
        code: "license.dependency_unknown",
        verdict: "warn",
        detail: `${dep} is not a license char.pub recognizes`,
      });
    }
    return result(reasons);
  });
  return best(checks);
}

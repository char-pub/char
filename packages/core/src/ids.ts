/**
 * 公共标识符的语法：namespace、name、版本 label、fragment ID，以及它们组合成的引用。
 * namespace / name 只允许小写 ASCII slug，展示用的名字放在 display_name 里（任意 Unicode）。
 * 所有正则都锚定首尾；解析函数返回 null 表示非法，不抛异常。
 */

const NAMESPACE_SRC = "[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?";
const NAME_SRC = "[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?";
const LABEL_SRC = "[0-9A-Za-z.+-]{1,64}";
const SEGMENT_SRC = "[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?";
const FRAGMENT_ID_SRC = `${SEGMENT_SRC}(?:/${SEGMENT_SRC}){0,3}`;

export const NAMESPACE_RE = new RegExp(`^${NAMESPACE_SRC}$`);
export const NAME_RE = new RegExp(`^${NAME_SRC}$`);
export const LABEL_RE = new RegExp(`^${LABEL_SRC}$`);
export const SEGMENT_RE = new RegExp(`^${SEGMENT_SRC}$`);
export const FRAGMENT_ID_RE = new RegExp(`^${FRAGMENT_ID_SRC}$`);

const CREATION_REF_RE = new RegExp(`^@(${NAMESPACE_SRC})/(${NAME_SRC})(?:@(${LABEL_SRC}))?$`);
const UNVERSIONED_REF_RE = new RegExp(`^@(${NAMESPACE_SRC})/(${NAME_SRC})$`);
const LOCAL_REF_RE = new RegExp(`^#(${FRAGMENT_ID_SRC})$`);
const FULL_REF_RE = new RegExp(
  `^@(${NAMESPACE_SRC})/(${NAME_SRC})(?:@(${LABEL_SRC}))?#(${FRAGMENT_ID_SRC})$`,
);

export interface ParsedCreationRef {
  namespace: string;
  name: string;
  label?: string;
}

export interface ParsedFullRef extends ParsedCreationRef {
  fragment: string;
}

export function isNamespace(s: string): boolean {
  return NAMESPACE_RE.test(s);
}

export function isName(s: string): boolean {
  return NAME_RE.test(s);
}

export function isLabel(s: string): boolean {
  return LABEL_RE.test(s);
}

export function isFragmentId(s: string): boolean {
  return FRAGMENT_ID_RE.test(s);
}

/** `@namespace/name` 或 `@namespace/name@label`。 */
export function parseCreationRef(s: string): ParsedCreationRef | null {
  const m = CREATION_REF_RE.exec(s);
  if (!m) return null;
  const [, namespace, name, label] = m;
  if (namespace === undefined || name === undefined) return null;
  return label === undefined ? { namespace, name } : { namespace, name, label };
}

/** 不带版本 label 的公共标识，Context IR 里的 creation-ref 都用这种形式。 */
export function isUnversionedRef(s: string): boolean {
  return UNVERSIONED_REF_RE.test(s);
}

/** `#fragment_id`：同一 Creation / Project 内的引用。返回 fragment_id。 */
export function parseLocalRef(s: string): string | null {
  const m = LOCAL_REF_RE.exec(s);
  return m?.[1] ?? null;
}

/** `@namespace/name[@label]#fragment_id`。 */
export function parseFullRef(s: string): ParsedFullRef | null {
  const m = FULL_REF_RE.exec(s);
  if (!m) return null;
  const [, namespace, name, label, fragment] = m;
  if (namespace === undefined || name === undefined || fragment === undefined) return null;
  return label === undefined ? { namespace, name, fragment } : { namespace, name, label, fragment };
}

export function formatCreationRef(ref: ParsedCreationRef): string {
  return ref.label === undefined
    ? `@${ref.namespace}/${ref.name}`
    : `@${ref.namespace}/${ref.name}@${ref.label}`;
}

/** 去掉 label：`@djj/alice@1.2.0` → `@djj/alice`。非法输入返回 null。 */
export function unversioned(ref: string): string | null {
  const p = parseCreationRef(ref);
  return p ? `@${p.namespace}/${p.name}` : null;
}

// ---------------------------------------------------------------------------
// 内部 ID：TypeID 形式 `<prefix>_<26 位 base32>`，载荷是 UUIDv7。内部 ID 不随改名变化。
// core 只校验格式；ID 由调用方生成后传入，因为 core 不读时钟、不取随机数。
// ---------------------------------------------------------------------------

const TYPEID_SUFFIX_SRC = "[0-7][0-9a-hjkmnp-tv-z]{25}";

export const ID_PREFIXES = {
  namespace: "ns",
  creation: "cr",
  release: "rel",
  revision: "rev",
  user: "usr",
  contribution: "ctb",
  upload: "upl",
  import: "imp",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ID_RES: Record<IdKind, RegExp> = Object.fromEntries(
  Object.entries(ID_PREFIXES).map(([k, p]) => [k, new RegExp(`^${p}_${TYPEID_SUFFIX_SRC}$`)]),
) as Record<IdKind, RegExp>;

export function isId(kind: IdKind, s: string): boolean {
  return ID_RES[kind].test(s);
}

export function idPattern(kind: IdKind): RegExp {
  return ID_RES[kind];
}

// ---------------------------------------------------------------------------
// Digest：`sha256:<64 位小写 hex>`
// ---------------------------------------------------------------------------

export const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export function isDigest(s: string): boolean {
  return DIGEST_RE.test(s);
}

// ---------------------------------------------------------------------------
// 模板占位符里的名字。模板只做纯值替换，没有表达式。
// ---------------------------------------------------------------------------

export const SLOT_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const PARAM_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const CAST_KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/;

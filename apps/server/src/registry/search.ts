/**
 * 搜索。数据留在 Postgres，不引入独立的搜索服务。
 *
 * 两种索引配合使用：
 * - `search_text` 上的 pg_trgm GIN 索引：处理三个字符及以上的查询和拉丁语系文本；
 * - `search_grams`（应用层生成的一字 / 二字 n-gram 数组）上的 GIN 索引：处理一到两个字的
 *   中日韩查询。pg_trgm 以三字为单位，这类短查询用不上它的索引。
 *
 * mature / explicit 的过滤在服务端强制执行：匿名用户、以及没有在设置中开启的用户，
 * 只能搜到 effective rating 为 general / teen 的作品。effective rating 取最新 public
 * Release 的值，包含依赖和 asset 带来的分级。
 */
import type { CreationSummary } from "@char-pub/contracts";
import type { CreationType, Rating } from "@char-pub/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Principal } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import { creations, namespaces, releases, userSettings } from "../db/schema/index.js";
import { effectiveRatingOf, refOf, releaseSummary, toPublicId } from "./read.js";

/** 中日韩统一表意文字、假名、韩文音节等“按字切分”的文字。 */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_RE = /[\p{L}\p{N}]+/gu;

export function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * 从一段文本生成短查询用的 gram：中日韩文字每个字一个 unigram，相邻两字一个 bigram；
 * 其他文字按词切分，每个词本身作为一项。结果去重并排序，保证同样的文本总是得到同样的数组。
 */
export function buildSearchTerms(text: string): string[] {
  const out = new Set<string>();
  for (const word of normalizeForSearch(text).match(WORD_RE) ?? []) {
    const chars = [...word];
    let run: string[] = [];
    const flush = () => {
      if (run.length > 0) out.add(run.join(""));
      run = [];
    };
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i] as string;
      if (CJK_RE.test(ch)) {
        flush();
        out.add(ch);
        const next = chars[i + 1];
        if (next !== undefined && CJK_RE.test(next)) out.add(ch + next);
      } else {
        run.push(ch);
      }
    }
    flush();
  }
  return [...out].sort();
}

/**
 * 把一个短查询（一到两个字）拆成需要全部命中的 gram。
 * 例如“魔法”→ [“魔法”]，“猫”→ [“猫”]，“ab”→ [“ab”]。
 */
export function queryGrams(q: string): string[] {
  const words = normalizeForSearch(q).match(WORD_RE) ?? [];
  const out: string[] = [];
  for (const w of words) {
    const chars = [...w];
    if (chars.every((c) => CJK_RE.test(c)) && chars.length <= 2) out.push(w);
    else out.push(...buildSearchTerms(w));
  }
  return [...new Set(out)];
}

/** 用于 pg_trgm 的拼接文本：所有 locale 的名字、简介、标签和公共标识。 */
export function buildSearchText(input: {
  ref: string;
  displayName: unknown;
  summary: unknown;
  tags: readonly string[];
}): string {
  const texts = (v: unknown): string[] =>
    typeof v === "string"
      ? [v]
      : v && typeof v === "object"
        ? Object.values(v).filter((x): x is string => typeof x === "string")
        : [];
  return normalizeForSearch(
    [input.ref, ...texts(input.displayName), ...texts(input.summary), ...input.tags].join("\n"),
  );
}

/** 写入或刷新一个 Creation 的搜索列。发布与改名时调用。 */
export async function refreshSearchColumns(db: Executor, creationId: string): Promise<void> {
  const [row] = await db
    .select({ c: creations, slug: namespaces.slug })
    .from(creations)
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(eq(creations.id, creationId))
    .limit(1);
  if (!row) return;
  const text = buildSearchText({
    ref: `@${row.slug}/${row.c.name}`,
    displayName: row.c.displayName,
    summary: row.c.summary,
    tags: row.c.tags,
  });
  await db
    .update(creations)
    .set({ searchText: text, searchGrams: buildSearchTerms(text) })
    .where(eq(creations.id, creationId));
}

export const SAFE_RATINGS: readonly Rating[] = ["general", "teen"];
export const ALL_RATINGS: readonly Rating[] = ["general", "teen", "mature", "explicit"];

/** 调用者可以看到的 rating。只有登录并在设置中开启了成人内容的用户才能看到全部。 */
export async function allowedRatings(
  db: Executor,
  principal: Principal,
): Promise<readonly Rating[]> {
  if (principal.kind !== "user") return SAFE_RATINGS;
  const [s] = await db
    .select({ show: userSettings.showMature, confirmed: userSettings.matureConfirmedAt })
    .from(userSettings)
    .where(eq(userSettings.userId, principal.user_id))
    .limit(1);
  return s?.show && s.confirmed ? ALL_RATINGS : SAFE_RATINGS;
}

export interface SearchInput {
  q?: string | undefined;
  type?: CreationType | undefined;
  tag?: string | undefined;
  limit: number;
  /** 上一页最后一条的偏移量（按排序后的位置）。 */
  offset: number;
}

/** 三个字符以下时用 gram 索引，否则用 pg_trgm。 */
export function searchMode(q: string): "grams" | "trigram" {
  return [...normalizeForSearch(q).trim()].length < 3 ? "grams" : "trigram";
}

export async function searchCreations(
  db: Executor,
  input: SearchInput,
  ratings: readonly Rating[],
): Promise<{ items: CreationSummary[]; hasMore: boolean }> {
  const latest = db
    .select({
      creationId: releases.creationId,
      id: sql<string>`(array_agg(${releases.id} ORDER BY ${releases.createdAt} DESC, ${releases.id} DESC))[1]`.as(
        "latest_id",
      ),
    })
    .from(releases)
    .where(
      and(
        eq(releases.visibility, "public"),
        eq(releases.publishState, "done"),
        eq(releases.status, "active"),
      ),
    )
    .groupBy(releases.creationId)
    .as("latest");

  const conds = [
    eq(creations.status, "active"),
    eq(namespaces.status, "active"),
    inArray(releases.effectiveRating, [...ratings]),
    // 员工强制调高的评级同样参与过滤。
    sql`(${creations.forcedRating} IS NULL OR ${creations.forcedRating} IN (${sql.join(
      ratings.map((r) => sql`${r}::app.rating`),
      sql`, `,
    )}))`,
  ];
  if (input.type) conds.push(eq(creations.type, input.type));
  if (input.tag)
    conds.push(sql`${creations.tags} @> ARRAY[${normalizeForSearch(input.tag)}]::text[]`);

  // 不能写成字面量 0：ORDER BY 里的整数字面量会被当成列序号。
  let rank = sql<number>`0::real`;
  const q = input.q?.trim();
  if (q) {
    const nq = normalizeForSearch(q);
    if (searchMode(q) === "grams") {
      const grams = queryGrams(q);
      if (grams.length === 0) return { items: [], hasMore: false };
      conds.push(
        sql`${creations.searchGrams} @> ARRAY[${sql.join(
          grams.map((g) => sql`${g}`),
          sql`, `,
        )}]::text[]`,
      );
    } else {
      // word_similarity 适合“短查询匹配长文本”的场景；ILIKE 保证子串一定能命中。
      conds.push(
        sql`(${nq} <% ${creations.searchText} OR ${creations.searchText} ILIKE ${`%${nq.replace(/[%_\\]/g, "\\$&")}%`})`,
      );
      rank = sql<number>`word_similarity(${nq}, ${creations.searchText})`;
    }
  }

  const rows = await db
    .select({ c: creations, slug: namespaces.slug, r: releases, rank })
    .from(creations)
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .innerJoin(latest, eq(latest.creationId, creations.id))
    .innerJoin(releases, eq(releases.id, latest.id))
    .where(and(...conds))
    .orderBy(desc(rank), desc(releases.createdAt), creations.id)
    .limit(input.limit + 1)
    .offset(input.offset);

  const items = rows.slice(0, input.limit).map(({ c, slug, r }): CreationSummary => {
    const s: CreationSummary = {
      id: toPublicId("creation", c.id),
      ref: refOf(slug, c.name),
      type: c.type,
      display_name: c.displayName as CreationSummary["display_name"],
      rating: c.rating,
      effective_rating: effectiveRatingOf(r.effectiveRating ?? c.rating, c.forcedRating),
      tags: c.tags,
      latest_release: releaseSummary(r),
    };
    if (c.summary !== null) s.summary = c.summary as CreationSummary["display_name"];
    return s;
  });
  return { items, hasMore: rows.length > input.limit };
}

/**
 * 公开搜索：`GET /v1/search?q=&type=&tag=&cursor=&limit=`。
 *
 * 结果只包含有 active public Release 的作品；mature / explicit 的过滤在服务端强制，
 * 客户端无法通过参数绕过。
 */
import { SearchQuerySchema } from "@char-pub/contracts";
import type { Hono } from "hono";
import { problem } from "../../http/middleware.js";
import { allowedRatings, searchCreations } from "../../registry/search.js";
import { type Env, route } from "../app.js";

/** 搜索的分页游标就是结果中的偏移量，编码成不透明的字符串。 */
function decodeOffset(cursor: string | undefined): number | null {
  if (!cursor) return 0;
  if (!/^o[0-9]{1,6}$/.test(cursor)) return null;
  return Number(cursor.slice(1));
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "get",
    path: "/v1/search",
    authorize: async () => ({ public: true, loaded: null }),
    handler: async (c) => {
      const parsed = SearchQuerySchema.safeParse(c.req.query());
      if (!parsed.success) {
        return problem(c, 422, "request.invalid", parsed.error.issues[0]?.message);
      }
      const offset = decodeOffset(parsed.data.cursor);
      if (offset === null) return problem(c, 422, "request.invalid", "invalid cursor");
      const { db } = c.var.services;
      const ratings = await allowedRatings(db, c.var.principal);
      const { items, hasMore } = await searchCreations(
        db,
        {
          q: parsed.data.q,
          type: parsed.data.type,
          tag: parsed.data.tag,
          limit: parsed.data.limit,
          offset,
        },
        ratings,
      );
      // 结果因人而异（成人内容设置），CDN 只能缓存匿名请求的结果。
      c.header(
        "cache-control",
        c.var.principal.kind === "anonymous"
          ? "public, max-age=30, s-maxage=60"
          : "private, no-store",
      );
      c.header("vary", "Cookie, Authorization");
      return c.json({
        items,
        next_cursor: hasMore ? `o${offset + parsed.data.limit}` : null,
      });
    },
  });
}

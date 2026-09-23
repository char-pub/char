import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const DiffSearchSchema = z.object({
  from: z.string().max(64).optional().catch(undefined),
  to: z.string().max(64).optional().catch(undefined),
});

/** 旧的版本对比地址：对比已经并入 Versions 标签，保留 `from` / `to` 重定向过去。 */
export const Route = createFileRoute("/c/$ns/$name_/diff")({
  validateSearch: (s) => DiffSearchSchema.parse(s),
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/c/$ns/$name/versions",
      params: { ns: params.ns, name: params.name },
      search: {
        ...(search.from ? { from: search.from } : {}),
        ...(search.to ? { to: search.to } : {}),
      },
      replace: true,
    });
  },
});

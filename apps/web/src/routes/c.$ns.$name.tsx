import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { CreationShell } from "@/components/creation-shell";

const CreationSearchSchema = z.object({
  /** 查看的版本；缺省为最新的 public Release。所有标签页共用，切换标签时保留。 */
  v: z.string().max(64).optional().catch(undefined),
});

/**
 * 作品的公开页面（Overview、Context preview、Versions、Contributions、Settings）共用的外框：
 * 头部、标签栏和整页状态由 `CreationShell` 负责，标签页用 `useCreation()` 读取已加载的数据。
 * 编辑器 `/c/$ns/$name/edit` 不在这个外框里。
 */
export const Route = createFileRoute("/c/$ns/$name")({
  validateSearch: (s) => CreationSearchSchema.parse(s),
  component: CreationFrame,
});

function CreationFrame() {
  const { ns, name } = Route.useParams();
  const { v } = Route.useSearch();
  return (
    <CreationShell ns={ns} name={name} v={v}>
      <Outlet />
    </CreationShell>
  );
}

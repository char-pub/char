import { createFileRoute } from "@tanstack/react-router";
import { useCreation } from "@/components/creation-context";
import { FactCard } from "@/components/creation-facts";
import { ContributionPolicySettings } from "@/components/creation-settings";
import { DeletionRequestButton } from "@/components/deletion-request";
import { SourceBindingSettings } from "@/components/source-binding";
import { NotFound } from "@/components/states";

export const Route = createFileRoute("/c/$ns/$name/settings")({ component: SettingsTab });

/**
 * 作品设置，只有这个 namespace 的成员能进；其他人看到和不存在一样的 404。
 * 版本是永久的：作者只能 yank，彻底移除通过请求表单交给员工审核。
 */
function SettingsTab() {
  const c = useCreation();
  if (!c.isOwner) {
    return <NotFound level={2} what={`${c.detail.ref}/settings`} />;
  }
  return (
    <div className="max-w-3xl space-y-4">
      {/* 不按 policy 重新挂载：保存后刷新作品数据时，正在输入的邀请不能被清空。 */}
      <ContributionPolicySettings ns={c.ns} name={c.name} policy={c.detail.contribution_policy} />
      <SourceBindingSettings ns={c.ns} name={c.name} />
      <FactCard id="settings-danger" title="Danger zone" className="space-y-3 px-6 py-5">
        <p className="-mt-2 text-sm text-text-2">
          Releases are permanent. You can yank a version from the Versions tab, or ask us to remove
          it.
        </p>
        <DeletionRequestButton creation={c.detail.ref} />
      </FactCard>
    </div>
  );
}

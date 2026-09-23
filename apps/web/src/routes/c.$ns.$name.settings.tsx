import { createFileRoute, Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useCreation } from "@/components/creation-context";
import { FactCard } from "@/components/creation-facts";
import { ContributionPolicySettings } from "@/components/creation-settings";
import { SourceBindingSettings } from "@/components/source-binding";
import { NotFound } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/c/$ns/$name/settings")({ component: SettingsTab });

/**
 * 作品设置，只有这个 namespace 的成员能进；其他人看到和不存在一样的 404。
 * 版本是永久的：作者只能 yank，彻底移除要请员工处理（目前先链接到内容政策页）。
 */
function SettingsTab() {
  const c = useCreation();
  if (!c.isOwner) {
    return <NotFound level={2} what={`${c.detail.ref}/settings`} />;
  }
  return (
    <div className="max-w-3xl space-y-4">
      <ContributionPolicySettings
        key={c.detail.contribution_policy}
        ns={c.ns}
        name={c.name}
        policy={c.detail.contribution_policy}
      />
      <SourceBindingSettings ns={c.ns} name={c.name} />
      <FactCard id="settings-danger" title="Danger zone" className="space-y-3 px-6 py-5">
        <p className="-mt-2 text-sm text-text-2">
          Releases are permanent. You can yank a version from the Versions tab, or ask us to remove
          it.
        </p>
        <Link to="/policy" hash="report" className={buttonVariants({ variant: "destructive" })}>
          <Trash2 aria-hidden /> Request removal…
        </Link>
      </FactCard>
    </div>
  );
}

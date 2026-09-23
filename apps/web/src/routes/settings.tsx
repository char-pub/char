import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MatureSetting } from "@/components/mature-setting";
import { RenameNamespaceDialog } from "@/components/settings/rename-namespace";
import { SettingsNav, SettingsSection } from "@/components/settings/section";
import { SignInRequired } from "@/components/sign-in-required";
import { PageSkeleton } from "@/components/skeletons";
import { TokenManager } from "@/components/token-manager";
import { buttonVariants } from "@/components/ui/button";
import { UserText } from "@/components/user-content";
import { keys, refreshPersonalised, useMe, useRegistry } from "@/lib/registry";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  const me = useMe();
  const client = useRegistry();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: { show_mature: boolean; confirm_adult?: boolean }) =>
      client.updateSettings(body),
    onSuccess: async (next) => {
      qc.setQueryData(keys.me, next);
      await refreshPersonalised(qc);
    },
  });

  if (me.isPending) return <PageSkeleton label="Loading your settings…" />;
  if (!me.data) return <SignInRequired what="change your settings" />;
  const s = me.data.settings;
  const ns = me.data.namespace;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Settings</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <SettingsNav />
        <div className="min-w-0 space-y-6">
          <SettingsSection
            id="profile"
            title="Profile"
            description="Your @name is your public namespace. Changing it keeps old links redirecting, and nobody else can take the old name."
          >
            {ns ? (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Namespace</p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-surface-2 px-3 font-mono text-sm break-all sm:max-w-sm">
                    @{ns}
                  </p>
                  <RenameNamespaceDialog current={ns} />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
                <p className="text-sm text-text-2">
                  You haven't chosen your @name yet. You pick it before your first creation.
                </p>
                <Link to="/create" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Choose your @name
                </Link>
              </div>
            )}
            <p className="text-sm text-text-3">
              Signed in as <UserText text={me.data.name} />. Your creations are published under your
              @name, not this name.
            </p>
          </SettingsSection>

          <SettingsSection id="content" title="Content">
            <MatureSetting
              enabled={s.show_mature}
              confirmedAt={s.mature_confirmed_at}
              saving={save.isPending}
              error={save.isError ? "Could not save the setting. Try again." : null}
              onChange={(body) => save.mutate(body)}
            />
          </SettingsSection>

          <SettingsSection
            id="tokens"
            title="API tokens"
            description={
              <>
                For the <code className="font-mono">char</code> CLI, CI and agents. Tokens act as
                you, within the scopes you choose.
              </>
            }
          >
            <TokenManager />
          </SettingsSection>

          {/* 下面两块的接口还没有开放：只说明现状，不放不能用的按钮。 */}
          <SettingsSection
            id="sign-in"
            title="Sign-in methods"
            description="char.pub signs you in with GitHub, Discord or Google. There is no password."
          >
            <p className="text-sm text-text-2">
              Adding a second sign-in method to this account isn't available yet. Accounts are never
              linked by matching email addresses.
            </p>
          </SettingsSection>

          <SettingsSection
            id="data"
            title="Your data"
            description="Downloading everything you've made and deleting your account will live here."
          >
            <p className="text-sm text-text-2">
              Neither is available on the web yet. Until then, every public release can be
              downloaded from its creation page.
            </p>
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}

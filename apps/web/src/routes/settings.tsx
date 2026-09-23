import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MatureSetting } from "@/components/mature-setting";
import { SignInRequired } from "@/components/sign-in-required";
import { TokenManager } from "@/components/token-manager";
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

  if (me.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (!me.data) return <SignInRequired what="change your settings" />;
  const s = me.data.settings;

  return (
    <div className="max-w-3xl space-y-12">
      <header className="space-y-1">
        <h1 className="text-4xl">Settings</h1>
        <p className="text-muted-foreground">
          Signed in as {me.data.name}
          {me.data.namespace ? (
            <>
              {" "}
              · <span className="font-mono">@{me.data.namespace}</span>
            </>
          ) : null}
        </p>
      </header>

      <section aria-labelledby="s-content" className="space-y-4">
        <h2 id="s-content" className="border-b border-rule pb-1 text-2xl">
          Content
        </h2>
        <MatureSetting
          enabled={s.show_mature}
          confirmedAt={s.mature_confirmed_at}
          saving={save.isPending}
          error={save.isError ? "Could not save the setting. Try again." : null}
          onChange={(body) => save.mutate(body)}
        />
      </section>

      <section id="tokens" aria-labelledby="s-tokens" className="scroll-mt-8 space-y-4">
        <h2 id="s-tokens" className="border-b border-rule pb-1 text-2xl">
          Personal access tokens
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Tokens let the <code className="font-mono">char</code> CLI and scripts act on your behalf
          with the scopes you choose. They cannot manage tokens or change these settings.
        </p>
        <TokenManager />
      </section>
    </div>
  );
}

/**
 * “Propose a change” 页（作品 Contributions 标签页里的一页）：左边是提交表单，右边是访客
 * 身份和“接下来会发生什么”。
 *
 * 能不能提交按这个顺序判断：作品关闭了贡献 → 还没有公开 Release（没有可以修改的基线）→
 * 是自己的作品（直接去编辑器）→ 已登录 → 作品只接受登录用户 → 已验证的访客 → 访客验证。
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GitPullRequestClosed, PackageOpen, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { SignInRequired } from "@/components/sign-in-required";
import { ListSkeleton, PageSkeleton } from "@/components/skeletons";
import { EmptyState, ErrorState, NotFound } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { type GuestSession, isApiError } from "@/lib/api";
import { keys, useGuest, useMe, useRegistry } from "@/lib/registry";
import { localized } from "@/lib/text";
import { ContributionForm } from "./contribution-form";
import { GuestIdentityCard, GuestVerificationForm } from "./guest";

/** 右侧说明栏：提交之后的三步。 */
function WhatHappensNext({ owner }: { owner: string }) {
  const steps = [
    `@${owner} reviews your change against their draft.`,
    "If accepted, it goes into their draft.",
    "It's credited to you in the next release.",
  ];
  return (
    <section aria-labelledby="cn-next" className="space-y-3 rounded-lg bg-surface-2 p-5">
      <h3 id="cn-next" className="text-sm font-semibold">
        What happens next
      </h3>
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={s} className="flex items-start gap-2.5 text-sm text-text-2">
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-surface text-xs font-semibold text-text"
            >
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Layout({
  owner,
  guest,
  children,
}: {
  owner: string;
  guest?: GuestSession | null | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-bold">Propose a change</h2>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">{children}</div>
        <aside aria-label="About contributing" className="space-y-4">
          {guest ? <GuestIdentityCard session={guest} /> : null}
          <WhatHappensNext owner={owner} />
        </aside>
      </div>
    </div>
  );
}

export function NewContributionTab({ ns, name }: { ns: string; name: string }) {
  const client = useRegistry();
  const me = useMe();
  const guest = useGuest(!me.isPending && !me.data);
  const detail = useQuery({
    queryKey: [...keys.creation(ns, name), me.data?.id ?? null],
    queryFn: () => client.creation(ns, name),
    enabled: !me.isPending,
  });

  if (detail.isPending || me.isPending) return <PageSkeleton label="Loading…" />;
  if (detail.isError) {
    return isApiError(detail.error) && detail.error.status === 404 ? (
      <NotFound what={`@${ns}/${name}`} level={2} />
    ) : (
      <ErrorState
        title="This creation could not be loaded"
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const d = detail.data;
  const label = d.latest_release?.label;
  const back = (
    <Link
      to="/c/$ns/$name/contributions"
      params={{ ns, name }}
      className={buttonVariants({ variant: "outline" })}
    >
      See contributions
    </Link>
  );

  if (d.contribution_policy === "closed") {
    return (
      <Layout owner={ns}>
        <EmptyState
          icon={GitPullRequestClosed}
          title="This creation isn't accepting contributions"
          description="The author has closed contributions for now."
          action={back}
        />
      </Layout>
    );
  }
  if (!label) {
    return (
      <Layout owner={ns}>
        <EmptyState
          icon={PackageOpen}
          title="Nothing to build on yet"
          description="This creation has no public release yet, so there is nothing to change."
          action={back}
        />
      </Layout>
    );
  }
  if (me.data?.namespace === ns) {
    return (
      <Layout owner={ns}>
        <EmptyState
          icon={Pencil}
          title="This is your creation"
          description="Edit the draft directly instead of proposing a change to yourself."
          action={
            <Link to="/c/$ns/$name/edit" params={{ ns, name }} className={buttonVariants()}>
              Edit the draft
            </Link>
          }
        />
      </Layout>
    );
  }
  const form = <ContributionForm ns={ns} name={name} label={label} type={d.type} />;
  if (me.data) return <Layout owner={ns}>{form}</Layout>;
  if (d.contribution_policy !== "anyone") {
    return (
      <Layout owner={ns}>
        <SignInRequired
          level={2}
          what="propose a change"
          description={`Contributions to ${localized(d.display_name)} need a char.pub account.`}
        />
      </Layout>
    );
  }
  if (guest.isPending) {
    return (
      <Layout owner={ns}>
        <ListSkeleton rows={2} />
      </Layout>
    );
  }
  if (guest.data) {
    return (
      <Layout owner={ns} guest={guest.data}>
        {form}
      </Layout>
    );
  }
  return (
    <Layout owner={ns}>
      <GuestVerificationForm returnTo={`/c/${ns}/${name}/contributions/new`} />
    </Layout>
  );
}

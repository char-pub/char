/**
 * 内容政策（占位页）。政策正文和运营主体还没有确定，这里只说明现状，并给出现在就能用的
 * 举报和安全联系渠道（SECURITY.md 里的 GitHub 私密报告）。页脚的 Content policy 和
 * Report content（`#report`）都指向这里；政策定稿后替换正文。
 */
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Flag, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/policy")({ component: Policy });

const SECURITY = "https://github.com/char-pub/char/blob/main/SECURITY.md";

function Policy() {
  return (
    <article className="mx-auto max-w-2xl space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl sm:text-4xl">Content policy</h1>
        <p className="rounded-lg bg-blue-soft px-4 py-3 text-sm text-blue-text">
          The content policy is still being drafted. This page will hold the full rules once they
          are published.
        </p>
        <p className="text-text-2">
          Until then, creations must follow the law and respect other people&apos;s rights. Every
          creation carries a rating, and mature or explicit creations stay hidden unless a reader
          turns them on.
        </p>
      </header>

      <section id="report" aria-labelledby="report-title" className="scroll-mt-8 space-y-3">
        <h2 id="report-title" className="flex items-center gap-2 text-xl">
          <Flag aria-hidden className="size-5 text-danger" /> Report content
        </h2>
        <p className="text-text-2">
          To report a creation that may be illegal, infringe your rights, or put someone at risk,
          use the private reporting channel described in our security policy. Private reports are
          only visible to the char.pub team.
        </p>
        <p className="text-text-2">
          Include the address of the creation (for example{" "}
          <code className="font-mono text-sm text-text">@namespace/name@1.0.0</code>) and what is
          wrong. Never attach illegal material: the address is enough for us to find it.
        </p>
        <a href={SECURITY} className={buttonVariants({ variant: "outline" })}>
          How to report <ExternalLink aria-hidden />
        </a>
      </section>

      <section aria-labelledby="security-title" className="space-y-3">
        <h2 id="security-title" className="flex items-center gap-2 text-xl">
          <ShieldCheck aria-hidden className="size-5 text-success" /> Security
        </h2>
        <p className="text-text-2">
          Found a vulnerability in char.pub? Please don&apos;t open a public issue. Our{" "}
          <a href={SECURITY} className="text-blue-text underline-offset-4 hover:underline">
            security policy
          </a>{" "}
          explains how to report it privately and what to expect from us.
        </p>
      </section>
    </article>
  );
}

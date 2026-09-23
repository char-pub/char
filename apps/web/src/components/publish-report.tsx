/**
 * Publish Report：发布检查的结果。错误会阻止发布（label 被释放，可以修改后重试），
 * 警告不阻止发布；许可检查给出 pass / warn / fail。
 *
 * 失败的原因尽量用人话讲清楚，同时保留错误码方便查文档或反馈。菱形依赖（同一个作品被两条
 * 路径拉进来、版本又不同）要列出两条来源路径，作者才知道该改哪一个。
 */
import type { ReferenceEdge } from "@char-pub/core";
import { CircleX } from "lucide-react";
import type { ReactNode } from "react";
import type { PublishReportResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export const LICENSE_TEXT = {
  pass: "Licenses are compatible.",
  warn: "Licenses need attention — see the warnings.",
  fail: "Licenses do not allow this combination.",
} as const;

type Issue = NonNullable<PublishReportResponse["report"]>["issues"][number];

export interface IssueContext {
  /** 作品的显示名，路径的起点。 */
  root: string;
  /** 草稿里的依赖：路径的第一跳是这里的 edge ID，换成它的 ref 更好读。 */
  references: readonly ReferenceEdge[];
  /** 把 Release ID 换成版本号（编辑器已经读过依赖的 Release 列表）；不知道时返回 undefined。 */
  releaseLabel?: ((ref: string, release: string) => string | undefined) | undefined;
}

export interface Explanation {
  title: string;
  body?: ReactNode;
  /** 问题出在依赖上：失败对话框给出 “Open dependencies”。 */
  dependencies: boolean;
}

interface DiamondPath {
  release: string;
  via: string[];
}

function diamondPaths(data: Record<string, unknown> | undefined): DiamondPath[] {
  const releases = data?.releases;
  if (!Array.isArray(releases)) return [];
  return releases.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const { release, via } = r as { release?: unknown; via?: unknown };
    if (typeof release !== "string" || !Array.isArray(via)) return [];
    return [{ release, via: via.filter((v): v is string => typeof v === "string") }];
  });
}

/** 一条来源路径：作品 → 第一跳的依赖 → …… → 冲突的作品。 */
export function describePath(path: DiamondPath, ref: string, ctx: IssueContext): string {
  const [first, ...rest] = path.via;
  const hops: string[] = [ctx.root];
  const edge = ctx.references.find((r) => r.id === first);
  const firstUse = edge ? String(edge.use) : first;
  if (firstUse && firstUse !== ref) hops.push(firstUse);
  // 中间的跳是上游作品自己的 edge ID，只能原样显示。
  for (const id of rest.slice(0, -1)) hops.push(`#${id}`);
  hops.push(ref);
  return hops.join(" → ");
}

export function explainIssue(issue: Issue, ctx: IssueContext): Explanation {
  const code = issue.code;
  const subject = issue.subject;
  if (code === "publish.diamond_conflict") {
    const ref = typeof issue.data?.ref === "string" ? issue.data.ref : subject;
    const paths = diamondPaths(issue.data);
    return {
      title: "Two versions of the same dependency",
      dependencies: true,
      body: (
        <>
          <p>
            <span className="font-mono">{ref}</span> is pulled in twice with different releases:
          </p>
          {paths.length > 0 ? (
            <ul className="space-y-0.5 font-mono text-xs" aria-label="Where it comes from">
              {paths.map((p) => (
                <li key={`${p.release}:${p.via.join("/")}`}>
                  {describePath(p, ref, ctx)}{" "}
                  <span className="text-text-3">
                    ({ctx.releaseLabel?.(ref, p.release) ?? `…${p.release.slice(-6)}`})
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="font-medium">Pin both to the same release in Dependencies.</p>
        </>
      ),
    };
  }
  if (code === "publish.public_depends_on_private") {
    return {
      title: "A public release can't depend on a private one",
      body: (
        <p>
          <span className="font-mono">{subject}</span> is private. Publish this one privately, or
          pick a public version of it.
        </p>
      ),
      dependencies: true,
    };
  }
  if (code === "publish.tombstoned_dependency" || code === "publish.dependency_unavailable") {
    return {
      title: "A dependency is no longer available",
      body: (
        <p>
          <span className="font-mono">{subject}</span> was removed. Pick another version or remove
          it.
        </p>
      ),
      dependencies: true,
    };
  }
  if (code === "publish.unpinned") {
    return {
      title: "A dependency has no version",
      body: <p>Pick the release to build on for each dependency.</p>,
      dependencies: true,
    };
  }
  if (code.startsWith("license.")) {
    return {
      title: "The licenses don't allow this combination",
      body: (
        <p>
          {issue.detail ? `${issue.detail}. ` : ""}Change your license or the dependency, then try
          again. This is a best-effort check, not legal advice.
        </p>
      ),
      dependencies: subject.startsWith("@") || subject.startsWith("references"),
    };
  }
  if (code === "publish.label_taken") {
    return {
      title: "That version label is already used",
      body: <p>Each label can only be used once. Pick another one.</p>,
      dependencies: false,
    };
  }
  if (code === "publish.asset_not_ready") {
    return {
      title: "An image is still being checked",
      body: <p>Wait a moment and publish again.</p>,
      dependencies: false,
    };
  }
  if (code === "publish.blocked_content") {
    return {
      title: "This content can't be published",
      body: <p>It matches content that char.pub doesn't allow.</p>,
      dependencies: false,
    };
  }
  return {
    title: issue.detail ? issue.detail.charAt(0).toUpperCase() + issue.detail.slice(1) : code,
    dependencies: subject.startsWith("references"),
  };
}

/** 失败说明的一块：红底，标题、说明和错误码。 */
export function IssueBox({
  title,
  body,
  code,
  subject,
}: {
  title: string;
  body?: ReactNode;
  code: string;
  subject?: string | undefined;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-danger-soft p-4 text-sm" data-severity="error">
      <p className="flex items-center gap-2 font-semibold text-danger">
        <CircleX aria-hidden className="size-4 shrink-0" />
        {title}
      </p>
      {body ? <div className="space-y-1.5 text-text">{body}</div> : null}
      <p className="font-mono text-xs text-text-2">
        {code}
        {subject ? <span className="text-text-3"> · {subject}</span> : null}
      </p>
    </div>
  );
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_1fr]">
      <dt className="text-xs font-medium text-text-2">{label}</dt>
      <dd className={cn("text-sm", tone)}>{children}</dd>
    </div>
  );
}

export function PublishReport({
  report,
  context,
}: {
  report: PublishReportResponse;
  context: IssueContext;
}) {
  const issues = report.report?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const license = report.report?.license_check;
  const pinned = context.references.filter((r) => r.pin);

  return (
    <section aria-label="Publish report" className="space-y-3" data-state={report.state}>
      {errors.map((i, n) => {
        const e = explainIssue(i, context);
        return (
          <IssueBox
            key={`${i.code}:${i.subject}:${n}`}
            title={e.title}
            body={e.body}
            code={i.code}
            subject={i.subject}
          />
        );
      })}
      {report.state !== "pending" ? (
        <dl className="space-y-3 rounded-lg bg-surface-2 p-4">
          {license ? (
            <Row
              label="License check"
              tone={
                license === "pass"
                  ? "text-success"
                  : license === "warn"
                    ? "text-warning"
                    : "text-danger"
              }
            >
              {LICENSE_TEXT[license]}
            </Row>
          ) : null}
          <Row label="Warnings" tone={warnings.length > 0 ? "text-warning" : "text-text-2"}>
            {warnings.length === 0 ? (
              "None."
            ) : (
              <ul className="space-y-1">
                {warnings.map((w, n) => (
                  <li key={`${w.code}:${w.subject}:${n}`} data-severity="warning">
                    {w.detail ? `${w.detail.charAt(0).toUpperCase()}${w.detail.slice(1)} ` : ""}
                    <span className="font-mono text-xs text-text-2">{w.code}</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
          {report.state === "active" ? (
            <Row label="Locked">
              {pinned.length === 0
                ? "No dependencies."
                : `${pinned.length} ${pinned.length === 1 ? "dependency" : "dependencies"}: ${pinned
                    .map((r) => String(r.use))
                    .join(", ")}`}
            </Row>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

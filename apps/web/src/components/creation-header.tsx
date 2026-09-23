/**
 * 作品头部：头像、显示名、`@ns/name@label`、作者与发布时间、类型 / 评级 / 许可 / 内容警告、摘要，
 * 以及主操作（下载、预览、所有者的 Edit）和溢出菜单（举报、所有者的 Yank）。
 *
 * 窄屏时纵向排列，主操作占满一行。
 */
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  Ellipsis,
  Flag,
  Pencil,
  ScanEye,
  Settings,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ownLicense } from "@/lib/creation-graph";
import { formatDate, localized } from "@/lib/text";
import { cn } from "@/lib/utils";
import { StatusBadge, TYPE_STYLE, TypeBadge } from "./badges";
import { CopyButton } from "./copy-button";
import { useCreation } from "./creation-context";
import { DownloadMenu } from "./downloads";
import { isAdultRating, RatingBadge } from "./rating";
import { ReportDialog } from "./report-dialog";
import { UserText } from "./user-content";
import { YankDialog } from "./yank-dialog";

function Avatar() {
  const c = useCreation();
  const { ir, detail } = c;
  const title = localized(detail.display_name);
  // 头像只显示作品自己的、有公共地址的图片（public + mirrored）；成人图片跟正文一样遮挡。
  const avatar = ir?.assets.find(
    (a) => a.origin.creation === ir.root.ref && a.origin.slot === "avatar" && a.url,
  );
  if (avatar?.url && (!isAdultRating(avatar.rating) || c.allowMature)) {
    return (
      <img
        src={avatar.url}
        alt={avatar.alt ?? ""}
        className="size-20 shrink-0 rounded-lg border object-cover sm:size-28"
      />
    );
  }
  const s = TYPE_STYLE[detail.type];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-20 shrink-0 items-center justify-center rounded-lg text-3xl font-bold sm:size-28 sm:text-4xl",
        s.soft,
        s.text,
      )}
    >
      {[...title][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function Breadcrumb() {
  const { ns, detail } = useCreation();
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-text-2">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link to="/browse" className="hover:text-text hover:underline">
            Explore
          </Link>
        </li>
        <ChevronRight aria-hidden className="size-3.5 text-text-3" />
        {/* 作者主页上线后换成链接。 */}
        <li>@{ns}</li>
        <ChevronRight aria-hidden className="size-3.5 text-text-3" />
        <li aria-current="page" className="font-medium text-text">
          <UserText text={localized(detail.display_name)} />
        </li>
      </ol>
    </nav>
  );
}

/** 头部下面那行：`@ns/name@label`、作者、发布时间。 */
function Identity() {
  const { ns, detail, label, selected } = useCreation();
  const id = `${detail.ref}${label ? `@${label}` : ""}`;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-2">
      <span className="inline-flex items-center gap-1">
        <span className="font-mono break-all text-text">{id}</span>
        <CopyButton text={id} label={`Copy ${id}`} />
      </span>
      <span aria-hidden>·</span>
      <span>by @{ns}</span>
      {selected ? (
        <>
          <span aria-hidden>·</span>
          <span>released {formatDate(selected.created_at)}</span>
        </>
      ) : null}
    </p>
  );
}

function Facts() {
  const { detail, ir, rating, selected, tombstoned } = useCreation();
  const license = ir ? ownLicense(ir) : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TypeBadge type={detail.type} />
      <RatingBadge rating={rating} />
      {license ? (
        <Badge variant="neutral" className="font-mono font-medium">
          {license}
        </Badge>
      ) : null}
      {ir?.meta.content_warnings.map((w) => (
        <Badge key={w} variant="neutral" className="font-medium">
          <TriangleAlert aria-hidden />
          <UserText text={w} />
        </Badge>
      ))}
      {tombstoned ? (
        <StatusBadge status="removed" />
      ) : selected?.status === "yanked" ? (
        <StatusBadge status="yanked" />
      ) : null}
      {selected?.visibility === "private" ? <StatusBadge status="private" /> : null}
    </div>
  );
}

function Actions() {
  const c = useCreation();
  const { ns, name, detail, label, selected, tombstoned, isOwner } = c;
  const [report, setReport] = useState(false);
  const [yank, setYank] = useState(false);
  const usable = !!selected && !tombstoned;
  const keepV = c.v ? { v: c.v } : {};
  return (
    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
      {isOwner ? (
        <Link
          to="/c/$ns/$name/edit"
          params={{ ns, name }}
          className={cn(buttonVariants({ variant: "outline" }), "order-2 lg:order-none")}
        >
          <Pencil aria-hidden /> Edit
        </Link>
      ) : null}
      {usable ? (
        <Link
          to="/c/$ns/$name/preview"
          params={{ ns, name }}
          search={keepV}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "order-1 flex-1 sm:flex-none lg:order-none",
          )}
        >
          <ScanEye aria-hidden /> Preview context
        </Link>
      ) : null}
      <DownloadMenu
        key={label}
        ns={ns}
        name={name}
        label={usable ? label : undefined}
        canExportCard={detail.type === "character"}
        className="order-first flex-1 sm:flex-none lg:order-none"
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="More actions"
            className="order-3 lg:order-none"
          >
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setReport(true)}>
            <Flag aria-hidden /> Report…
          </DropdownMenuItem>
          {isOwner ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/c/$ns/$name/settings" params={{ ns, name }}>
                  <Settings aria-hidden /> Settings
                </Link>
              </DropdownMenuItem>
              {label && selected?.status === "active" ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setYank(true)}>
                  <Undo2 aria-hidden /> Yank {label}…
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportDialog
        ns={ns}
        name={name}
        label={usable ? label : undefined}
        open={report}
        onOpenChange={setReport}
      />
      {isOwner && label ? (
        <YankDialog ns={ns} name={name} label={label} open={yank} onOpenChange={setYank} />
      ) : null}
    </div>
  );
}

export function CreationHeader() {
  const { detail } = useCreation();
  return (
    <header className="space-y-5">
      <Breadcrumb />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4 sm:gap-5">
          <Avatar />
          <div className="min-w-0 space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              <UserText text={localized(detail.display_name)} />
            </h1>
            <Identity />
            <Facts />
            {detail.summary ? (
              <p className="max-w-prose pt-1 text-text-2">
                <UserText text={localized(detail.summary)} />
              </p>
            ) : null}
          </div>
        </div>
        <Actions />
      </div>
    </header>
  );
}

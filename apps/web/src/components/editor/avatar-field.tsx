/**
 * 头像：选择图片后走上传流程（申请上传 → 直传对象存储 → 服务端处理），完成后写进草稿。
 *
 * 预览总是显示真实的图片：
 * - 刚上传的图片用本地的 blob URL（只在这个浏览器里，不经过网络）；同一次会话里按 digest
 *   记住它，重新加载草稿后还能显示；
 * - 已经发布过的头像从最新 public 版本的 Context IR 里找同一个 digest 的公共地址；
 * - 没有本地或已发布预览时，向草稿接口申请本人上传图片的短期读取地址，换设备后仍可预览。
 */
import { useQuery } from "@tanstack/react-query";
import { ImageIcon, ImageUp, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type BlobInfo, getAvatar, setAvatar, type Working } from "@/lib/draft";
import { keys, useRegistry } from "@/lib/registry";
import { IMAGE_TYPES, UploadError, uploadImage } from "@/lib/upload";

/** 本次会话里上传过的图片：digest → blob URL。页面关闭时浏览器会回收它们。 */
const localPreviews = new Map<string, string>();

function digestOf(w: Working): string | undefined {
  const v = getAvatar(w)?.variants[0];
  return v?.blob.digest;
}

export function AvatarField({
  ns,
  name,
  working,
  update,
  latestLabel,
}: {
  ns: string;
  name: string;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  latestLabel?: string | undefined;
}) {
  const client = useRegistry();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const digest = digestOf(working);
  const local = digest ? localPreviews.get(digest) : undefined;

  // 已发布的头像：只在没有本地预览时去读最新版本的 IR。
  const ir = useQuery({
    queryKey: keys.ir(ns, name, latestLabel ?? ""),
    queryFn: () => client.getIR(ns, name, latestLabel ?? ""),
    enabled: !!digest && !local && !!latestLabel,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const published = digest
    ? ir.data?.assets.find((a) => a.digest === digest && a.url)?.url
    : undefined;
  const privatePreview = useQuery({
    queryKey: [...keys.draft(ns, name), "avatar", digest],
    queryFn: () => client.draftAvatar(ns, name),
    enabled: !!digest && !local && !published,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 240_000,
  });
  const src =
    uploading ??
    local ??
    published ??
    (privatePreview.data && privatePreview.data.digest === digest
      ? privatePreview.data.url
      : undefined);

  useEffect(
    () => () => {
      // 上传失败或组件卸载时，只回收没有记进 localPreviews 的临时预览。
      if (uploading && ![...localPreviews.values()].includes(uploading)) {
        URL.revokeObjectURL(uploading);
      }
    },
    [uploading],
  );

  const pick = async (file: File) => {
    setError(null);
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
    setUploading(url ?? "");
    try {
      const blob: BlobInfo = await uploadImage(client, file);
      if (url) localPreviews.set(blob.digest, url);
      update((w) => setAvatar(w, blob));
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "The upload failed. Try again.");
    } finally {
      setUploading(null);
    }
  };

  const busy = uploading !== null;
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Avatar</legend>
      <div className="relative flex size-26 items-center justify-center overflow-hidden rounded-lg border bg-surface-2 text-text-3">
        {src ? (
          <img src={src} alt="Avatar preview" className="size-full object-cover" />
        ) : digest ? (
          <span className="flex flex-col items-center gap-1 px-2 text-center text-[0.65rem] leading-tight">
            <ImageIcon aria-hidden className="size-5" />
            Preview unavailable
          </span>
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs">
            <ImageIcon aria-hidden className="size-6" />
            No avatar
          </span>
        )}
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
            <Loader2 aria-hidden className="size-5 animate-spin text-text-2" />
          </span>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        aria-label="Choose an avatar image"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-x-2">
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto px-0"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <ImageUp aria-hidden />
          {busy ? "Uploading…" : digest ? "Replace" : "Upload"}
        </Button>
        {digest && !busy ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto px-0 text-text-2"
            onClick={() => update((w) => setAvatar(w, null))}
          >
            <X aria-hidden /> Remove
          </Button>
        ) : null}
      </div>
      <p className="text-[0.7rem] leading-snug text-text-3">
        PNG, JPEG, WebP or GIF, up to 8 MiB. Checked before it's published.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

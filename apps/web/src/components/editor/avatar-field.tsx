/**
 * 头像：选择图片后走上传流程（申请上传 → 直传对象存储 → 服务端处理），完成后写进草稿。
 * 预览用本地的 blob URL；发布后作品页从公共 CDN 显示。
 */
import { ImageUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type BlobInfo, getAvatar, setAvatar, type Working } from "@/lib/draft";
import { useRegistry } from "@/lib/registry";
import { IMAGE_TYPES, UploadError, uploadImage } from "@/lib/upload";

export function AvatarField({
  working,
  update,
}: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
}) {
  const client = useRegistry();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const current = getAvatar(working);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const pick = async (file: File) => {
    setError(null);
    setStatus("uploading");
    setPreview(URL.createObjectURL(file));
    try {
      const blob: BlobInfo = await uploadImage(client, file);
      update((w) => setAvatar(w, blob));
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setPreview(null);
      setError(e instanceof UploadError ? e.message : "The upload failed. Try again.");
    }
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm">Avatar</legend>
      <div className="flex items-center gap-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-sm border border-rule bg-muted text-xs text-muted-foreground">
          {preview ? (
            <img src={preview} alt="" className="size-full object-cover" />
          ) : current ? (
            <span className="px-1 text-center font-mono text-[0.65rem]">image set</span>
          ) : (
            <span>none</span>
          )}
        </div>
        <div className="space-y-1">
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
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={status === "uploading"}
              onClick={() => input.current?.click()}
            >
              <ImageUp aria-hidden />
              {status === "uploading" ? "Uploading…" : current ? "Replace" : "Upload"}
            </Button>
            {current ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPreview(null);
                  update((w) => setAvatar(w, null));
                }}
              >
                <X aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, WebP or GIF, up to 10 MB. Images are checked before they are published.
          </p>
          {error ? (
            <p role="alert" className="text-xs text-seal">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}

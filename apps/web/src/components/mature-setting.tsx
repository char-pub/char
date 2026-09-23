/**
 * “显示成人内容”开关。开启前必须在对话框里确认已满 18 岁，确认结果与时间保存在服务端；
 * 关闭立即生效，服务端同时清除确认记录。
 */
import { useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/text";

export interface MatureSettingProps {
  enabled: boolean;
  confirmedAt: string | null;
  saving?: boolean;
  error?: string | null;
  onChange: (next: { show_mature: boolean; confirm_adult?: boolean }) => void;
}

export function MatureSetting({
  enabled,
  confirmedAt,
  saving = false,
  error,
  onChange,
}: MatureSettingProps) {
  const [asking, setAsking] = useState(false);
  const [adult, setAdult] = useState(false);
  const ids = { label: useId(), desc: useId(), check: useId() };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p id={ids.label} className="font-display text-lg">
            Show mature and explicit creations
          </p>
          <p id={ids.desc} className="max-w-prose text-sm text-muted-foreground">
            Off by default. When on, search, browsing and creation pages include content rated
            mature or explicit. The registry enforces this setting for your account.
          </p>
          {enabled && confirmedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              You confirmed you are 18 or older on {formatDate(confirmedAt)}.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby={ids.label}
          aria-describedby={ids.desc}
          disabled={saving}
          onClick={() => {
            if (enabled) onChange({ show_mature: false });
            else {
              setAdult(false);
              setAsking(true);
            }
          }}
          className="relative mt-1 h-6 w-11 shrink-0 rounded-full border border-foreground/70 bg-muted transition-colors disabled:opacity-60 aria-checked:bg-seal"
        >
          <span
            aria-hidden
            className={`absolute top-0.5 size-4.5 rounded-full bg-background shadow transition-[left] ${enabled ? "left-5.5" : "left-0.5"}`}
          />
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-seal">
          {error}
        </p>
      ) : null}

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogTitle>Are you 18 or older?</AlertDialogTitle>
          <AlertDialogDescription>
            Mature and explicit creations are only for adults. By turning this on you confirm that
            you are at least 18 years old and that viewing such content is legal where you are.
          </AlertDialogDescription>
          <label htmlFor={ids.check} className="flex items-center gap-2 text-sm">
            <input
              id={ids.check}
              type="checkbox"
              className="accent-[var(--seal)]"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
            />
            I am 18 or older
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep hidden</AlertDialogCancel>
            <Button
              disabled={!adult}
              onClick={() => {
                setAsking(false);
                onChange({ show_mature: true, confirm_adult: true });
              }}
            >
              Show mature content
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

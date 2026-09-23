/**
 * “显示成人内容”开关。开启前必须在对话框里确认已满 18 岁，确认结果与时间保存在服务端；
 * 关闭立即生效，服务端同时清除确认记录。“已开启”和“有确认时间”缺一项，服务端都仍然隐藏。
 */
import { Eye } from "lucide-react";
import { useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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
        <div className="min-w-0 space-y-0.5">
          <p id={ids.label} className="text-sm font-semibold">
            Show mature and explicit creations
          </p>
          <p id={ids.desc} className="max-w-prose text-sm text-text-2">
            {enabled && confirmedAt
              ? `On since ${formatDate(confirmedAt)} — you confirmed you're 18 or older.`
              : "Off by default. When on, search, browsing and creation pages include content rated mature or explicit. The registry enforces this for your account."}
          </p>
        </div>
        <Switch
          className="mt-0.5"
          checked={enabled}
          disabled={saving}
          aria-labelledby={ids.label}
          aria-describedby={ids.desc}
          onCheckedChange={(next) => {
            if (!next) onChange({ show_mature: false });
            else {
              setAdult(false);
              setAsking(true);
            }
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Show mature and explicit creations?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll appear in search and open without a warning. Mature and explicit creations are
              only for adults; you can turn this off at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2.5">
            <Checkbox
              id={ids.check}
              checked={adult}
              onCheckedChange={(v) => setAdult(v === true)}
            />
            <label htmlFor={ids.check} className="text-sm font-medium">
              I am 18 or older
            </label>
          </div>
          <p className="text-xs text-text-3">
            We record when you confirmed. Some regions may require stronger age checks later.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep hidden</AlertDialogCancel>
            <Button
              variant="ink"
              disabled={!adult}
              onClick={() => {
                setAsking(false);
                onChange({ show_mature: true, confirm_adult: true });
              }}
            >
              <Eye aria-hidden /> Show mature content
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * 举报作品或它的某个版本。登录用户与经过验证的访客直接提交；匿名用户要先通过 Turnstile
 * （action 是 `report`），站点没有配置 Turnstile 时匿名用户只能登录后再举报。
 *
 * 成功后只显示“已收到”：服务端不透露是否重复、会不会处理。版权问题提示权利人走内容政策里的
 * DMCA 流程，那里要求的信息是法律规定必须收集的。
 */
import { Link } from "@tanstack/react-router";
import { CircleCheck, Flag } from "lucide-react";
import { useId, useState } from "react";
import { useAccount } from "@/components/account-menu";
import { RadioCard } from "@/components/radio-card";
import { SignInButton } from "@/components/sign-in";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { isApiError, MAX_REPORT_DETAILS, REPORT_CATEGORIES, type ReportCategory } from "@/lib/api";
import { isReadOnlyError } from "@/lib/read-only";
import { useRegistry } from "@/lib/registry";
import { REPORT_TURNSTILE_ACTION, TURNSTILE_SITE_KEY } from "@/lib/turnstile";

/** 六类原因的说法。 */
export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  sexual_minors: "Sexual content involving minors",
  copyright: "Copyright or trademark",
  rating: "Wrong rating",
  harassment: "Harassment or a real person",
  illegal: "Illegal or harmful",
  spam: "Spam or malware",
};

function reportError(e: unknown): { message: string; needsSignIn?: boolean } {
  if (isApiError(e, "turnstile.required") || isApiError(e, "turnstile.failed")) {
    return { message: "The human check didn't go through. Complete it again." };
  }
  if (isApiError(e, "report.anonymous_unavailable")) {
    return { message: "Reports without an account are unavailable right now.", needsSignIn: true };
  }
  if (isApiError(e, "rate_limited") || (isApiError(e) && e.status === 429)) {
    return { message: "You've sent several reports in a short time. Try again later." };
  }
  if (isReadOnlyError(e)) {
    return {
      message: "char.pub is read-only for maintenance, so reports can't be sent right now.",
    };
  }
  if (isApiError(e) && e.status === 404) {
    return { message: "This creation or version isn't available any more." };
  }
  return { message: "The report could not be sent. Try again." };
}

export function ReportDialog({
  ns,
  name,
  label,
  open,
  onOpenChange,
}: {
  ns: string;
  name: string;
  /** 正在看的版本；给出时可以只举报这个版本。 */
  label: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* 关闭后重新打开时从空表单开始。 */}
        {open ? (
          <ReportForm ns={ns} name={name} label={label} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReportForm({
  ns,
  name,
  label,
  onDone,
}: {
  ns: string;
  name: string;
  label: string | undefined;
  onDone: () => void;
}) {
  const client = useRegistry();
  const account = useAccount();
  const ids = { details: useId(), hint: useId(), target: useId() };
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [target, setTarget] = useState<"creation" | "version">("creation");
  const [details, setDetails] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [widget, setWidget] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof reportError> | null>(null);
  const [sent, setSent] = useState(false);

  const anonymous = !account.pending && !account.user && !account.guest;
  const canVerify = !!TURNSTILE_SITE_KEY;
  const blocked = anonymous && (!canVerify || error?.needsSignIn === true);
  const ready =
    !!category &&
    !busy &&
    !blocked &&
    (!anonymous || !!token) &&
    details.length <= MAX_REPORT_DETAILS;

  const submit = async () => {
    if (!category || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await client.submitReport(
        ns,
        name,
        { category, details, turnstile_token: anonymous ? (token ?? undefined) : undefined },
        { label: target === "version" ? label : undefined },
      );
      setSent(true);
    } catch (e) {
      const err = reportError(e);
      setError(err);
      // 每个 token 只能用一次：失败后换一个新的 widget。
      if (anonymous) {
        setToken(null);
        setWidget((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="grid gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleCheck aria-hidden className="size-5 text-success" /> Report received
          </DialogTitle>
          <DialogDescription>
            Thanks for telling us. The char.pub trust &amp; safety team reviews every report. The
            author isn't told who reported.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          Report{" "}
          <span className="font-mono">
            @{ns}/{name}
          </span>
        </DialogTitle>
        <DialogDescription>
          Reports go to the char.pub trust &amp; safety team. The author isn't told who reported.
        </DialogDescription>
      </DialogHeader>

      {label ? (
        <fieldset className="grid gap-2">
          <legend id={ids.target} className="mb-2 text-sm font-semibold">
            What are you reporting?
          </legend>
          <RadioGroup
            aria-labelledby={ids.target}
            value={target}
            onValueChange={(v) => setTarget(v as "creation" | "version")}
            className="grid gap-2 sm:grid-cols-2"
          >
            <RadioCard compact id={`${ids.target}-creation`} value="creation">
              The whole creation
            </RadioCard>
            <RadioCard compact id={`${ids.target}-version`} value="version">
              Only version <span className="font-mono">{label}</span>
            </RadioCard>
          </RadioGroup>
        </fieldset>
      ) : null}

      <CategoryChoice value={category} onChange={setCategory} />

      {category === "copyright" ? (
        <p className="text-sm text-text-2">
          Rights holder? Send a{" "}
          <Link
            to="/policy"
            hash="report"
            className="text-blue-text underline-offset-4 hover:underline"
          >
            copyright (DMCA) notice
          </Link>{" "}
          instead: it asks for the details we're legally required to collect.
        </p>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={ids.details}>Details (optional)</Label>
        <Textarea
          id={ids.details}
          rows={3}
          value={details}
          maxLength={MAX_REPORT_DETAILS}
          aria-describedby={ids.hint}
          placeholder="Which part, and why?"
          onChange={(e) => setDetails(e.target.value)}
        />
        <p id={ids.hint} className="text-right text-xs tabular-nums text-text-3">
          {details.length}/{MAX_REPORT_DETAILS}
        </p>
      </div>

      {anonymous && canVerify && !error?.needsSignIn ? (
        <TurnstileWidget
          key={widget}
          siteKey={TURNSTILE_SITE_KEY ?? ""}
          action={REPORT_TURNSTILE_ACTION}
          onToken={setToken}
        />
      ) : null}
      {blocked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-text-2">
          <span className="flex-1">Sign in to send a report.</span>
          <SignInButton size="sm" variant="outline" />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error.message}
        </p>
      ) : null}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant="ink" disabled={!ready}>
          <Flag aria-hidden /> {busy ? "Sending…" : "Send report"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CategoryChoice({
  value,
  onChange,
}: {
  value: ReportCategory | null;
  onChange: (c: ReportCategory) => void;
}) {
  const legend = useId();
  return (
    <fieldset className="grid gap-2">
      <legend id={legend} className="mb-2 text-sm font-semibold">
        What's wrong?
      </legend>
      <RadioGroup
        aria-labelledby={legend}
        value={value ?? ""}
        onValueChange={(v) => onChange(v as ReportCategory)}
        className="gap-2"
      >
        {REPORT_CATEGORIES.map((c) => (
          <RadioCard compact key={c} id={`${legend}-${c}`} value={c}>
            {REPORT_CATEGORY_LABEL[c]}
          </RadioCard>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

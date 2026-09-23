/**
 * 角色卡导入向导，三步：上传（选择文件并决定地址，原件交给服务端解析）→ 查看 Import Report
 * 并确认 → 进入编辑器。
 *
 * 卡片很少写明归属与复用条件，所以评级、权利与许可必须由作者逐项选择，没有默认值可以
 * 直接跳过；在确认之前，导入生成的 Creation 不能发布。
 */
import type { ImportStatus } from "@char-pub/contracts";
import { NAME_RE, type Rating } from "@char-pub/core";
import { ArrowRight, Check, FileJson, FileUp, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { AddressField, type Availability, useNameAvailability } from "@/components/address-field";
import { ChoiceCard } from "@/components/choice-card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { isApiError } from "@/lib/api";
import { importErrorMessage, uploadCard, waitForImport } from "@/lib/import";
import { useRegistry } from "@/lib/registry";
import { slugify } from "@/lib/text";
import { UploadError } from "@/lib/upload";
import { cn } from "@/lib/utils";
import {
  LICENSE_HELP,
  LICENSE_PRESETS,
  RATING_OPTIONS,
  RIGHTS_OPTIONS,
  type Rights,
} from "./editor/options";
import { ImportReport } from "./import-report";

/** 文件名去掉扩展名后作为地址的初始值。 */
function slugFromFile(fileName: string): string {
  return slugify(fileName.replace(/\.[a-z0-9]+$/i, "")) || "imported-character";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileKind(file: File): string {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (ext === "png" || file.type === "image/png") return "PNG card";
  if (ext === "charx") return "CHARX card";
  if (ext === "json" || file.type === "application/json") return "JSON card";
  return "Card";
}

const STEPS = ["Upload", "Review & confirm", "Edit"] as const;

/** 步骤条：已完成的步骤打勾，当前步骤用 `aria-current="step"` 标出。 */
export function ImportSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Import steps" className="flex items-center gap-3 text-sm">
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className={cn("flex min-w-0 items-center gap-2", i < STEPS.length - 1 && "flex-1")}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              i < current && "border-ink bg-ink text-on-ink",
              i === current && "border-ink bg-ink text-on-ink",
              i > current && "border-border-strong text-text-3",
            )}
          >
            {i < current ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn("shrink-0", i <= current ? "font-semibold" : "text-text-3")}>
            {s}
            {i < current ? <span className="sr-only"> (done)</span> : null}
          </span>
          {i < STEPS.length - 1 ? (
            <span
              aria-hidden
              className={cn("h-px min-w-4 flex-1", i < current ? "bg-ink" : "bg-border")}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** 列出还没选的项，例如 “Choose a rating and a license to continue.” */
export function missingText(missing: string[]): string {
  if (missing.length === 0) return "";
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Choose ${list} to continue.`;
}

export interface Choices {
  rating: Rating | "";
  rights: Rights | "";
  license: string;
}

/** “Confirm three things”：三项都没有默认值，由作者逐项选择。 */
function ConfirmChoices({
  value,
  onChange,
}: {
  value: Choices;
  onChange: (patch: Partial<Choices>) => void;
}) {
  const ids = { rating: useId(), rights: useId(), license: useId(), help: useId() };
  const rightsNote = RIGHTS_OPTIONS.find((r) => r.id === value.rights)?.note;
  const custom =
    value.license !== "" && !LICENSE_PRESETS.some((l) => l.id === value.license)
      ? value.license
      : null;
  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Rating</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {RATING_OPTIONS.map((r) => (
            <ChoiceCard
              key={r.id}
              name={ids.rating}
              value={r.id}
              checked={value.rating === r.id}
              onSelect={() => onChange({ rating: r.id })}
              title={r.label}
              description={r.hint}
              className="p-3"
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Rights</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {RIGHTS_OPTIONS.map((r) => (
            <ChoiceCard
              key={r.id}
              name={ids.rights}
              value={r.id}
              checked={value.rights === r.id}
              onSelect={() => onChange({ rights: r.id })}
              title={r.label}
              description={r.hint}
              className="p-3"
            />
          ))}
        </div>
        {rightsNote ? <p className="text-xs text-text-2">{rightsNote}</p> : null}
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor={ids.license} className="text-sm font-semibold">
          License
        </label>
        <NativeSelect
          id={ids.license}
          value={value.license}
          aria-describedby={ids.help}
          onChange={(e) => onChange({ license: e.target.value })}
        >
          <option value="">Choose a license…</option>
          {LICENSE_PRESETS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
          {custom ? <option value={custom}>{custom}</option> : null}
        </NativeSelect>
        <p id={ids.help} className="text-xs text-text-3">
          {LICENSE_HELP}
        </p>
      </div>
    </div>
  );
}

/** 选好的文件：PNG 显示本地缩略图（blob URL，不上传也不离开浏览器）。 */
function FileSummary({
  file,
  detail,
  action,
}: {
  file: File;
  detail: ReactNode;
  action?: ReactNode;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (file.type !== "image/png" || typeof URL.createObjectURL !== "function") {
      setThumb(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-surface p-4">
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 text-text-3">
        {thumb ? (
          <img src={thumb} alt="" className="size-full object-cover" />
        ) : (
          <FileJson aria-hidden className="size-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{file.name}</p>
        <p className="font-mono text-xs text-text-3">{detail}</p>
      </div>
      {action}
    </div>
  );
}

/** 第一步：选文件、定地址，然后把原件交给服务端读。 */
function UploadStep({
  ns,
  file,
  slug,
  ids,
  availability,
  busy,
  onFile,
  onSlug,
  onStart,
  progress,
  error,
}: {
  ns: string;
  file: File | null;
  slug: string;
  ids: { file: string; slug: string; hint: string };
  availability: Availability;
  busy: boolean;
  onFile: (file: File) => void;
  onSlug: (slug: string) => void;
  onStart: () => void;
  progress: ReactNode;
  error: ReactNode;
}) {
  const ready = !!file && NAME_RE.test(slug) && availability !== "taken";
  return (
    <div className="space-y-6">
      <ImportSteps current={0} />
      <section className="space-y-5" aria-label="Choose a card">
        <label htmlFor={ids.file} className="sr-only">
          Character card
        </label>
        <input
          id={ids.file}
          type="file"
          accept=".png,.json,.charx,image/png,application/json"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        {file ? (
          <FileSummary
            file={file}
            detail={
              <>
                {fileKind(file)} · {formatSize(file.size)}
                {NAME_RE.test(slug) ? ` · will be @${ns}/${slug}` : ""}
              </>
            }
            action={
              <Button type="button" variant="link" size="sm" asChild>
                <label
                  htmlFor={ids.file}
                  className={cn(busy ? "pointer-events-none opacity-50" : "cursor-pointer")}
                >
                  Choose another file
                </label>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-md bg-surface-2 text-text-2"
            >
              <FileUp className="size-5" />
            </span>
            <p className="font-semibold">Choose a Character Card V2 or V3</p>
            <p className="text-sm text-text-2">PNG, JSON or CHARX, up to 20 MB.</p>
            <Button type="button" variant="outline" asChild>
              <label htmlFor={ids.file} className="cursor-pointer">
                <FileUp aria-hidden /> Choose a file
              </label>
            </Button>
          </div>
        )}
        {file ? (
          <div className="max-w-md space-y-1.5">
            <label htmlFor={ids.slug} className="text-sm font-medium">
              Address
            </label>
            <AddressField
              id={ids.slug}
              hintId={ids.hint}
              ns={ns}
              value={slug}
              availability={availability}
              onChange={onSlug}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <Button type="button" disabled={!ready || busy} onClick={onStart}>
            Read the card <ArrowRight aria-hidden />
          </Button>
          {progress}
        </div>
        {error}
      </section>
    </div>
  );
}

export function ImportWizard({ ns, onCreated }: { ns: string; onCreated: (name: string) => void }) {
  const client = useRegistry();
  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [unstable, setUnstable] = useState<string[]>([]);
  const [choices, setChoices] = useState<Choices>({ rating: "", rights: "", license: "" });
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = { file: useId(), slug: useId(), hint: useId(), report: useId(), confirm: useId() };
  const availability = useNameAvailability(ns, slug, !!file && !status);

  const name = status?.creation?.split("/")[1] ?? slug;

  const start = async () => {
    if (!file || !NAME_RE.test(slug)) return;
    setError(null);
    try {
      setStep("Uploading the card…");
      const upload = await uploadCard(client, file);
      setStep("Reading the card…");
      const done = await waitForImport(
        client,
        await client.createImport({ upload, namespace: ns, name: slug }),
      );
      setStep(null);
      if (done.status !== "succeeded") {
        setError(
          done.status === "failed"
            ? importErrorMessage(done.error_code)
            : "The card is still being read. Check again in a moment.",
        );
        return;
      }
      setStatus(done);
      // 草稿里已有的值作为不需要确认的字段的初始值；需要确认的字段留空，由作者选择。
      const draft = await client.draft(ns, slug);
      const w = draft.working as {
        fragments?: { id: string; stable?: boolean }[];
        meta?: { rating?: Rating; rights?: Rights; license?: string };
      };
      setUnstable((w.fragments ?? []).filter((f) => f.stable === false).map((f) => f.id));
      const need = new Set(done.needs_confirmation);
      setChoices({
        rating: need.has("meta.rating") ? "" : (w.meta?.rating ?? ""),
        rights: need.has("meta.rights") ? "" : (w.meta?.rights ?? ""),
        license: need.has("meta.license") ? "" : (w.meta?.license ?? ""),
      });
    } catch (e) {
      setStep(null);
      setError(
        e instanceof UploadError
          ? e.message
          : isApiError(e, "creation.taken") || isApiError(e, "import.name_taken")
            ? `@${ns}/${slug} already exists. Choose another address.`
            : isApiError(e, "rate_limited")
              ? "You have imported a lot recently. Try again later."
              : "The import did not finish. Try again.",
      );
    }
  };

  const { rating, rights, license } = choices;
  const missing = [
    rating === "" ? "a rating" : null,
    rights === "" ? "the rights" : null,
    license === "" ? "a license" : null,
  ].filter((m): m is string => m !== null);

  const confirm = async () => {
    if (!status || rating === "" || rights === "" || license === "") return;
    setError(null);
    try {
      setStep("Saving your choices…");
      await client.confirmImport(status.import, { rating, rights, license });
      onCreated(name);
    } catch (e) {
      setStep(null);
      setError(
        isApiError(e, "import.already_confirmed")
          ? "These choices were already saved. Open the editor to change them."
          : "Your choices could not be saved. Try again.",
      );
    }
  };

  const progress = step ? (
    <p className="flex items-center gap-2 text-sm text-text-2" aria-live="polite">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      {step}
    </p>
  ) : null;
  const errorLine = error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;

  const report = status?.report;
  if (!status || !report) {
    return (
      <UploadStep
        ns={ns}
        file={file}
        slug={slug}
        ids={ids}
        availability={availability}
        busy={step !== null}
        onFile={(f) => {
          setFile(f);
          setSlug(slugFromFile(f.name));
          setError(null);
        }}
        onSlug={setSlug}
        onStart={() => void start()}
        progress={progress}
        error={errorLine}
      />
    );
  }

  return (
    <div className="space-y-6">
      <ImportSteps current={1} />
      {file ? (
        <FileSummary
          file={file}
          detail={
            <>
              {fileKind(file)} · {formatSize(file.size)} · draft at {status.creation}
            </>
          }
        />
      ) : null}

      <section aria-labelledby={ids.report} className="space-y-3">
        <h2 id={ids.report} className="text-lg font-bold tracking-tight">
          Import report
        </h2>
        <ImportReport report={report} unstable={unstable} />
      </section>

      <section
        aria-labelledby={ids.confirm}
        className="space-y-5 rounded-xl border bg-surface p-5 sm:p-6"
      >
        <div className="space-y-1">
          <h2 id={ids.confirm} className="text-lg font-bold tracking-tight">
            Confirm three things
          </h2>
          <p className="text-sm text-text-2">
            Cards don't say these reliably, so nothing is filled in for you. The card is saved as a
            draft at <span className="font-mono text-text">{status.creation}</span> and can't be
            published until you confirm. You can change these later in the editor.
          </p>
        </div>
        <ConfirmChoices value={choices} onChange={(p) => setChoices((c) => ({ ...c, ...p }))} />
      </section>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        {progress ?? (
          <p className="text-sm text-text-2" aria-live="polite">
            {missingText(missing)}
          </p>
        )}
        <Button
          type="button"
          disabled={missing.length > 0 || step !== null}
          onClick={() => void confirm()}
        >
          Save and open the editor <ArrowRight aria-hidden />
        </Button>
      </div>
      {errorLine}
    </div>
  );
}

/**
 * 角色卡导入向导：选择文件并决定地址 → 上传原件，由服务端解析 → 查看 Import Report →
 * 显式确认评级、权利与许可 → 进入编辑器。
 *
 * 卡片很少写明归属与复用条件，所以评级、权利与许可必须由作者逐项选择，没有默认值可以
 * 直接跳过；在确认之前，导入生成的 Creation 不能发布。
 */
import type { ImportStatus } from "@char-pub/contracts";
import { NAME_RE, RATINGS, type Rating } from "@char-pub/core";
import { FileUp } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { importErrorMessage, uploadCard, waitForImport } from "@/lib/import";
import { useRegistry } from "@/lib/registry";
import { slugify } from "@/lib/text";
import { UploadError } from "@/lib/upload";
import { LICENSE_PRESETS } from "./editor/meta-editor";
import { ImportReport } from "./import-report";
import { RATING_LABEL } from "./rating";

const selectClass =
  "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-seal";

type Rights = "original" | "fan-work" | "licensed";

const RIGHTS_LABEL: Record<Rights, string> = {
  original: "I created it",
  "fan-work": "Fan work",
  licensed: "I have permission",
};

/** 文件名去掉扩展名后作为地址的初始值。 */
function slugFromFile(fileName: string): string {
  return slugify(fileName.replace(/\.[a-z0-9]+$/i, "")) || "imported-character";
}

export function ImportWizard({ ns, onCreated }: { ns: string; onCreated: (name: string) => void }) {
  const client = useRegistry();
  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [unstable, setUnstable] = useState<string[]>([]);
  const [rating, setRating] = useState<Rating | "">("");
  const [rights, setRights] = useState<Rights | "">("");
  const [license, setLicense] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = {
    file: useId(),
    slug: useId(),
    rating: useId(),
    rights: useId(),
    license: useId(),
  };

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
      setRating(need.has("meta.rating") ? "" : (w.meta?.rating ?? ""));
      setRights(need.has("meta.rights") ? "" : (w.meta?.rights ?? ""));
      setLicense(need.has("meta.license") ? "" : (w.meta?.license ?? ""));
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

  const report = status?.report;
  return (
    <div className="space-y-8">
      {!status ? (
        <section className="space-y-4" aria-label="Choose a card">
          <div className="space-y-2">
            <label htmlFor={ids.file} className="text-sm">
              Character card
            </label>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" asChild>
                <label htmlFor={ids.file} className="cursor-pointer">
                  <FileUp aria-hidden /> Choose a file
                </label>
              </Button>
              <span className="text-sm text-muted-foreground">
                {file ? file.name : "PNG, JSON or CHARX, up to 20 MB"}
              </span>
            </div>
            <input
              id={ids.file}
              type="file"
              accept=".png,.json,.charx,image/png,application/json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setSlug(slugFromFile(f.name));
                  setError(null);
                }
                e.target.value = "";
              }}
            />
          </div>
          {file ? (
            <div className="max-w-md space-y-1">
              <label htmlFor={ids.slug} className="text-sm">
                Address
              </label>
              <div className="flex items-center gap-1 font-mono text-sm">
                <span className="text-muted-foreground">@{ns}/</span>
                <Input
                  id={ids.slug}
                  value={slug}
                  maxLength={64}
                  aria-invalid={!NAME_RE.test(slug)}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                />
              </div>
            </div>
          ) : null}
          <Button
            type="button"
            disabled={!file || !NAME_RE.test(slug) || step !== null}
            onClick={() => void start()}
          >
            Read the card
          </Button>
        </section>
      ) : null}

      {status && report ? (
        <>
          <section className="catalog-card space-y-4 p-5 pl-8" aria-labelledby="imp-report">
            <h2 id="imp-report" className="font-display text-2xl">
              Import report
            </h2>
            <ImportReport report={report} unstable={unstable} />
          </section>

          <section className="space-y-4" aria-labelledby="imp-confirm">
            <h2 id="imp-confirm" className="text-2xl">
              Confirm before publishing
            </h2>
            <p className="text-sm text-muted-foreground">
              The card was saved as a draft at <span className="font-mono">{status.creation}</span>.
              Cards rarely say who owns them or how they may be reused, so choose each of these
              yourself. You can change them later in the editor.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor={ids.rating} className="text-sm">
                  Rating
                </label>
                <select
                  id={ids.rating}
                  className={selectClass}
                  value={rating}
                  onChange={(e) => setRating(e.target.value as Rating | "")}
                >
                  <option value="">Choose…</option>
                  {RATINGS.map((r) => (
                    <option key={r} value={r}>
                      {RATING_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor={ids.rights} className="text-sm">
                  Rights
                </label>
                <select
                  id={ids.rights}
                  className={selectClass}
                  value={rights}
                  onChange={(e) => setRights(e.target.value as Rights | "")}
                >
                  <option value="">Choose…</option>
                  {(Object.keys(RIGHTS_LABEL) as Rights[]).map((r) => (
                    <option key={r} value={r}>
                      {RIGHTS_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor={ids.license} className="text-sm">
                  License
                </label>
                <select
                  id={ids.license}
                  className={selectClass}
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {LICENSE_PRESETS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                  {license && !LICENSE_PRESETS.some((l) => l.id === license) ? (
                    <option value={license}>{license}</option>
                  ) : null}
                </select>
              </div>
            </div>
            <Button
              type="button"
              disabled={rating === "" || rights === "" || license === "" || step !== null}
              onClick={() => void confirm()}
            >
              Confirm and open the editor
            </Button>
          </section>
        </>
      ) : null}

      {step ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {step}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-seal">
          {error}
        </p>
      ) : null}
    </div>
  );
}

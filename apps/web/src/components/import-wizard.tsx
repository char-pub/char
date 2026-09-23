/**
 * 角色卡导入向导：选择文件 → 查看 Import Report 并确认评级、权利与许可 → 写入新 Creation
 * 的草稿 → 进入编辑器。转换在浏览器里完成，原件不会上传。
 */
import type { Rights } from "@char-pub/ccv3";
import { NAME_RE, type Rating } from "@char-pub/core";
import { FileUp } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import {
  cardName,
  convertCard,
  ImportError,
  unstableEntries,
  uploadCardAssets,
} from "@/lib/import";
import { useRegistry } from "@/lib/registry";
import { slugify } from "@/lib/text";
import { LICENSE_PRESETS } from "./editor/meta-editor";
import { ImportReport } from "./import-report";

const selectClass =
  "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-seal";

type Loaded = { bytes: Uint8Array; fileName: string; result: ReturnType<typeof convertCard> };

export function ImportWizard({ ns, onCreated }: { ns: string; onCreated: (name: string) => void }) {
  const client = useRegistry();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<Rating | "">("");
  const [rights, setRights] = useState<Rights | "">("");
  const [license, setLicense] = useState("");
  const [display, setDisplay] = useState("");
  const [slug, setSlug] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const ids = {
    file: useId(),
    rating: useId(),
    rights: useId(),
    license: useId(),
    display: useId(),
    slug: useId(),
  };

  const open = async (file: File) => {
    setError(null);
    setLoaded(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = convertCard(bytes);
      const name = cardName(result);
      const need = new Set(result.report.needs_confirmation);
      const meta = result.creation.meta;
      setRating(need.has("meta.rating") ? "" : meta.rating);
      setRights(need.has("meta.rights") ? "" : meta.rights);
      setLicense(need.has("meta.license") ? "" : meta.license);
      setDisplay(name);
      setSlug(slugify(name) || "imported-character");
      setLoaded({ bytes, fileName: file.name, result });
    } catch (e) {
      setError(e instanceof ImportError ? e.message : "This file could not be read.");
    }
  };

  const ready =
    !!loaded &&
    rating !== "" &&
    rights !== "" &&
    license !== "" &&
    !!display.trim() &&
    NAME_RE.test(slug);

  const create = async () => {
    if (!loaded || !ready) return;
    setError(null);
    try {
      setStep("Creating the character…");
      const created = await client.createCreation(ns, {
        name: slug,
        type: "character",
        display_name: display.trim(),
      });
      const result = convertCard(loaded.bytes, {
        id: created.id,
        ref: created.ref,
        rating,
        rights,
        license,
      });
      setStep("Uploading images…");
      const { creation, failed } = await uploadCardAssets(client, result);
      setStep("Saving the draft…");
      const draft = await client.draft(ns, slug);
      await client.putDraft(ns, slug, draft.version, { ...creation, display_name: display.trim() });
      if (failed.length > 0) {
        setStep(
          `Some images could not be uploaded (${failed.join(", ")}); continuing without them.`,
        );
      }
      onCreated(slug);
    } catch (e) {
      setStep(null);
      setError(
        isApiError(e, "creation.taken")
          ? `@${ns}/${slug} already exists. Choose another address.`
          : isApiError(e, "check.failed")
            ? "The character was created, but the imported content did not pass the checks. Open it in the editor to fix it."
            : "The import did not finish. Try again.",
      );
    }
  };

  return (
    <div className="space-y-8">
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
            {loaded ? loaded.fileName : "PNG, JSON or CHARX — read on your device, not uploaded"}
          </span>
        </div>
        <input
          id={ids.file}
          type="file"
          accept=".png,.json,.charx,image/png,application/json"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void open(f);
            e.target.value = "";
          }}
        />
      </div>

      {loaded ? (
        <>
          <section className="catalog-card space-y-4 p-5 pl-8" aria-labelledby="imp-report">
            <h2 id="imp-report" className="font-display text-2xl">
              Import report
            </h2>
            <ImportReport report={loaded.result.report} unstable={unstableEntries(loaded.result)} />
          </section>

          <section className="space-y-4" aria-labelledby="imp-confirm">
            <h2 id="imp-confirm" className="text-2xl">
              Confirm before importing
            </h2>
            <p className="text-sm text-muted-foreground">
              Cards rarely say who owns them or how they may be reused. Tell us — you can change it
              later in the editor.
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
                  <option value="general">General</option>
                  <option value="teen">Teen</option>
                  <option value="mature">Mature</option>
                  <option value="explicit">Explicit</option>
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
                  <option value="original">I created it</option>
                  <option value="fan-work">Fan work</option>
                  <option value="licensed">I have permission</option>
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
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor={ids.display} className="text-sm">
                  Name
                </label>
                <Input
                  id={ids.display}
                  value={display}
                  maxLength={200}
                  onChange={(e) => setDisplay(e.target.value)}
                />
              </div>
              <div className="space-y-1">
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
            </div>
            <Button type="button" disabled={!ready || step !== null} onClick={() => void create()}>
              Import as a new character
            </Button>
            {step ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {step}
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-seal">
          {error}
        </p>
      ) : null}
    </div>
  );
}

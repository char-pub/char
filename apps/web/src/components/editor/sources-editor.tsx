import type { AssetSlot, KnowledgeSource, LocalizedText } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Me } from "@/lib/api";
import { contentReferences } from "@/lib/content-references";
import { localeOf, nextId, type Working } from "@/lib/draft";
import { sourceObjectAnchor } from "@/lib/editor-location";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { sourceAssetUsed } from "@/lib/source-document-editor";
import {
  referenceFileFormat,
  UploadCancelledError,
  UploadError,
  UploadPendingError,
  uploadReferenceText,
} from "@/lib/upload";
import { SourceReplacement } from "./source-replacement";
import { SourceSections } from "./source-sections";

type Props = { working: Working; update: (fn: (w: Working) => Working) => void };
interface RemovedDocument {
  source: KnowledgeSource;
  index: number;
  asset?: AssetSlot;
}
const SOURCE_TYPES = ["world", "lorebook", "character", "scenario"];
function sources(w: Working): KnowledgeSource[] {
  return Array.isArray(w.sources) ? (w.sources as KnowledgeSource[]) : [];
}
function text(value: LocalizedText, locale: string): string {
  return typeof value === "string" ? value : (value[locale] ?? Object.values(value)[0] ?? "");
}
function replaceText(value: LocalizedText, locale: string, next: string): LocalizedText {
  return typeof value === "string" ? next : { ...value, [locale]: next };
}
function validDescription(value: string) {
  return !!value.trim() && Array.from(value).length <= 200;
}
function sourcePrefix(name: string) {
  return (
    name
      .replace(/\.(md|markdown|txt)$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48)
      .replace(/-$/g, "") || "document"
  );
}

/** Only the four Core-supported creation types may declare reference documents. */
export function SourcesEditor(props: Props) {
  const me = useMe();
  if (!SOURCE_TYPES.includes(String(props.working.type))) return null;
  if (me.isPending) return <p role="status">Loading reference documents…</p>;
  if (!me.data) return <p role="alert">Sign in to upload reference documents.</p>;
  return (
    <SourcesEditorSession
      key={`${me.data?.id ?? "anonymous"}:${String(props.working.id ?? props.working.ref ?? "")}`}
      {...props}
      actor={me.data.id}
    />
  );
}
function SourcesEditorSession({ working, update, actor }: Props & { actor: string }) {
  const client = useRegistry();
  const queryClient = useQueryClient();
  const active = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const [stage, setStage] = useState<"uploading" | "processing" | null>(null);
  const [resume, setResume] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removed, setRemoved] = useState<RemovedDocument | null>(null);
  const locale = localeOf(working);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const busy = stage !== null;
  const pick = (next: File) => {
    setError(null);
    setNotice(null);
    setResume(undefined);
    try {
      referenceFileFormat(next);
      setFile(next);
      setTitle(next.name.replace(/\.(md|markdown|txt)$/i, ""));
    } catch (e) {
      setFile(null);
      setError(e instanceof UploadError ? e.message : "This file could not be selected.");
    }
  };
  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setStage(null);
    setResume(undefined);
    setFile(null);
    setError(null);
    setNotice(
      "Cancelled. No document was added. A file already sent may finish processing privately.",
    );
  };
  const upload = async () => {
    if (!file || !title.trim() || !validDescription(description) || busy) return;
    const controller = new AbortController();
    active.current = controller;
    const current = () =>
      active.current === controller &&
      !controller.signal.aborted &&
      queryClient.getQueryData<Me | null>(keys.me)?.id === actor;
    setError(null);
    setNotice(null);
    setStage("uploading");
    try {
      const blob = await uploadReferenceText(client, file, {
        signal: controller.signal,
        isCurrent: current,
        ...(resume ? { resumeUpload: resume } : {}),
        onStage: (value) => {
          if (current()) setStage(value);
        },
      });
      if (!current()) return;
      update((w) => {
        const list = sources(w);
        const id = nextId(
          list.map((s) => s.id),
          sourcePrefix(file.name),
        );
        const slot = nextId(
          (w.assets ?? []).map((a) => a.slot),
          `source-${id}`.slice(0, 56),
        );
        const source: KnowledgeSource = {
          id,
          title: title.trim(),
          description: description.trim(),
          asset: slot,
          format: blob.format,
          ...(shared ? { visibility: { scope: "shared" as const } } : {}),
        };
        return {
          ...w,
          assets: [
            ...(w.assets ?? []),
            {
              slot,
              role: "context",
              variants: [
                {
                  id: "default",
                  media_type: blob.media_type,
                  blob: { digest: blob.digest, size: blob.size, availability: "mirrored" },
                },
              ],
            },
          ],
          sources: [...list, source],
        };
      });
      setFile(null);
      setTitle("");
      setDescription("");
      setShared(false);
      setResume(undefined);
      setNotice("Document added. Build a draft preview to check and use it.");
    } catch (e) {
      if (!current() || e instanceof UploadCancelledError) return;
      if (e instanceof UploadPendingError) setResume(e.uploadId);
      else if (e instanceof UploadError) setResume(undefined);
      setError(
        e instanceof Error
          ? e.message
          : "The upload did not finish. Your document details are kept; try again.",
      );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setStage(null);
      }
    }
  };
  const edit = (id: string, change: (source: KnowledgeSource, w: Working) => KnowledgeSource) =>
    update((w) => ({
      ...w,
      sources: sources(w).map((source) => (source.id === id ? change(source, w) : source)),
    }));
  return (
    <section
      id="edit-sources"
      className="space-y-4 rounded-xl border bg-surface p-5"
      aria-labelledby="reference-documents-heading"
    >
      <h2 id="reference-documents-heading" className="text-xl font-bold">
        Reference documents
      </h2>
      <p className="text-sm text-text-2">
        Add background reading for your story. Titles and descriptions are shown first; the text is
        loaded when selected for the context.
      </p>
      {!sources(working).length ? (
        <p className="text-sm text-text-2">No reference documents yet.</p>
      ) : null}
      {sources(working).map((source) => (
        <fieldset
          key={source.id}
          id={sourceObjectAnchor(source.id)}
          className="space-y-3 rounded-lg border p-3"
        >
          <legend className="px-1 font-semibold">{text(source.title, locale) || source.id}</legend>
          <Label className="block space-y-1">
            <span>Title for {source.id}</span>
            <Input
              required
              value={text(source.title, locale)}
              onChange={(e) =>
                edit(source.id, (s, w) => ({
                  ...s,
                  title: replaceText(s.title, localeOf(w), e.target.value),
                }))
              }
            />
          </Label>
          <Label className="block space-y-1">
            <span>Description for {source.id}</span>
            <Textarea
              required
              value={text(source.description, locale)}
              onChange={(e) =>
                edit(source.id, (s, w) => ({
                  ...s,
                  description: replaceText(s.description, localeOf(w), e.target.value),
                }))
              }
            />
          </Label>
          {!text(source.title, locale).trim() ||
          !validDescription(text(source.description, locale)) ? (
            <p role="alert" className="text-sm text-danger">
              A title and a description of 1–200 characters are required before saving.
            </p>
          ) : null}
          <Label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={source.visibility?.scope === "shared"}
              onChange={(e) => {
                const checked = e.target.checked;
                edit(source.id, (s) => {
                  const { visibility: _, ...rest } = s;
                  return checked ? { ...rest, visibility: { scope: "shared" } } : rest;
                });
              }}
            />
            Share {source.id} with every participant
          </Label>
          <p className="text-xs text-text-2">
            {source.format === "markdown" ? "Markdown" : "Plain text"} ·{" "}
            {source.sections?.length ? `${source.sections.length} sections` : "Whole document"}
          </p>
          <SourceSections
            working={working}
            source={source}
            updateSource={(fn) => edit(source.id, fn)}
          />
          <SourceReplacement working={working} source={source} update={update} actor={actor} />
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const refs = contentReferences(working, "source", source.id);
              if (refs.length) {
                setError(`Remove document references first: ${refs.join("; ")}`);
                return;
              }
              const asset = working.assets?.find((item) => item.slot === source.asset);
              setRemoved({
                source,
                index: sources(working).findIndex((item) => item.id === source.id),
                ...(asset ? { asset } : {}),
              });
              setError(null);
              setNotice("Document removed from this draft. The private upload is kept for reuse.");
              update((w) => {
                const remaining = sources(w).filter((item) => item.id !== source.id);
                return {
                  ...w,
                  sources: remaining,
                  ...(sourceAssetUsed(w, source.asset, remaining)
                    ? {}
                    : { assets: (w.assets ?? []).filter((item) => item.slot !== source.asset) }),
                };
              });
            }}
          >
            Remove {source.id}
          </Button>
        </fieldset>
      ))}
      {removed ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (sources(working).some((s) => s.id === removed.source.id)) {
              setError("This document ID is now in use. Remove that document before undoing.");
              return;
            }
            const existingAsset = working.assets?.find(
              (item) => item.slot === removed.source.asset,
            );
            if (
              existingAsset &&
              removed.asset &&
              JSON.stringify(existingAsset) !== JSON.stringify(removed.asset)
            ) {
              setError(
                "This document’s file has changed. Add the document again instead of undoing.",
              );
              return;
            }
            update((w) => {
              const next = [...sources(w)];
              next.splice(Math.max(0, Math.min(removed.index, next.length)), 0, removed.source);
              return {
                ...w,
                sources: next,
                ...(removed.asset &&
                !(w.assets ?? []).some((item) => item.slot === removed.asset?.slot)
                  ? { assets: [...(w.assets ?? []), removed.asset] }
                  : {}),
              };
            });
            setRemoved(null);
            setNotice("Document restored.");
          }}
        >
          Undo document removal
        </Button>
      ) : null}
      <div className="space-y-3 border-t pt-4">
        <Label className="block space-y-1">
          <span>Reference file</span>
          <Input
            ref={fileInput}
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            disabled={busy}
            onChange={(e) => {
              const next = e.target.files?.[0];
              if (next) pick(next);
              e.target.value = "";
            }}
          />
        </Label>
        <p className="text-xs text-text-2">
          Plain text or Markdown in UTF-8, up to 8 MiB. The original text and line endings are
          preserved.
        </p>
        {file ? (
          <>
            <p className="text-sm">Selected: {file.name}</p>
            <Label className="block space-y-1">
              <span>Document title</span>
              <Input
                required
                disabled={busy}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Label>
            <Label className="block space-y-1">
              <span>Document description</span>
              <Textarea
                required
                disabled={busy}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Label>
            <p className="text-xs text-text-2">
              Describe when this document is useful, in 1–200 characters.
            </p>
            {description && !validDescription(description) ? (
              <p role="alert" className="text-sm text-danger">
                Use a description of 1–200 characters.
              </p>
            ) : null}
            <Label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={busy}
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              Share with every participant
            </Label>
            <p className="text-xs text-text-2">
              Shared documents may appear in any participant’s context. Leave this off to keep the
              document available only in narrator view.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy || !title.trim() || !validDescription(description)}
                onClick={() => void upload()}
              >
                {busy
                  ? stage === "uploading"
                    ? "Uploading…"
                    : "Checking file…"
                  : resume
                    ? "Check processing"
                    : "Upload reference"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancel}>
                Cancel adding document
              </Button>
            </div>
          </>
        ) : null}
      </div>
      {busy ? (
        <p role="status" className="text-sm text-text-2">
          {stage === "uploading"
            ? "Uploading your document…"
            : "Checking your document before adding it…"}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-text-2">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

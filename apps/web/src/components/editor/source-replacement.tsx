import { type KnowledgeSource, MAX_SOURCE_BYTES } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Me } from "@/lib/api";
import type { Working } from "@/lib/draft";
import { keys, useRegistry } from "@/lib/registry";
import {
  type DocumentReplacement,
  documentsOf,
  replaceDocument,
  undoDocumentReplacement,
} from "@/lib/source-document-editor";
import { decodeSourceDocument, validateSourceDocument } from "@/lib/source-sections";
import {
  referenceFileFormat,
  UploadCancelledError,
  UploadPendingError,
  uploadReferenceText,
} from "@/lib/upload";

export function SourceReplacement({
  working,
  source,
  update,
  actor,
}: {
  working: Working;
  source: KnowledgeSource;
  update: (fn: (w: Working) => Working) => void;
  actor: string;
}) {
  const client = useRegistry();
  const query = useQueryClient();
  const latest = useRef(working);
  latest.current = working;
  const active = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<DocumentReplacement | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setResume(undefined);
    setFile(null);
    setError("");
    setNotice(
      "Replacement cancelled. The current document is unchanged; an uploaded file may finish processing privately.",
    );
  };
  const replace = async () => {
    if (!file || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const current = () =>
      active.current === controller &&
      !controller.signal.aborted &&
      query.getQueryData<Me | null>(keys.me)?.id === actor;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!current()) return;
      const old = latest.current.assets?.find((a) => a.slot === source.asset);
      if (!old)
        throw new Error("The current document file is missing. Restore it before replacing.");
      const format = referenceFileFormat(file);
      if (file.size > MAX_SOURCE_BYTES)
        throw new Error("Reference documents can be at most 8 MiB.");
      const bytes = await file.arrayBuffer();
      if (!current()) return;
      const body = decodeSourceDocument(new Uint8Array(bytes));
      validateSourceDocument({ ...source, format }, body);
      const blob = await uploadReferenceText(client, file, {
        signal: controller.signal,
        isCurrent: current,
        ...(resume ? { resumeUpload: resume } : {}),
      });
      if (!current()) return;
      const w = latest.current;
      const now = documentsOf(w).find((s) => s.id === source.id);
      if (!now)
        throw new Error("This document was removed while uploading. No replacement was applied.");
      validateSourceDocument({ ...now, format: blob.format }, body);
      const result = replaceDocument(w, source, old, blob);
      update((fresh) => {
        if (query.getQueryData<Me | null>(keys.me)?.id !== actor) return fresh;
        const live = documentsOf(fresh).find((s) => s.id === source.id);
        if (!live) return fresh;
        validateSourceDocument({ ...live, format: blob.format }, body);
        return replaceDocument(fresh, source, old, blob).working;
      });
      setReceipt(result.receipt);
      setFile(null);
      setResume(undefined);
      setNotice(
        "File replaced. Document and section IDs were kept. Build a new preview to use the replacement.",
      );
    } catch (e) {
      if (!current() || e instanceof UploadCancelledError) return;
      if (e instanceof UploadPendingError) setResume(e.uploadId);
      else setResume(undefined);
      setError(
        e instanceof Error ? e.message : "The replacement failed. The current file is kept.",
      );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <details className="space-y-2 rounded border p-3">
      <summary>Replace file for {source.id}</summary>
      <p className="text-xs text-text-2">
        Keeps this document’s identity and sections. All existing anchors must be present in the new
        file. Other documents using the old file keep their copy.
      </p>
      <Label className="block">
        Replacement file for {source.id}
        <Input
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          disabled={busy}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) {
              setFile(picked);
              setResume(undefined);
              setError("");
              setNotice("");
            }
            e.target.value = "";
          }}
        />
      </Label>
      {file ? (
        <div className="flex flex-wrap gap-2">
          <span>{file.name}</span>
          <Button type="button" disabled={busy} onClick={() => void replace()}>
            {busy
              ? "Replacing…"
              : resume
                ? "Check replacement processing"
                : "Replace document file"}
          </Button>
          <Button type="button" variant="ghost" onClick={cancel}>
            Cancel replacement
          </Button>
        </div>
      ) : null}
      {receipt ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (query.getQueryData<Me | null>(keys.me)?.id !== actor) return;
            try {
              undoDocumentReplacement(latest.current, receipt);
              update((w) => undoDocumentReplacement(w, receipt));
              setReceipt(null);
              setError("");
              setNotice("Previous document file restored.");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Cannot undo this replacement.");
            }
          }}
        >
          Undo file replacement
        </Button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </details>
  );
}

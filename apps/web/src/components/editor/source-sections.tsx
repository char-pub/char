/** Source organization from explicit author input; this component never fetches private asset bytes. */
import { type KnowledgeSource, type LocalizedText, MAX_SOURCE_BYTES } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Me } from "@/lib/api";
import { contentReferences } from "@/lib/content-references";
import { localeOf, nextId, type Working } from "@/lib/draft";
import { sourceObjectAnchor } from "@/lib/editor-location";
import { keys, useMe } from "@/lib/registry";
import {
  proposedSourceSections,
  sourceDocumentIdentity,
  validateSourceDocument,
  verifiedSourceDocument,
} from "@/lib/source-sections";
import { storyText, withStoryText } from "@/lib/story-editor";
import { Field } from "./policy-editor";

type Section = NonNullable<KnowledgeSource["sections"]>[number];
export interface SourceSectionsProps {
  working: Working;
  source: KnowledgeSource;
  updateSource: (fn: (current: KnowledgeSource, working: Working) => KnowledgeSource) => void;
}
function optionalText(
  value: LocalizedText | undefined,
  locale: string,
  text: string,
): LocalizedText | undefined {
  if (text !== "") return withStoryText(value, locale, text);
  if (value && typeof value === "object") {
    const { [locale]: _removed, ...rest } = value;
    if (Object.keys(rest).length) return rest;
  }
  return undefined;
}
export function SourceSections({ working, source, updateSource }: SourceSectionsProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const actor = me.data?.id;
  const locale = localeOf(working);
  const identity = sourceDocumentIdentity(working, source);
  const latest = useRef({ identity, actor });
  latest.current = { identity, actor };
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState<{ identity: string; text: string; name: string }>();
  const [proposal, setProposal] = useState<{
    identity: string;
    before: string;
    sections: Section[];
  }>();
  const [removed, setRemoved] = useState<{ identity: string; section: Section; index: number }>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    sequence.current++;
    setBody(undefined);
    setProposal(undefined);
    setBusy(false);
    setError("");
    return () => {
      sequence.current++;
    };
  }, [identity, actor]);
  const currentActor = () =>
    actor !== undefined && queryClient.getQueryData<Me | null>(keys.me)?.id === actor;
  const edit = (id: string, fn: (section: Section, w: Working) => Section) => {
    if (!currentActor()) return;
    updateSource((current, w) => ({
      ...current,
      sections: current.sections?.map((section) => (section.id === id ? fn(section, w) : section)),
    }));
    setProposal(undefined);
  };
  const load = async (file: File) => {
    if (!currentActor()) return;
    if (file.size > MAX_SOURCE_BYTES) {
      setError("Reference documents can be at most 8 MiB.");
      return;
    }
    const operation = ++sequence.current;
    const isCurrent = () =>
      sequence.current === operation &&
      currentActor() &&
      latest.current.identity === identity &&
      latest.current.actor === actor;
    setBusy(true);
    setError("");
    setNotice("");
    setProposal(undefined);
    setBody(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent()) return;
      const text = verifiedSourceDocument(working, source, bytes);
      if (!isCurrent()) return;
      setBody({ identity, text, name: file.name });
      setNotice("Local file matches the current asset. Nothing was uploaded.");
      try {
        validateSourceDocument(source, text);
      } catch (cause) {
        setError(
          `Current sections need attention: ${cause instanceof Error ? cause.message : "invalid anchors"}`,
        );
      }
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : "This local file could not be read.");
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const validBody = body?.identity === identity ? body : undefined;
  return (
    <div className="space-y-3">
      <details className="space-y-3 rounded border p-3" open={!!source.sections?.length}>
        <summary className="cursor-pointer font-semibold">Sections for {source.id}</summary>
        <p className="text-xs text-text-2">
          Stable section IDs keep scene and selection references attached. Markdown uses the exact
          heading text, including case; plain text uses inclusive line ranges such as L1-L5. A real
          build verifies every anchor.
        </p>
        {(source.sections ?? []).map((section, index) => {
          const blockers = contentReferences(working, "section", source.id, section.id);
          return (
            <fieldset
              key={section.id}
              id={sourceObjectAnchor(source.id, section.id)}
              className="space-y-2 rounded border p-3"
            >
              <legend>Section {section.id}</legend>
              <p className="text-xs">Stable ID: {section.id}</p>
              <Field
                label={`Title for ${source.id}/${section.id}`}
                value={storyText(section.title, locale)}
                onChange={(text) =>
                  edit(section.id, (current, w) => ({
                    ...current,
                    title: withStoryText(current.title, localeOf(w), text),
                  }))
                }
              />
              <Field
                label={`Description for ${source.id}/${section.id}`}
                multiline
                value={storyText(section.description, locale)}
                onChange={(text) =>
                  edit(section.id, (current, w) => {
                    const description = optionalText(current.description, localeOf(w), text);
                    const { description: _old, ...rest } = current;
                    return description === undefined ? rest : { ...rest, description };
                  })
                }
              />
              <Field
                label={`Anchor for ${source.id}/${section.id}`}
                value={section.anchor}
                onChange={(anchor) => edit(section.id, (current) => ({ ...current, anchor }))}
              />
              {!storyText(section.title, locale).trim() || !section.anchor.trim() ? (
                <p role="alert">A title and anchor are required before building.</p>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={blockers.length > 0}
                onClick={() => {
                  if (
                    !currentActor() ||
                    contentReferences(working, "section", source.id, section.id).length
                  )
                    return;
                  updateSource((current, w) =>
                    contentReferences(w, "section", current.id, section.id).length
                      ? current
                      : {
                          ...current,
                          sections: current.sections?.filter((value) => value.id !== section.id),
                        },
                  );
                  setRemoved({ identity, section, index });
                  setProposal(undefined);
                  setError("");
                  setNotice(`Removed section ${section.id}.`);
                }}
              >
                Remove section {source.id}/{section.id}
              </Button>
              {blockers.length ? (
                <p className="text-xs">Remove references first: {blockers.join(", ")}</p>
              ) : null}
            </fieldset>
          );
        })}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!currentActor()) return;
            updateSource((current) => ({
              ...current,
              sections: [
                ...(current.sections ?? []),
                {
                  id: nextId(
                    (current.sections ?? []).map((section) => section.id),
                    "section",
                  ),
                  title: "New section",
                  anchor: "",
                },
              ],
            }));
            setProposal(undefined);
          }}
        >
          Add section to {source.id}
        </Button>
        {removed ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!currentActor()) return;
              if (removed.identity !== identity) {
                setError(
                  "The document file changed. Restore its original file or add a section with a new verified anchor.",
                );
                return;
              }
              if (source.sections?.some((section) => section.id === removed.section.id)) {
                setError("This section ID is in use. Undo cannot replace it.");
                return;
              }
              updateSource((current, w) => {
                if (
                  sourceDocumentIdentity(w, current) !== removed.identity ||
                  current.sections?.some((section) => section.id === removed.section.id)
                )
                  return current;
                const sections = [...(current.sections ?? [])];
                sections.splice(Math.min(removed.index, sections.length), 0, removed.section);
                return { ...current, sections };
              });
              setRemoved(undefined);
              setProposal(undefined);
              setError("");
              setNotice("Section restored; later document edits were kept.");
            }}
          >
            Undo section removal for {source.id}
          </Button>
        ) : null}
        <details className="space-y-2 border-t pt-3">
          <summary className="cursor-pointer">Check a local file or generate headings</summary>
          <p className="text-xs text-text-2">
            Choose the original file yourself. It must match this document's asset digest. This tool
            does not download private content or upload your file.
          </p>
          <Label className="block">
            Local file for {source.id}
            <Input
              type="file"
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void load(file);
              }}
            />
          </Label>
          {busy ? <p role="status">Reading local file…</p> : null}
          {validBody ? <p className="text-xs">Verified local file: {validBody.name}</p> : null}
          <Button
            type="button"
            variant="outline"
            disabled={!validBody || busy}
            onClick={() => {
              if (!currentActor() || !validBody) return;
              try {
                validateSourceDocument(source, validBody.text);
                setError("");
                setNotice(
                  "All current section anchors match this file. Build the draft to verify the complete work.",
                );
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Invalid section anchors.");
              }
            }}
          >
            Check anchors for {source.id}
          </Button>
          {source.format === "markdown" ? (
            <Button
              type="button"
              variant="outline"
              disabled={!validBody || busy}
              onClick={() => {
                if (!currentActor() || !validBody) return;
                try {
                  const sections = proposedSourceSections(source, validBody.text);
                  setProposal({
                    identity,
                    before: JSON.stringify(source.sections ?? []),
                    sections,
                  });
                  setError("");
                  if (!sections.length) setNotice("No new unique headings to add.");
                } catch (cause) {
                  setProposal(undefined);
                  setError(cause instanceof Error ? cause.message : "Could not generate sections.");
                }
              }}
            >
              Preview sections from headings for {source.id}
            </Button>
          ) : null}
          {proposal && proposal.identity === identity && proposal.sections.length ? (
            <section
              className="space-y-2 rounded border p-3"
              aria-label={`Proposed sections for ${source.id}`}
            >
              <p>
                These sections will be appended. Existing section titles, translations and
                references stay unchanged.
              </p>
              <ul>
                {proposal.sections.map((section) => (
                  <li key={section.id}>
                    {section.id} · {String(section.title)} · {section.anchor}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!currentActor()) return;
                  if (proposal.before !== JSON.stringify(source.sections ?? [])) {
                    setError(
                      "Sections changed since this preview. Generate a new preview before adding them.",
                    );
                    return;
                  }
                  updateSource((current, w) =>
                    sourceDocumentIdentity(w, current) !== proposal.identity ||
                    proposal.before !== JSON.stringify(current.sections ?? [])
                      ? current
                      : {
                          ...current,
                          sections: [...(current.sections ?? []), ...proposal.sections],
                        },
                  );
                  setProposal(undefined);
                  setError("");
                  setNotice(
                    "Generated sections added. Add descriptions to help select the right passage.",
                  );
                }}
              >
                Add generated sections to {source.id}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setProposal(undefined)}>
                Cancel generated sections for {source.id}
              </Button>
            </section>
          ) : null}
          {busy || body || proposal ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                sequence.current++;
                setBusy(false);
                setBody(undefined);
                setProposal(undefined);
                setNotice("Local file cleared. No content was uploaded or changed.");
              }}
            >
              Clear local file for {source.id}
            </Button>
          ) : null}
        </details>
      </details>
      <details className="space-y-2 rounded border p-3" open={!!source.origin}>
        <summary className="cursor-pointer font-semibold">Attribution for {source.id}</summary>
        <Field
          label={`Origin title for ${source.id}`}
          value={storyText(source.origin?.title, locale)}
          onChange={(text) => {
            if (!currentActor()) return;
            updateSource((current, w) => {
              const title = optionalText(current.origin?.title, localeOf(w), text);
              const { title: _old, ...rest } = current.origin ?? {};
              const origin = title === undefined ? rest : { ...rest, title };
              const { origin: _origin, ...other } = current;
              return Object.keys(origin).length ? { ...other, origin } : other;
            });
          }}
        />
        <Field
          label={`Origin URL for ${source.id}`}
          type="url"
          value={source.origin?.url ?? ""}
          onChange={(url) => {
            if (!currentActor()) return;
            updateSource((current) => {
              const { url: _old, ...rest } = current.origin ?? {};
              const origin = url === "" ? rest : { ...rest, url };
              const { origin: _origin, ...other } = current;
              return Object.keys(origin).length ? { ...other, origin } : other;
            });
          }}
        />
        {source.origin?.url && !/^https:\/\//.test(source.origin.url) ? (
          <p role="alert">Use an HTTPS source URL before building.</p>
        ) : null}
      </details>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}

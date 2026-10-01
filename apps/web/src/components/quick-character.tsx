import { type CreationMeta, NAME_RE } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { type Draft, isApiError, type Me, type ReleaseSummary } from "@/lib/api";
import { type ArtifactChoice, artifactChoice } from "@/lib/artifact-choice";
import { getMainText, getName, setMainText, setName } from "@/lib/draft";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { parseRef, slugify } from "@/lib/text";
import { useDraftEditor } from "@/lib/use-draft-editor";
import { LICENSE_PRESETS, RATING_OPTIONS, RIGHTS_OPTIONS } from "./editor/options";
import { PublishDialog } from "./editor/publish-panel";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Textarea } from "./ui/textarea";

function Field({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          id={id}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

/** A small authoring entrance, followed by the existing explicit Registry publication flow. */
export function QuickCharacter({
  onPick,
  visible,
}: {
  onPick: (choice: ArtifactChoice) => void;
  visible: boolean;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const me = useMe();
  const actor = me.data?.id;
  const ns = me.data?.namespace;
  const [name, setTitle] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [rating, setRating] = useState<CreationMeta["rating"] | "">("");
  const [license, setLicense] = useState("");
  const [rights, setRights] = useState<CreationMeta["rights"] | "">("");
  const [created, setCreated] = useState<{ ref: string; draft?: Draft }>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  const ids = { rating: useId(), license: useId(), rights: useId() };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const live = () => active.current && !!actor && qc.getQueryData<Me | null>(keys.me)?.id === actor;
  const slug = address ?? slugify(name);
  const create = async () => {
    if (
      pending.current ||
      !live() ||
      !ns ||
      !NAME_RE.test(slug) ||
      !name.trim() ||
      !description.trim() ||
      !rating ||
      !license ||
      !rights
    )
      return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await client.createCreation(ns, {
        name: slug,
        type: "character",
        display_name: name.trim(),
        working: {
          fragments: [
            {
              id: "description",
              stable: true,
              kind: "character",
              content: { type: "text", text: description },
            },
          ],
          meta: { default_locale: "en", rating, license, rights },
        },
      });
      if (!live()) return;
      setCreated({ ref: result.ref });
      const location = parseRef(result.ref);
      if (!location) throw new Error("The created character has no valid address.");
      const draft = await client.draft(location.ns, location.name);
      if (live()) setCreated({ ref: result.ref, draft });
      await qc.invalidateQueries({ queryKey: keys.myCreations });
    } catch (cause) {
      if (live())
        setError(
          isApiError(cause) && cause.status >= 400 && cause.status < 500
            ? cause.message
            : "The result could not be confirmed. Check My creations before creating another character. Your entered text is kept here.",
        );
    } finally {
      pending.current = false;
      if (live()) setBusy(false);
    }
  };
  if (!me.data) return <p className="text-sm">Sign in to create a character.</p>;
  if (!ns)
    return (
      <p className="text-sm">
        Choose your personal namespace on{" "}
        <Link to="/create" target="_blank" rel="noopener noreferrer" className="underline">
          the creation page
        </Link>{" "}
        first.
      </p>
    );
  if (created) {
    const location = parseRef(created.ref);
    if (location && created.draft)
      return (
        <CreatedCharacter
          key={created.ref}
          {...location}
          initial={created.draft}
          actor={actor ?? ""}
          onPick={onPick}
          visible={visible}
        />
      );
    return (
      <section className="space-y-2" aria-label="Created character">
        <p>Created draft {created.ref}. It has not been selected or published.</p>
        {error ? <p role="alert">{error}</p> : null}
        {location ? (
          <>
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const draft = await client.draft(location.ns, location.name);
                  if (live()) setCreated({ ref: created.ref, draft });
                } catch {
                  if (live())
                    setError(
                      "Could not load this saved draft. You can reopen it from My creations.",
                    );
                } finally {
                  if (live()) setBusy(false);
                }
              }}
            >
              Load saved draft
            </Button>
            <Link
              to="/c/$ns/$name/edit"
              params={location}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Open saved draft
            </Link>
          </>
        ) : null}
      </section>
    );
  }
  return (
    <section aria-label="Create a character here" className="space-y-3">
      <p className="text-sm text-text-2">
        Write a character, save it, then review and publish an exact version before adding it to
        this story. Closing this picker does not delete a draft already created.
      </p>
      <Field label="New character name" value={name} onChange={setTitle} />
      <Field label={`Character address in @${ns}`} value={slug} onChange={setAddress} />
      <Field
        label="New character introduction"
        value={description}
        multiline
        onChange={setDescription}
      />
      <Label htmlFor={ids.rating}>Character rating</Label>
      <NativeSelect
        id={ids.rating}
        value={rating}
        onChange={(e) => setRating(e.target.value as CreationMeta["rating"])}
      >
        <option value="">Choose a rating</option>
        {RATING_OPTIONS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </NativeSelect>
      <Label htmlFor={ids.rights}>Character rights</Label>
      <NativeSelect
        id={ids.rights}
        value={rights}
        onChange={(e) => setRights(e.target.value as CreationMeta["rights"])}
      >
        <option value="">Choose the rights you hold</option>
        {RIGHTS_OPTIONS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </NativeSelect>
      <Label htmlFor={ids.license}>Character license</Label>
      <NativeSelect id={ids.license} value={license} onChange={(e) => setLicense(e.target.value)}>
        <option value="">Choose a license</option>
        {LICENSE_PRESETS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </NativeSelect>
      {error ? <p role="alert">{error}</p> : null}
      <Button
        type="button"
        disabled={
          busy ||
          !name.trim() ||
          !description.trim() ||
          !NAME_RE.test(slug) ||
          !rating ||
          !rights ||
          !license
        }
        onClick={() => void create()}
      >
        {busy ? "Creating…" : "Create character draft"}
      </Button>
      {error ? (
        <Link to="/me" target="_blank" rel="noopener noreferrer" className="ml-3 underline">
          Check My creations
        </Link>
      ) : null}
    </section>
  );
}

function CreatedCharacter({
  ns,
  name,
  initial,
  actor,
  onPick,
  visible,
}: {
  ns: string;
  name: string;
  initial: Draft;
  actor: string;
  onPick: (choice: ArtifactChoice) => void;
  visible: boolean;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const live = () => qc.getQueryData<Me | null>(keys.me)?.id === actor;
  const ed = useDraftEditor(client, ns, name, initial, { isCurrent: live });
  const [open, setOpen] = useState(false);
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [version, setVersion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const request = useRef(0);
  const shown = useRef(visible);
  shown.current = visible;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current++;
    };
  }, []);
  useEffect(() => {
    if (!visible) {
      request.current++;
      setBusy(false);
      setOpen(false);
    }
  }, [visible]);
  const current = (id: number) =>
    active.current && shown.current && live() && request.current === id;
  const refresh = async () => {
    if (!live() || !shown.current) return;
    const id = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const result = await client.creation(ns, name);
      if (current(id)) {
        setReleases(result.releases.filter((r) => r.status === "active"));
        setVersion("");
      }
    } catch {
      if (current(id))
        setError("Could not load published versions. Your saved draft remains available.");
    } finally {
      if (current(id)) setBusy(false);
    }
  };
  const pick = async () => {
    const selected = releases.find((release) => release.id === version);
    if (!selected || !live() || !shown.current || busy) return;
    const id = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const artifact = await client.getArtifact(ns, name, selected.label, {
        private: selected.visibility === "private",
      });
      if (current(id)) onPick(artifactChoice(artifact, selected));
    } catch (cause) {
      if (current(id))
        setError(cause instanceof Error ? cause.message : "Could not load the selected character.");
    } finally {
      if (current(id)) setBusy(false);
    }
  };
  const blocked =
    !getName(ed.working).trim() || !getMainText(ed.working, "character").trim()
      ? "Fill in the character's name and introduction before publishing."
      : ["denied", "invalid", "conflict"].includes(ed.state.kind)
        ? "Resolve the saved draft's errors in its editor before publishing."
        : null;
  const editorLink = (
    <Link
      to="/c/$ns/$name/edit"
      params={{ ns, name }}
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
    >
      Open full character editor
    </Link>
  );
  return (
    <section aria-label="Created character" className="space-y-3">
      <p>
        Saved draft{" "}
        <code>
          @{ns}/{name}
        </code>
        . A draft cannot be used as a story dependency.
      </p>
      <Field
        label="Created character name"
        value={getName(ed.working)}
        onChange={(text) => ed.update((working) => setName(working, text))}
      />
      <Field
        label="Created character introduction"
        value={getMainText(ed.working, "character")}
        multiline
        onChange={(text) => ed.update((working) => setMainText(working, "character", text))}
      />
      <p role="status">
        {ed.state.kind === "saved"
          ? "Character draft saved."
          : ed.state.kind === "saving" || ed.state.kind === "dirty"
            ? "Saving character edits…"
            : "Your edits are kept here; resolve the save problem before publishing."}
      </p>
      {blocked ? <p role="alert">{blocked}</p> : null}
      {editorLink}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!!blocked} onClick={() => setOpen(true)}>
          Review and publish character
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>
          Refresh published versions
        </Button>
      </div>
      {releases.length ? (
        <>
          <Label>
            Published character version
            <NativeSelect
              value={version}
              onChange={(e) => {
                request.current++;
                setBusy(false);
                setVersion(e.target.value);
              }}
            >
              <option value="">Choose an exact version</option>
              {releases.map((release) => (
                <option key={release.id} value={release.id}>
                  {release.label} · {release.visibility}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Button type="button" disabled={!version || busy} onClick={() => void pick()}>
            Use published character
          </Button>
        </>
      ) : (
        <p className="text-sm text-text-2">
          After publishing finishes, return here and select a published version.
        </p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <PublishDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) void refresh();
        }}
        ns={ns}
        name={name}
        displayName={getName(ed.working)}
        existingLabels={releases.map((release) => release.label)}
        releases={releases}
        basedOn={releases[0]?.label}
        working={ed.working}
        update={ed.update}
        save={ed.flushSnapshot}
        blocked={blocked}
        warnings={ed.warnings}
        references={[]}
        onLocate={() => {
          setOpen(false);
          setError("Open the full character editor to fix the reported field.");
        }}
        onOpenDependencies={() => {
          setOpen(false);
          setError("Open the full character editor to inspect dependencies.");
        }}
      />
    </section>
  );
}

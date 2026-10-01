import {
  type CreationArtifact,
  type CreationType,
  expressionTraits,
  NAME_RE,
  publishedIdentity,
  sameBuildIdentity,
} from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { isApiError, type Me, type ReleaseSummary } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { localized, parseRef, slugify } from "@/lib/text";
import { AddressField } from "./address-field";
import { MatureGate } from "./mature-gate";
import { NamespaceSetup } from "./namespace-setup";
import { RATING_LABEL } from "./rating";
import { SignInRequired } from "./sign-in-required";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";

type Kind = "remix" | "sequel";
type Selected = Pick<ReleaseSummary, "id" | "label" | "semantic_digest" | "status">;
type Props = {
  artifact: CreationArtifact | undefined;
  release: Selected | undefined;
  sourceName: string;
  sourceType: CreationType;
  allowMature?: boolean;
  onCreated?: (ref: string) => void | Promise<void>;
};

function sourceOf(artifact: CreationArtifact | undefined, release: Selected | undefined) {
  if (!artifact || !release || release.status !== "active") return null;
  try {
    const identity = publishedIdentity(artifact.root);
    if (
      identity.release !== release.id ||
      artifact.root.semantic_digest !== release.semantic_digest
    )
      return null;
    const rootLicenses = artifact.meta.licenses.filter(
      (item) => item.ref === artifact.root.ref && !item.asset,
    );
    if (!rootLicenses.length) return null;
    if (
      !rootLicenses.every((item) =>
        expressionTraits(item.license).some(
          (option) => option.redistributable && option.derivatives,
        ),
      )
    )
      return null;
    // The root definition is adapted; its assets retain their exact bytes. Unchanged
    // dependency and historical-source licenses are checked by the server's exact closure.
    const rootAssets = artifact.assets.filter((asset) =>
      sameBuildIdentity(asset.origin, artifact.root),
    );
    if (
      !rootAssets.every((asset) =>
        expressionTraits(asset.license).some((option) => option.redistributable),
      )
    )
      return null;
    return {
      ref: artifact.root.ref,
      release: identity.release,
      semantic_digest: artifact.root.semantic_digest,
    };
  } catch {
    return null;
  }
}

/** The artifact gates discovery; only the server's exact Release source defines the derived draft. */
export function DeriveCreation(props: Props) {
  const me = useMe();
  const source = sourceOf(props.artifact, props.release);
  if (!source || !props.artifact || !props.release || me.isPending) return null;
  return (
    <DeriveSession
      key={`${me.data?.id ?? "anonymous"}:${source.ref}:${source.release}:${source.semantic_digest}`}
      {...props}
      artifact={props.artifact}
      release={props.release}
      actor={me.data ?? null}
    />
  );
}
function DeriveSession({
  artifact,
  release,
  sourceName,
  sourceType,
  allowMature,
  onCreated,
  actor,
}: Omit<Props, "artifact" | "release"> & {
  artifact: CreationArtifact;
  release: Selected;
  actor: Me | null;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  return (
    <>
      <Button variant="outline" onClick={() => setKind("remix")}>
        Remix
      </Button>
      {sourceType === "scenario" ? (
        <Button variant="outline" onClick={() => setKind("sequel")}>
          Create sequel
        </Button>
      ) : null}
      <Dialog
        open={kind !== null}
        onOpenChange={(open) => {
          if (!open) setKind(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {kind === "sequel" ? "Create a sequel" : "Remix this creation"}
            </DialogTitle>
            <DialogDescription>
              Create your own draft from this exact published version, then continue in the editor.
            </DialogDescription>
          </DialogHeader>
          {!actor ? (
            <SignInRequired what="create your own version" level={2} />
          ) : (
            <MatureGate
              rating={artifact.meta.rating}
              allowed={allowMature}
              identity={actor.id}
              remember={artifact.root.ref}
              signedIn
            >
              {!actor.namespace ? (
                <NamespaceSetup key={actor.id} suggestion={actor.name} />
              ) : kind ? (
                <DeriveForm
                  key={kind}
                  artifact={artifact}
                  release={release}
                  sourceName={sourceName}
                  kind={kind}
                  actor={actor}
                  namespace={actor.namespace}
                  onCreated={onCreated}
                />
              ) : null}
            </MatureGate>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function message(error: unknown) {
  if (isApiError(error, "creation.taken") || isApiError(error, "creation.conflict"))
    return "That address is already used. Choose another address and try again.";
  if (isApiError(error) && error.status === 401)
    return "Your session expired. Sign in again before creating this draft.";
  if (isApiError(error) && [403, 404, 410].includes(error.status))
    return "This source or its permissions changed. Check that this version is still available and permits adaptation.";
  if (isApiError(error) && error.status === 422)
    return "The draft could not be created from this source. Check its license, references and selected ending, then try again.";
  return "Could not create your draft. Your choices are kept; try again.";
}
function DeriveForm({
  artifact,
  release,
  sourceName,
  kind,
  actor,
  namespace,
  onCreated,
}: {
  artifact: CreationArtifact;
  release: Selected;
  sourceName: string;
  kind: Kind;
  actor: Me;
  namespace: string;
  onCreated: Props["onCreated"];
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const id = useId();
  const [title, setTitle] = useState(`${sourceName} ${kind === "sequel" ? "sequel" : "remix"}`);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [ending, setEnding] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && qc.getQueryData<Me | null>(keys.me)?.id === actor.id;
  const slug = nameTouched ? name : slugify(title);
  const valid = title.trim().length > 0 && NAME_RE.test(slug) && agreed;
  const source = sourceOf(artifact, release);
  const endings = artifact.kind === "content" ? (artifact.story?.endings ?? []) : [];
  const submit = async () => {
    if (!current() || pending.current || !valid || !source) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await client.deriveCreation(namespace, {
        source,
        kind,
        name: slug,
        display_name: title.trim(),
        ...(kind === "sequel" && ending ? { ending } : {}),
        rights_ack: { inbound_equals_outbound: true },
      });
      if (!current()) return;
      await qc.invalidateQueries({ queryKey: keys.myCreations });
      if (!current()) return;
      if (onCreated) await onCreated(result.ref);
      else {
        const target = parseRef(result.ref);
        if (!target) throw new Error("Invalid created address");
        await navigate({ to: "/c/$ns/$name/edit", params: { ns: target.ns, name: target.name } });
      }
    } catch (cause) {
      if (current()) setError(cause);
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-2 rounded border p-3 text-sm">
        <p>
          Source:{" "}
          <span className="font-mono break-all">
            {artifact.root.ref}@{release.label}
          </span>
        </p>
        <p className="break-all font-mono text-xs">{release.id}</p>
        <p>Rating: {RATING_LABEL[artifact.meta.rating]}</p>
        <ul aria-label="Source licenses" className="space-y-1">
          {artifact.meta.licenses.map((item, index) => (
            <li key={`${item.ref}:${item.asset ?? index}`}>
              <span className="font-mono">
                {item.ref}
                {item.asset ? `#${item.asset}` : ""}
              </span>
              : {item.license}
            </li>
          ))}
        </ul>
        <p>
          Existing dependencies keep their exact versions. Credits, licenses and source attribution
          are preserved. This creates a separate draft and does not change or publish the original.
        </p>
      </div>
      {kind === "sequel" ? (
        <>
          <p className="text-sm">
            Creates a new opening from the ending's stated effects, not a player's saved session.
            Copied cast and background keep their scene restrictions; review and arrange them in the
            editor. Previous opening messages and author tests are not carried over, and no story
            text is automatically rewritten.
          </p>
          <label className="block space-y-1 text-sm" htmlFor={`${id}-ending`}>
            Ending to continue from
            <NativeSelect
              id={`${id}-ending`}
              value={ending}
              disabled={busy}
              onChange={(event) => setEnding(event.target.value)}
            >
              <option value="">No specific ending</option>
              {endings.map((item) => (
                <option key={item.id} value={item.id}>
                  {localized(item.title, artifact.meta.default_locale) || item.id} ({item.id})
                </option>
              ))}
            </NativeSelect>
          </label>
        </>
      ) : null}
      <label className="block space-y-1 text-sm" htmlFor={`${id}-title`}>
        New title
        <Input
          id={`${id}-title`}
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="space-y-1">
        <label className="text-sm" htmlFor={`${id}-name`}>
          New address
        </label>
        <fieldset disabled={busy}>
          <AddressField
            id={`${id}-name`}
            hintId={`${id}-hint`}
            ns={namespace}
            value={slug}
            onChange={(value) => {
              setName(value);
              setNameTouched(true);
            }}
            availability={NAME_RE.test(slug) ? "unknown" : "invalid"}
          />
        </fieldset>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id={`${id}-rights`}
          checked={agreed}
          disabled={busy}
          onCheckedChange={(value) => setAgreed(value === true)}
        />
        <label htmlFor={`${id}-rights`} className="text-sm">
          I confirm I can adapt this source and will keep the applicable incoming licenses and
          attribution for this draft.
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {message(error)}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !valid}>
        {busy
          ? "Creating draft…"
          : kind === "sequel"
            ? "Create sequel draft"
            : "Create remix draft"}
      </Button>
    </form>
  );
}

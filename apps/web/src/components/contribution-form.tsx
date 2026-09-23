/**
 * 提交 Contribution：在作品最新 Release 的内容上修改，然后把修改变成变更列表发给作者。
 *
 * 可以修改文本 fragment（改写、新增、删除）以及评级和标签。改评级是敏感变更，作者必须
 * 单独确认，这里会提前说明。贡献内容的授权方式随作品的许可而定：作品是开放许可时，
 * 贡献按同一许可授权；作品使用自定义许可（包括保留所有权利）时，贡献者必须显式授权。
 */
import { type Fragment, type FragmentKind, RATINGS, type Rating } from "@char-pub/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/lib/api";
import {
  buildChanges,
  type ContributionEdit,
  contributionBase,
  needsExplicitGrant,
} from "@/lib/contribution";
import { newFragment, nextId } from "@/lib/draft";
import { keys, useRegistry } from "@/lib/registry";
import { RATING_LABEL } from "./rating";

const selectClass =
  "h-9 rounded-sm border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-seal";

const DEFAULT_KIND: Record<string, FragmentKind> = {
  character: "character",
  world: "world",
  lorebook: "knowledge",
};

const SUBMIT_ERRORS: Record<string, string> = {
  rate_limited: "You have submitted a lot recently. Try again later.",
  "contribution.closed": "This creation is not accepting contributions.",
  "contribution.not_invited": "Only invited users can contribute to this creation.",
  "contribution.rights_ack_required": "This creation needs an explicit grant of rights.",
  "guest.unverified": "Verify your email as a guest first.",
  "feature.disabled": "Contributions are paused at the moment.",
};

function FragmentEditor({
  fragment,
  original,
  onChange,
  onRemove,
}: {
  fragment: Fragment;
  original: Fragment | undefined;
  onChange: (f: Fragment) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const text = fragment.content.type === "text" ? fragment.content.text : null;
  const changed =
    !original || JSON.stringify(original.content) !== JSON.stringify(fragment.content);
  return (
    <li className="space-y-2 py-3" data-fragment={fragment.id}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="font-mono text-xs text-muted-foreground">
          #{fragment.id} · {fragment.kind}
        </label>
        {!original ? <span className="stamp border-moss text-moss">new</span> : null}
        {original && changed ? <span className="stamp border-seal text-seal">edited</span> : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          aria-label={`Remove #${fragment.id}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {text !== null ? (
        <Textarea
          id={id}
          value={text}
          onChange={(e) =>
            onChange({ ...fragment, content: { type: "text", text: e.target.value } })
          }
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {fragment.content.type} content can't be edited here.
        </p>
      )}
    </li>
  );
}

export function ContributionForm({
  ns,
  name,
  label,
  type,
  onSubmitted,
}: {
  ns: string;
  name: string;
  /** 在这个 Release 的内容上修改。 */
  label: string;
  type: string;
  onSubmitted?: (number: number) => void;
}) {
  const client = useRegistry();
  const navigate = useNavigate();
  const ids = {
    title: useId(),
    description: useId(),
    rating: useId(),
    tags: useId(),
    rights: useId(),
    agent: useId(),
  };
  const source = useQuery({
    queryKey: keys.source(ns, name, label),
    queryFn: () => client.releaseSource(ns, name, label),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const base = useMemo(() => {
    if (!source.data) return null;
    try {
      return contributionBase(source.data.creation);
    } catch {
      return null;
    }
  }, [source.data]);

  const [edit, setEdit] = useState<ContributionEdit | null>(null);
  const [tagsText, setTagsText] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rightsOk, setRightsOk] = useState(false);
  const [agent, setAgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (base && !edit) {
      setEdit(base.edit);
      setTagsText(base.edit.tags.join(", "));
    }
  }, [base, edit]);

  if (source.isPending) return <p className="text-muted-foreground">Loading the latest release…</p>;
  if (source.isError || !base || !edit) {
    return (
      <p role="alert" className="text-seal">
        The content of this release could not be loaded, so there is nothing to edit yet.
      </p>
    );
  }

  const tags = tagsText
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const current: ContributionEdit = { ...edit, tags };
  const changes = buildChanges(base.canonical, current);
  const license = base.canonical.creation.meta.license;
  const explicit = needsExplicitGrant(license);
  const ratingChanged = current.rating !== base.edit.rating;
  const originals = new Map(base.edit.fragments.map((f) => [f.id, f]));

  const submit = async () => {
    if (!source.data) return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.submitContribution(ns, name, {
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        base_revision: source.data.revision,
        changes,
        rights_ack: explicit ? { explicit_grant: true } : { inbound_equals_outbound: true },
        ...(agent ? { agent: true } : {}),
      });
      if (onSubmitted) onSubmitted(res.number);
      else {
        await navigate({
          to: "/c/$ns/$name/contributions/$number",
          params: { ns, name, number: String(res.number) },
        });
      }
    } catch (e) {
      setError(
        (isApiError(e) && SUBMIT_ERRORS[e.code]) ||
          (isApiError(e) && e.code.startsWith("contribution.")
            ? `The changes were not accepted by the registry (${e.code}).`
            : "The contribution could not be submitted. Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const setFragment = (i: number, f: Fragment) =>
    setEdit({ ...edit, fragments: edit.fragments.map((x, j) => (j === i ? f : x)) });

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        You are editing version <span className="font-mono">{label}</span>. The author sees your
        changes next to their current draft and decides what to take.
      </p>

      <section aria-labelledby="cf-text" className="space-y-2">
        <h2 id="cf-text" className="text-2xl">
          Text
        </h2>
        <ul className="divide-y divide-rule border-y border-rule">
          {edit.fragments.map((f, i) => (
            <FragmentEditor
              key={f.id}
              fragment={f}
              original={originals.get(f.id)}
              onChange={(next) => setFragment(i, next)}
              onRemove={() =>
                setEdit({ ...edit, fragments: edit.fragments.filter((_, j) => j !== i) })
              }
            />
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setEdit({
              ...edit,
              fragments: [
                ...edit.fragments,
                newFragment(
                  nextId(
                    edit.fragments.map((f) => f.id),
                    "contrib",
                  ),
                  DEFAULT_KIND[type] ?? "character",
                ),
              ],
            })
          }
        >
          <Plus aria-hidden /> Add a passage
        </Button>
      </section>

      <section aria-labelledby="cf-meta" className="grid gap-4 sm:grid-cols-2">
        <h2 id="cf-meta" className="text-2xl sm:col-span-2">
          Rating and tags
        </h2>
        <div className="space-y-1">
          <label htmlFor={ids.rating} className="block text-sm">
            Rating
          </label>
          <select
            id={ids.rating}
            className={selectClass}
            value={edit.rating}
            onChange={(e) => setEdit({ ...edit, rating: e.target.value as Rating })}
          >
            {RATINGS.map((r) => (
              <option key={r} value={r}>
                {RATING_LABEL[r]}
              </option>
            ))}
          </select>
          {ratingChanged ? (
            <p className="flex items-start gap-1 text-xs text-muted-foreground">
              <ShieldAlert aria-hidden className="mt-0.5 size-3 shrink-0" />A rating change is
              sensitive: the author has to confirm it separately.
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.tags} className="block text-sm">
            Tags
          </label>
          <Input id={ids.tags} value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
          <p className="text-xs text-muted-foreground">Separate tags with commas.</p>
        </div>
      </section>

      <section aria-labelledby="cf-about" className="space-y-4">
        <h2 id="cf-about" className="text-2xl">
          About this contribution
        </h2>
        <div className="space-y-1">
          <label htmlFor={ids.title} className="block text-sm">
            Title
          </label>
          <Input
            id={ids.title}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.description} className="block text-sm">
            Description (optional)
          </label>
          <Textarea
            id={ids.description}
            value={description}
            maxLength={20000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <label htmlFor={ids.rights} className="flex items-start gap-2 text-sm">
          <input
            id={ids.rights}
            type="checkbox"
            className="mt-1"
            checked={rightsOk}
            onChange={(e) => setRightsOk(e.target.checked)}
          />
          <span>
            {explicit
              ? `This creation uses a custom license (${license}). I grant the author the right to use, change and publish my contribution as part of it.`
              : `I license my contribution under ${license}, the same license as this creation.`}
          </span>
        </label>
        <label htmlFor={ids.agent} className="flex items-start gap-2 text-sm">
          <input
            id={ids.agent}
            type="checkbox"
            className="mt-1"
            checked={agent}
            onChange={(e) => setAgent(e.target.checked)}
          />
          <span>This contribution was written by an AI agent.</span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || changes.length === 0 || !title.trim() || !rightsOk}>
          Submit the contribution
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {changes.length === 0
            ? "No changes yet."
            : changes.length === 1
              ? "1 change"
              : `${changes.length} changes`}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-seal">
          {error}
        </p>
      ) : null}
    </form>
  );
}

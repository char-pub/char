/**
 * 提交 Contribution 的表单：在作品最新 Release 的内容上修改，然后把修改变成变更列表发给作者。
 *
 * 可以修改文本段落（改写、新增、删除）以及评级和标签。改评级是敏感变更，作者必须单独确认，
 * 这里会提前说明。贡献内容的授权方式随作品的许可而定：作品是开放许可时，贡献按同一许可
 * 授权；作品使用自定义许可（包括保留所有权利）时，贡献者必须显式授权。
 */
import { type Fragment, type FragmentKind, RATINGS, type Rating } from "@char-pub/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch, Plus, Send, ShieldAlert, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { ListSkeleton } from "@/components/skeletons";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
import { cn } from "@/lib/utils";
import { RATING_LABEL } from "./rating";

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
  "feature.read_only": "char.pub is read-only for maintenance. Try again later.",
};

function FragmentCard({
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
    <li
      data-fragment={fragment.id}
      className={cn("space-y-2 rounded-lg border bg-surface p-4", changed && "border-blue/70")}
    >
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="min-w-0 font-mono text-sm font-medium break-all">
          #{fragment.id}
          <span className="text-text-3"> · {fragment.kind}</span>
        </label>
        {!original ? <Badge variant="success">New</Badge> : null}
        {original && changed ? <Badge variant="blue">Edited</Badge> : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-text-3 hover:text-danger"
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
        <p className="text-sm text-text-3">{fragment.content.type} content can't be edited here.</p>
      )}
    </li>
  );
}

/** 标签输入：回车或逗号添加，退格删掉最后一个，每个标签可以单独移除。 */
function TagInput({
  id,
  tags,
  onChange,
}: {
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const next = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && !tags.includes(t));
    if (next.length > 0) onChange([...tags, ...next]);
    setText("");
  };
  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-surface px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-sm bg-surface-2 py-0.5 pr-1 pl-2 text-xs font-medium text-text-2"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            className="rounded-sm text-text-3 hover:text-text focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            onClick={() => onChange(tags.filter((x) => x !== t))}
          >
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        placeholder={tags.length === 0 ? "Add a tag" : "Add another"}
        className="min-w-24 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-3 md:text-sm"
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(",")) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && text === "" && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => add(text)}
      />
    </div>
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rightsOk, setRightsOk] = useState(false);
  const [agent, setAgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (base && !edit) setEdit(base.edit);
  }, [base, edit]);

  if (source.isPending) return <ListSkeleton rows={3} label="Loading the latest release…" />;
  if (source.isError || !base || !edit) {
    return (
      <ErrorState
        title="The content of this release could not be loaded"
        description="There is nothing to edit yet. Try again in a moment."
        error={source.error}
        onRetry={() => void source.refetch()}
      />
    );
  }

  const changes = buildChanges(base.canonical, edit);
  const license = base.canonical.creation.meta.license;
  const explicit = needsExplicitGrant(license);
  const ratingChanged = edit.rating !== base.edit.rating;
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
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="flex items-start gap-2 rounded-lg bg-blue-soft px-4 py-3 text-sm text-blue-text">
        <GitBranch aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          You're editing the latest public version, <span className="font-mono">v{label}</span>. The
          author will see your changes against their current draft.
        </span>
      </p>

      <section aria-labelledby="cf-text" className="space-y-3">
        <h3 id="cf-text" className="text-base font-semibold">
          Passages
        </h3>
        <ul className="space-y-3">
          {edit.fragments.map((f, i) => (
            <FragmentCard
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
          variant="link"
          size="sm"
          className="px-0"
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

      <section
        aria-labelledby="cf-meta"
        className="grid gap-4 rounded-lg border bg-surface p-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
      >
        <h3 id="cf-meta" className="sr-only">
          Rating and tags
        </h3>
        <div className="space-y-1.5">
          <label htmlFor={ids.rating} className="block text-sm font-semibold">
            Rating
          </label>
          <NativeSelect
            id={ids.rating}
            value={edit.rating}
            onChange={(e) => setEdit({ ...edit, rating: e.target.value as Rating })}
          >
            {RATINGS.map((r) => (
              <option key={r} value={r}>
                {RATING_LABEL[r]}
                {r === base.edit.rating ? " (unchanged)" : ""}
              </option>
            ))}
          </NativeSelect>
          {ratingChanged ? (
            <p className="flex items-start gap-1 text-xs text-warning">
              <ShieldAlert aria-hidden className="mt-0.5 size-3 shrink-0" />A rating change is
              sensitive: the author has to confirm it separately.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.tags} className="block text-sm font-semibold">
            Tags
          </label>
          <TagInput
            id={ids.tags}
            tags={edit.tags}
            onChange={(tags) => setEdit({ ...edit, tags })}
          />
        </div>
      </section>

      <section aria-labelledby="cf-about" className="space-y-4 rounded-lg border bg-surface p-5">
        <h3 id="cf-about" className="text-base font-semibold">
          About this change
        </h3>
        <div className="space-y-1.5">
          <label htmlFor={ids.title} className="block text-sm font-semibold">
            Title
          </label>
          <Input
            id={ids.title}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.description} className="block text-sm font-semibold">
            Description <span className="font-normal text-text-3">(optional)</span>
          </label>
          <Textarea
            id={ids.description}
            value={description}
            maxLength={20000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={ids.rights}
            className="mt-0.5"
            checked={rightsOk}
            onCheckedChange={(v) => setRightsOk(v === true)}
          />
          <label htmlFor={ids.rights} className="text-sm">
            {explicit
              ? `This creation uses a custom license (${license}). I grant the author the right to use, change and publish my contribution as part of it.`
              : `I license my contribution under ${license}, the same license as this creation.`}
          </label>
        </div>
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={ids.agent}
            className="mt-0.5"
            checked={agent}
            onCheckedChange={(v) => setAgent(v === true)}
          />
          <label htmlFor={ids.agent} className="text-sm">
            An AI agent wrote this change
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" disabled={busy || changes.length === 0 || !title.trim() || !rightsOk}>
          <Send aria-hidden />
          {changes.length === 0
            ? "Submit"
            : `Submit ${changes.length === 1 ? "1 change" : `${changes.length} changes`}`}
        </Button>
        <span className="text-sm text-text-3" aria-live="polite">
          {changes.length === 0
            ? "No changes yet."
            : "You can withdraw it until the author decides."}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** The author chooses a service; this panel only exchanges local JSON and applies reviewed content. */

import { MAX_SOURCE_BYTES } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Me } from "@/lib/api";
import {
  ASSISTANCE_TASKS,
  type AssistanceRequest,
  type AssistanceReview,
  type AssistanceTask,
  applyAssistanceReview,
  assistanceTargets,
  assistanceWorkingDigest,
  createAssistanceRequest,
  MAX_ASSISTANCE_BYTES,
  reviewAssistanceCandidate,
  undoAssistanceReview,
} from "@/lib/author-assistance";
import type { Working } from "@/lib/draft";
import { keys, useMe } from "@/lib/registry";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { NativeSelect } from "../ui/native-select";
import { Textarea } from "../ui/textarea";

const TASK_NAMES = {
  description: "Describe an object",
  sections: "Describe document sections",
  condition: "Turn a sentence into a rule",
  perspective: "Split public appearance and inner setting",
  play: "Draft a scene, change or ending",
};
const show = (value: unknown) =>
  value === undefined
    ? "Not set"
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
export function AuthorAssistance(props: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  blockedReason?: string | undefined;
}) {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading author assistance…</p>;
  if (me.isError && me.data === undefined)
    return (
      <p role="status">
        Could not check your account for author assistance.{" "}
        <Button type="button" variant="outline" onClick={() => void me.refetch()}>
          Retry author assistance
        </Button>
      </p>
    );
  return (
    <AssistanceSession
      key={`${me.data?.id ?? "anonymous"}:${String(props.working.id)}`}
      {...props}
      actor={me.data?.id}
    />
  );
}
function AssistanceSession({
  working,
  update,
  blockedReason,
  actor,
}: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  blockedReason?: string | undefined;
  actor: string | undefined;
}) {
  const qc = useQueryClient();
  const live = useRef(true),
    operation = useRef(0),
    latest = useRef({ working, blockedReason });
  latest.current = { working, blockedReason };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      operation.current++;
    };
  }, []);
  const current = () =>
    live.current && !!actor && qc.getQueryData<Me | null>(keys.me)?.id === actor;
  const [task, setTask] = useState<AssistanceTask>("description"),
    [target, setTarget] = useState("");
  const [newKind, setNewKind] = useState<"scene" | "beat" | "ending">("scene"),
    [newId, setNewId] = useState("");
  const [instructions, setInstructions] = useState(""),
    [context, setContext] = useState("");
  const [outwardId, setOutwardId] = useState(""),
    [scene, setScene] = useState("");
  const [outwardScope, setOutwardScope] = useState<"preserve" | "shared">("preserve");
  const [source, setSource] = useState<{ bytes: Uint8Array; name: string; digest: string }>();
  const [request, setRequest] = useState<AssistanceRequest>(),
    [buffer, setBuffer] = useState("");
  const requestJson = useMemo(() => (request ? JSON.stringify(request, null, 2) : ""), [request]);
  const inputJson = useMemo(
    () => (request ? JSON.stringify(request.input, null, 2) : ""),
    [request],
  );
  const requestBytes = useMemo(() => new TextEncoder().encode(requestJson).length, [requestJson]);
  const [review, setReview] = useState<AssistanceReview>(),
    [undo, setUndo] = useState<AssistanceReview>();
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reading, setReading] = useState(false);
  const prefix = useId();
  const targets = assistanceTargets(working, task);
  let workingDigest = "";
  try {
    workingDigest = assistanceWorkingDigest(working);
  } catch {
    /* Display when preparing the request. */
  }
  const stale = !!request && request.working_digest !== workingDigest;
  const disable = blockedReason ?? (!actor ? "Sign in to use author assistance." : undefined);
  const reset = () => {
    operation.current++;
    setRequest(undefined);
    setReview(undefined);
    setSource(undefined);
    setReading(false);
    setError("");
    setNotice("");
  };
  const selection = () => {
    const chosen =
      task === "play"
        ? { kind: newKind, id: newId }
        : targets.find((item) => `${item.kind}:${item.id}` === target);
    if (!chosen) throw new Error("Choose the object you want help with.");
    return {
      kind: task,
      target: chosen,
      instructions,
      context,
      ...(task === "perspective" && outwardId ? { outward_id: outwardId } : {}),
      ...(task === "perspective" ? { outward_scope: outwardScope } : {}),
      ...(task === "play" && newKind === "beat" ? { scene } : {}),
    };
  };
  const prepare = () => {
    if (!current() || latest.current.blockedReason) return;
    try {
      if (source && source.digest !== assistanceWorkingDigest(latest.current.working))
        throw new Error(
          "The draft changed after choosing this document. Select the original file again.",
        );
      const next = createAssistanceRequest(latest.current.working, selection(), source?.bytes);
      setRequest(next);
      setReview(undefined);
      setError("");
      setNotice(
        "Review everything below before downloading it for your chosen service. No content has been sent.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const readFile = async (file: File | undefined, document: boolean) => {
    if (!file || !current() || latest.current.blockedReason) return;
    const attempt = ++operation.current,
      digest = assistanceWorkingDigest(latest.current.working);
    setReading(true);
    setError("");
    try {
      const limit = document ? MAX_SOURCE_BYTES : MAX_ASSISTANCE_BYTES;
      if (file.size > limit) throw new Error(`Choose a file no larger than ${limit} bytes.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > limit) throw new Error(`The file exceeds ${limit} bytes.`);
      if (!current() || operation.current !== attempt) return;
      if (
        latest.current.blockedReason ||
        assistanceWorkingDigest(latest.current.working) !== digest
      )
        throw new Error("The draft changed while reading the file. Select it again.");
      if (document) setSource({ bytes, name: file.name, digest });
      else {
        setBuffer(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        setReview(undefined);
        setNotice("Candidate loaded locally. Review it before applying.");
      }
    } catch (cause) {
      if (current() && operation.current === attempt)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current() && operation.current === attempt) setReading(false);
    }
  };
  const reviewCandidate = () => {
    if (!current() || latest.current.blockedReason || !request) return;
    try {
      setReview(reviewAssistanceCandidate(latest.current.working, request, buffer));
      setError("");
      setNotice("Review the full changes and remaining diagnostics. The draft has not changed.");
    } catch (cause) {
      setReview(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const apply = () => {
    if (!current() || latest.current.blockedReason || !review) return;
    try {
      applyAssistanceReview(latest.current.working, review);
      let applied = false;
      update((w) => {
        if (!current() || latest.current.blockedReason) return w;
        const next = applyAssistanceReview(w, review);
        applied = true;
        return next;
      });
      if (!applied)
        throw new Error(
          "The editor did not apply this candidate. Resolve its save or access state and review again.",
        );
      setUndo(review);
      setReview(undefined);
      setError("");
      setNotice(
        "Applied to this draft. Agent-assisted history is kept. Normal draft saving and checks still apply.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <details className="space-y-4 rounded-xl border bg-surface p-5">
      <summary className="cursor-pointer text-lg font-semibold">
        Draft with your chosen AI service
      </summary>
      <p className="text-sm text-text-2">
        Choose one object and the information to share. Download a task for a service you choose,
        then bring its JSON result back for review. This page does not call a model or store model
        credentials.
      </p>
      {disable ? <p role="status">{disable}</p> : null}
      <Label htmlFor={`${prefix}-task`}>Drafting task</Label>
      <NativeSelect
        id={`${prefix}-task`}
        value={task}
        onChange={(e) => {
          setTask(e.target.value as AssistanceTask);
          setTarget("");
          reset();
        }}
      >
        {ASSISTANCE_TASKS.map((kind) => (
          <option key={kind} value={kind}>
            {TASK_NAMES[kind]}
          </option>
        ))}
      </NativeSelect>
      {task === "play" ? (
        <>
          <Label htmlFor={`${prefix}-kind`}>New story object</Label>
          <NativeSelect
            id={`${prefix}-kind`}
            value={newKind}
            onChange={(e) => {
              setNewKind(e.target.value as typeof newKind);
              reset();
            }}
          >
            <option value="scene">Scene</option>
            <option value="beat">Change (Beat)</option>
            <option value="ending">Ending</option>
          </NativeSelect>
          <Label htmlFor={`${prefix}-new-id`}>New object ID</Label>
          <Input
            id={`${prefix}-new-id`}
            value={newId}
            onChange={(e) => {
              setNewId(e.target.value);
              reset();
            }}
          />
          {newKind === "beat" ? (
            <>
              <Label htmlFor={`${prefix}-scene`}>Scene for this change</Label>
              <NativeSelect
                id={`${prefix}-scene`}
                value={scene}
                onChange={(e) => {
                  setScene(e.target.value);
                  reset();
                }}
              >
                <option value="">Choose a scene</option>
                {assistanceTargets(working, "condition")
                  .filter((entry) => entry.kind === "scene")
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.id}
                    </option>
                  ))}
              </NativeSelect>
            </>
          ) : null}
          <p className="text-xs">
            Provide an author-edited plot summary below. Do not paste a raw Session or chat log. An
            ending can use an explicit scene condition; it is not automatically linked to every
            scene.
          </p>
        </>
      ) : (
        <>
          <Label htmlFor={`${prefix}-target`}>Object to draft</Label>
          <NativeSelect
            id={`${prefix}-target`}
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              reset();
            }}
          >
            <option value="">Choose an object</option>
            {targets.map((item) => (
              <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
                {item.kind} · {item.id}
              </option>
            ))}
          </NativeSelect>
          {!targets.length ? (
            <p>No supported objects yet. Add an object in the editor first.</p>
          ) : null}
        </>
      )}
      {task === "perspective" ? (
        <>
          <Label htmlFor={`${prefix}-outward`}>New outward passage ID (optional)</Label>
          <Input
            id={`${prefix}-outward`}
            value={outwardId}
            onChange={(e) => {
              setOutwardId(e.target.value);
              reset();
            }}
          />
          <p className="text-xs">
            The original passage keeps its ID and translations as inner setting. The new outward
            text keeps the original audience restrictions unless you explicitly share it below.
          </p>
          <Label htmlFor={`${prefix}-outward-scope`}>Audience for the new outward text</Label>
          <NativeSelect
            id={`${prefix}-outward-scope`}
            value={outwardScope}
            onChange={(e) => {
              setOutwardScope(e.target.value as typeof outwardScope);
              reset();
            }}
          >
            <option value="preserve">Keep the original audience and scene restrictions</option>
            <option value="shared">Allow other characters to see it across scenes</option>
          </NativeSelect>
        </>
      ) : null}
      <Label htmlFor={`${prefix}-instructions`}>What should the service draft?</Label>
      <Textarea
        id={`${prefix}-instructions`}
        value={instructions}
        onChange={(e) => {
          setInstructions(e.target.value);
          reset();
        }}
      />
      <Label htmlFor={`${prefix}-context`}>Selected context, sentence or plot summary</Label>
      <Textarea
        id={`${prefix}-context`}
        value={context}
        onChange={(e) => {
          setContext(e.target.value);
          reset();
        }}
      />
      {task === "sections" ? (
        <>
          <Label htmlFor={`${prefix}-document`}>Original uploaded document for this source</Label>
          <Input
            id={`${prefix}-document`}
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            onChange={(e) => {
              void readFile(e.target.files?.[0], true);
              e.target.value = "";
            }}
          />
          {source ? (
            <p>
              Selected local document: {source.name}. Its bytes will be checked against this
              source's asset.
            </p>
          ) : null}
        </>
      ) : null}
      <Button type="button" disabled={!!disable || reading} onClick={prepare}>
        Prepare request for review
      </Button>
      {request ? (
        <section aria-label="Assistance request" className="space-y-3 rounded border p-3">
          <h3 className="font-semibold">Exactly what you will share</h3>
          <p>
            Only this chosen input is included. Other draft content is represented by a digest.
            Inspect private setting text before downloading.
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
            {inputJson}
          </pre>
          <Label htmlFor={`${prefix}-request`}>Complete request JSON</Label>
          <Textarea id={`${prefix}-request`} value={requestJson} readOnly rows={8} />
          <p className="text-xs">
            Request JSON: {requestBytes.toLocaleString()} bytes. Candidate files can be at most 1
            MiB. Source input is never truncated.
          </p>
          {stale ? (
            <p role="alert">
              The draft changed. Prepare a new request before importing or applying a candidate.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={!!disable || stale}
            onClick={() => {
              if (
                !current() ||
                latest.current.blockedReason ||
                assistanceWorkingDigest(latest.current.working) !== request.working_digest
              )
                return;
              const url = URL.createObjectURL(
                new Blob([requestJson], { type: "application/json" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "char-pub-author-assistance.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download reviewed input
          </Button>
          <Label htmlFor={`${prefix}-candidate-file`}>Candidate JSON file</Label>
          <Input
            id={`${prefix}-candidate-file`}
            type="file"
            accept=".json,application/json"
            disabled={!!disable || stale}
            onChange={(e) => {
              void readFile(e.target.files?.[0], false);
              e.target.value = "";
            }}
          />
          <Label htmlFor={`${prefix}-candidate`}>Candidate JSON to review</Label>
          <Textarea
            id={`${prefix}-candidate`}
            rows={10}
            value={buffer}
            onChange={(e) => {
              operation.current++;
              setReading(false);
              setBuffer(e.target.value);
              setReview(undefined);
            }}
          />
          <Button
            type="button"
            disabled={!!disable || stale || !buffer || reading}
            onClick={reviewCandidate}
          >
            Review candidate changes
          </Button>
        </section>
      ) : null}
      {review ? (
        <section aria-label="Assistance candidate review" className="space-y-3 rounded border p-3">
          <h3 className="font-semibold">Candidate changes</h3>
          {(["body", "description", "structure"] as const).map((category) => (
            <div key={category}>
              <h4 className="font-medium">
                {category === "body"
                  ? "Body content"
                  : category === "description"
                    ? "Descriptions"
                    : "Structure"}
              </h4>
              {review.differences
                .filter((entry) => entry.category === category)
                .map((entry, index) => (
                  <div
                    key={`${entry.path.join(":")}:${index}`}
                    className="grid gap-2 border-t py-2 sm:grid-cols-2"
                  >
                    <p className="sm:col-span-2">
                      {entry.object} · {entry.field}
                    </p>
                    <div>
                      <p>Before</p>
                      <pre className="whitespace-pre-wrap break-words text-xs">
                        {show(entry.before)}
                      </pre>
                    </div>
                    <div>
                      <p>After</p>
                      <pre className="whitespace-pre-wrap break-words text-xs">
                        {show(entry.after)}
                      </pre>
                    </div>
                  </div>
                ))}
            </div>
          ))}
          <h4 className="font-medium">Draft checks after applying</h4>
          {review.diagnostics.length ? (
            <ul>
              {review.diagnostics.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          ) : (
            <p>
              No static draft errors found. A full build still checks dependencies and uploaded
              documents.
            </p>
          )}
          <p className="text-sm">
            Only Apply changes the draft. Existing unfinished fields may still prevent saving. The
            candidate's claims of approval are never accepted.
          </p>
          <Button type="button" disabled={!!disable || stale} onClick={apply}>
            Apply reviewed candidate
          </Button>
        </section>
      ) : null}
      {undo ? (
        <Button
          type="button"
          variant="outline"
          disabled={!!disable}
          onClick={() => {
            if (!current() || latest.current.blockedReason) return;
            try {
              undoAssistanceReview(latest.current.working, undo);
              let restored = false;
              update((w) => {
                if (!current() || latest.current.blockedReason) return w;
                const next = undoAssistanceReview(w, undo);
                restored = true;
                return next;
              });
              if (!restored)
                throw new Error(
                  "The editor did not undo these changes. Resolve its save or access state and try again.",
                );
              setUndo(undefined);
              setError("");
              setNotice(
                "Undid the assisted changes. Later unrelated edits and agent-assisted history are kept.",
              );
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          Undo assisted changes
        </Button>
      ) : null}
      {reading ? <p role="status">Reading local file…</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </details>
  );
}

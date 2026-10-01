import type { ContentArtifact } from "@char-pub/assembler";
import type { Me, RuntimeLaunchRequest } from "@char-pub/contracts";
import { buildIdentityKey } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { API_BASE_URL } from "@/lib/api";
import { keys, useMe } from "@/lib/registry";
import {
  runtimeLaunchDestination,
  runtimeLaunchRequest,
  runtimeLaunchUrl,
} from "@/lib/runtime-launch";
import { localized } from "@/lib/text";
import { allowsMature } from "./creation-context";
import { MatureGate } from "./mature-gate";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";

interface Props {
  artifact: ContentArtifact;
  label?: string;
  disabledReason?: string | undefined;
  isCurrent?: (() => boolean) | undefined;
  initiallyOpen?: boolean | undefined;
}

/** This opens a separately authorized Runtime; it neither creates a session nor calls a model. */
export function RuntimeLaunch(props: Props) {
  const me = useMe();
  return (
    <RuntimeLaunchSession
      key={`${me.data?.id ?? "guest"}:${buildIdentityKey(props.artifact.root)}:${props.artifact.lock_digest}`}
      {...props}
    />
  );
}

function remembered(key: string): string[] {
  try {
    const values: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(values)) return [];
    return values
      .filter((value): value is string => {
        if (typeof value !== "string") return false;
        try {
          return runtimeLaunchDestination(value) === value;
        } catch {
          return false;
        }
      })
      .slice(0, 5);
  } catch {
    return [];
  }
}

function RuntimeLaunchSession({
  artifact,
  label = "Start playing",
  disabledReason,
  isCurrent,
  initiallyOpen = false,
}: Props) {
  const me = useMe();
  const queryClient = useQueryClient();
  const actor = me.data?.id ?? null;
  const storageKey = `charpub.runtime-destinations.v1:${actor ?? "guest"}`;
  const [destinations, setDestinations] = useState(() => remembered(storageKey));
  const [destination, setDestination] = useState(destinations[0] ?? "");
  const [open, setOpen] = useState(initiallyOpen);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [locale, setLocale] = useState(artifact.ir.meta.default_locale);
  const [start, setStart] = useState(
    artifact.story?.starts?.length === 1 ? (artifact.story.starts[0]?.id ?? "") : "",
  );
  const [mode, setMode] = useState<RuntimeLaunchRequest["view"]["mode"]>(
    artifact.assembly?.profile.mode ?? "narrator",
  );
  const [participant, setParticipant] = useState("");
  const mounted = useRef(true);
  const latest = useRef({ artifact, disabledReason, isCurrent });
  latest.current = { artifact, disabledReason, isCurrent };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const id = useId();
  const starts = artifact.story?.starts ?? [];
  const launch = () => {
    setError("");
    setNotice("");
    try {
      if (
        !mounted.current ||
        me.isPending ||
        (queryClient.getQueryData<Me | null>(keys.me)?.id ?? null) !== actor ||
        latest.current.artifact !== artifact ||
        latest.current.disabledReason ||
        latest.current.isCurrent?.() === false
      )
        throw new Error("The account or work changed. Reopen this build before continuing.");
      const view: RuntimeLaunchRequest["view"] =
        mode === "narrator" ? { mode } : { mode, for_participant: participant };
      const request = runtimeLaunchRequest(artifact, {
        registryOrigin: new URL(API_BASE_URL || window.location.origin).origin,
        locale,
        ...(start ? { start } : {}),
        view,
      });
      const target = runtimeLaunchDestination(destination);
      // noopener and noreferrer prevent the external Runtime from controlling or identifying this page.
      window.open(runtimeLaunchUrl(target, request), "_blank", "noopener,noreferrer");
      const next = [target, ...destinations.filter((url) => url !== target)].slice(0, 5);
      setDestinations(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Opening still works when browser storage is unavailable. */
      }
      setNotice(
        "Continue in your Runtime to authorize access and start a new session. If no tab opened, allow pop-ups and try again.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open this Runtime.");
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setError("");
        setNotice("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={me.isPending || !!disabledReason}
          title={disabledReason}
        >
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Open in a Runtime</DialogTitle>
          <DialogDescription>
            Choose where to play this exact version. Your Runtime handles sign-in, model settings
            and the session.
          </DialogDescription>
        </DialogHeader>
        <MatureGate
          identity={actor ?? undefined}
          rating={artifact.meta.rating}
          allowed={allowsMature(me.data)}
          signedIn={!!me.data}
        >
          <div className="space-y-4">
            <p className="text-sm">
              {artifact.root.ref} · {buildIdentityKey(artifact.root)}
            </p>
            <Label className="block space-y-1">
              Runtime launch URL
              <Input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="http://127.0.0.1:19389/"
                list={`${id}-destinations`}
              />
            </Label>
            <datalist id={`${id}-destinations`}>
              {destinations.map((url) => (
                <option key={url} value={url} />
              ))}
            </datalist>
            <p className="text-xs text-text-2">
              Use the launch URL shown by your running Runtime. For local Harness, start its
              roleplay app profile first. This URL is separate from its OAuth callback.
            </p>
            {starts.length > 0 ? (
              <Label className="block space-y-1">
                Opening
                <NativeSelect value={start} onChange={(event) => setStart(event.target.value)}>
                  <option value="">Choose an opening</option>
                  {starts.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {localized(entry.title, locale)}
                    </option>
                  ))}
                </NativeSelect>
              </Label>
            ) : null}
            <Label className="block space-y-1">
              View
              <NativeSelect
                value={mode}
                disabled={!!artifact.assembly}
                onChange={(event) =>
                  setMode(event.target.value as RuntimeLaunchRequest["view"]["mode"])
                }
              >
                <option value="narrator">Narrator</option>
                <option value="per-agent">Individual character</option>
              </NativeSelect>
            </Label>
            {artifact.assembly ? (
              <p className="text-xs text-text-2">
                The author fixed this view in the work's assembly settings.
              </p>
            ) : null}
            {mode === "per-agent" ? (
              <Label className="block space-y-1">
                Speaking participant
                <NativeSelect
                  value={participant}
                  onChange={(event) => setParticipant(event.target.value)}
                >
                  <option value="">Choose a participant</option>
                  {artifact.ir.participants
                    .filter((entry) => entry.key !== "user")
                    .map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {localized(entry.display_name, locale)}
                        {entry.cast_key ? ` · ${entry.cast_key}` : ""}
                      </option>
                    ))}
                </NativeSelect>
              </Label>
            ) : null}
            <Label className="block space-y-1">
              Language
              <NativeSelect value={locale} onChange={(event) => setLocale(event.target.value)}>
                {[
                  ...new Set([
                    artifact.ir.meta.default_locale,
                    ...artifact.ir.meta.available_locales,
                  ]),
                ].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <p className="text-xs text-text-2">
              Only the version, opening and view are passed on. Reference documents and private
              content are loaded by the Runtime after it obtains access. Your selected Runtime must
              support this work.
            </p>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="text-sm">
                {notice}
              </p>
            ) : null}
            <Button type="button" onClick={launch} disabled={!!disabledReason}>
              Open Runtime
            </Button>
          </div>
        </MatureGate>
      </DialogContent>
    </Dialog>
  );
}

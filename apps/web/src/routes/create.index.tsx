import { NAME_RE, OPEN_CREATION_TYPES } from "@char-pub/core";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, FileUp, Globe, UserRound } from "lucide-react";
import { useId, useState } from "react";
import { NamespaceSetup } from "@/components/namespace-setup";
import { SignInRequired } from "@/components/sign-in-required";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { useMe, useRegistry } from "@/lib/registry";
import { slugify } from "@/lib/text";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/create/")({ component: Create });

type OpenType = (typeof OPEN_CREATION_TYPES)[number];

const TYPES: Record<OpenType, { label: string; body: string; icon: typeof UserRound }> = {
  character: {
    label: "Character",
    body: "A person with a voice, a look and a first line.",
    icon: UserRound,
  },
  world: {
    label: "World",
    body: "A place, its rules and its history — characters can live in it.",
    icon: Globe,
  },
  lorebook: {
    label: "Lorebook",
    body: "Entries that appear when a keyword comes up in the chat.",
    icon: BookOpen,
  },
};

function Create() {
  const me = useMe();
  const client = useRegistry();
  const navigate = useNavigate();
  const [type, setType] = useState<OpenType>("character");
  const [display, setDisplay] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const ids = { display: useId(), name: useId() };
  const slug = nameTouched ? name : slugify(display);
  const ns = me.data?.namespace;

  const create = useMutation({
    mutationFn: () =>
      client.createCreation(ns ?? "", { name: slug, type, display_name: display.trim() }),
    onSuccess: () => navigate({ to: "/c/$ns/$name/edit", params: { ns: ns ?? "", name: slug } }),
  });

  if (me.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (!me.data) return <SignInRequired what="create" />;

  const error = create.error
    ? isApiError(create.error, "creation.taken")
      ? `@${ns}/${slug} already exists. Choose another address.`
      : "Could not create it. Try again."
    : null;

  return (
    <section className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl">Create</h1>
        <p className="text-muted-foreground">
          Start with a name. Everything else can be filled in step by step; your draft saves itself.
        </p>
      </header>

      {!ns ? (
        <NamespaceSetup suggestion={me.data.name} />
      ) : (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (display.trim() && NAME_RE.test(slug)) create.mutate();
          }}
        >
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm">What are you making?</legend>
            {OPEN_CREATION_TYPES.map((t) => {
              const T = TYPES[t];
              return (
                <label
                  key={t}
                  className={cn(
                    "catalog-card flex cursor-pointer flex-col gap-1 p-4 pl-8",
                    type === t ? "outline-2 outline-seal" : "",
                  )}
                >
                  <input
                    type="radio"
                    name="type"
                    value={t}
                    className="sr-only"
                    checked={type === t}
                    onChange={() => setType(t)}
                  />
                  <T.icon aria-hidden className="size-5 text-seal" />
                  <span className="font-display text-lg">{T.label}</span>
                  <span className="text-xs text-muted-foreground">{T.body}</span>
                </label>
              );
            })}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={ids.display} className="text-sm">
                Name
              </label>
              <Input
                id={ids.display}
                value={display}
                maxLength={200}
                placeholder="e.g. Alice the Courier"
                onChange={(e) => setDisplay(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={ids.name} className="text-sm">
                Address
              </label>
              <div className="flex items-center gap-1 font-mono text-sm">
                <span className="text-muted-foreground">@{ns}/</span>
                <Input
                  id={ids.name}
                  value={slug}
                  maxLength={64}
                  aria-invalid={slug !== "" && !NAME_RE.test(slug)}
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value.toLowerCase());
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={!display.trim() || !NAME_RE.test(slug) || create.isPending}
            >
              Create {TYPES[type].label.toLowerCase()}
            </Button>
            <span className="text-sm text-muted-foreground">or</span>
            <Link to="/create/import" className={buttonVariants({ variant: "outline" })}>
              <FileUp aria-hidden /> Import a character card
            </Link>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-seal">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}

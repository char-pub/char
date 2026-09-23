import { NAME_RE, OPEN_CREATION_TYPES } from "@char-pub/core";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, FileUp, Globe, Plus, UserRound } from "lucide-react";
import { useId, useState } from "react";
import { AddressField, useNameAvailability } from "@/components/address-field";
import { TYPE_STYLE } from "@/components/badges";
import { ChoiceCard } from "@/components/choice-card";
import { NamespaceSetup } from "@/components/namespace-setup";
import { SignInRequired } from "@/components/sign-in-required";
import { PageSkeleton } from "@/components/skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { useMe, useRegistry } from "@/lib/registry";
import { slugify } from "@/lib/text";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/create/")({ component: Create });

type OpenType = (typeof OPEN_CREATION_TYPES)[number];

const TYPES: Record<
  OpenType,
  { body: string; example: string; placeholder: string; icon: typeof UserRound }
> = {
  character: {
    body: "Someone to talk to: a description, a voice and a greeting.",
    example: "e.g. Alice, Captain Vey",
    placeholder: "e.g. Rin",
    icon: UserRound,
  },
  world: {
    body: "A place characters can live in: its setting, rules and factions.",
    example: "e.g. Night City, Hollow Sea",
    placeholder: "e.g. Hollow Sea",
    icon: Globe,
  },
  lorebook: {
    body: "Entries that switch on when a keyword comes up in the chat.",
    example: "e.g. Corps of Night City",
    placeholder: "e.g. Corps of Night City",
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
  const ids = { display: useId(), name: useId(), hint: useId(), type: useId() };
  const slug = nameTouched ? name : slugify(display);
  const ns = me.data?.namespace;
  const availability = useNameAvailability(ns ?? "", slug, !!ns);

  const create = useMutation({
    mutationFn: () =>
      client.createCreation(ns ?? "", { name: slug, type, display_name: display.trim() }),
    onSuccess: () => navigate({ to: "/c/$ns/$name/edit", params: { ns: ns ?? "", name: slug } }),
  });

  if (me.isPending) return <PageSkeleton label="Loading" className="mx-auto max-w-4xl" />;
  if (!me.data) return <SignInRequired what="create" />;

  const error = create.error
    ? isApiError(create.error, "creation.taken")
      ? `@${ns}/${slug} already exists. Choose another address.`
      : "Could not create it. Try again."
    : null;
  const ready = display.trim() !== "" && NAME_RE.test(slug) && availability !== "taken";

  return (
    <section className="mx-auto max-w-4xl space-y-8 md:pt-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Create something new</h1>
        {ns ? (
          <p className="text-text-2">
            Publishing as <span className="font-mono text-text">@{ns}</span>. You can change the
            name at any time; the address stays as it is.
          </p>
        ) : (
          <p className="text-text-2">Every creation lives under your @name.</p>
        )}
      </header>

      {!ns ? (
        <NamespaceSetup suggestion={me.data.name} />
      ) : (
        <form
          className="space-y-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) create.mutate();
          }}
        >
          <fieldset className="space-y-3">
            <legend className="mb-3 text-sm font-semibold">What are you making?</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              {OPEN_CREATION_TYPES.map((t) => {
                const T = TYPES[t];
                const style = TYPE_STYLE[t];
                return (
                  <ChoiceCard
                    key={t}
                    name={ids.type}
                    value={t}
                    checked={type === t}
                    onSelect={() => setType(t)}
                    indicator
                    className="gap-2 p-5"
                    leading={
                      <span
                        aria-hidden
                        className={cn(
                          "mb-2 flex size-10 items-center justify-center rounded-md",
                          style.soft,
                          style.text,
                        )}
                      >
                        <T.icon className="size-5" />
                      </span>
                    }
                    title={<span className="text-lg">{style.label}</span>}
                    description={<span className="text-sm leading-relaxed">{T.body}</span>}
                  >
                    <span className="mt-1 text-xs text-text-3">{T.example}</span>
                  </ChoiceCard>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={ids.display} className="text-sm font-medium">
                Name
              </label>
              <Input
                id={ids.display}
                value={display}
                maxLength={200}
                placeholder={TYPES[type].placeholder}
                onChange={(e) => setDisplay(e.target.value)}
              />
              <p className="text-xs text-text-3">Any language. Shown as the title.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={ids.name} className="text-sm font-medium">
                Address
              </label>
              <AddressField
                id={ids.name}
                hintId={ids.hint}
                ns={ns}
                value={slug}
                availability={availability}
                onChange={(v) => {
                  setNameTouched(true);
                  setName(v);
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" size="lg" disabled={!ready || create.isPending}>
              <Plus aria-hidden /> Create {TYPE_STYLE[type].label.toLowerCase()}
            </Button>
            <span className="text-sm text-text-2">
              Opens the editor. Nothing is public until you publish.
            </span>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </form>
      )}

      <aside
        aria-label="Import a character card"
        className="flex flex-col gap-4 rounded-lg bg-surface-2 p-5 sm:flex-row sm:items-center"
      >
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-surface text-text-2"
        >
          <FileUp className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-semibold">Already have a character card?</p>
          <p className="text-sm text-text-2">
            Import a Character Card V2 or V3 as PNG, JSON or CHARX. You'll see what maps over and
            confirm the rating, rights and license before it can be published.
          </p>
        </div>
        <Link to="/create/import" className={buttonVariants({ variant: "outline" })}>
          <FileUp aria-hidden /> Import a card
        </Link>
      </aside>
    </section>
  );
}

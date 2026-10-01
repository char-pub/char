import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import type { AssistanceRequest } from "@/lib/author-assistance";
import { keys } from "@/lib/registry";
import { assistanceBody, assistanceWorking, candidate } from "@/test/author-assistance";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { AuthorAssistance } from "./author-assistance";

function setup(control = { skip: false }) {
  const changed = vi.fn();
  function Editor() {
    const [working, setWorking] = useState(structuredClone(assistanceWorking));
    const current = useRef(working);
    current.current = working;
    return (
      <>
        <AuthorAssistance
          working={working}
          update={(fn) => {
            if (control.skip) return;
            const next = fn(current.current);
            current.current = next;
            changed(next);
            setWorking(next);
          }}
        />
        <button
          type="button"
          onClick={() => setWorking((w) => ({ ...w, summary: "Later summary" }))}
        >
          Edit something else
        </button>
        <output data-testid="working">{JSON.stringify(working)}</output>
      </>
    );
  }
  const result = renderWithApp(<Editor />, fakeClient({ me: async () => ME }));
  return { ...result, changed };
}
async function start(task: string, target?: string) {
  await userEvent.click(await screen.findByText("Draft with your chosen AI service"));
  await userEvent.selectOptions(screen.getByLabelText("Drafting task"), task);
  if (target) await userEvent.selectOptions(screen.getByLabelText("Object to draft"), target);
  await userEvent.type(
    screen.getByLabelText("What should the service draft?"),
    "Write only the selected object.",
  );
  await userEvent.type(
    screen.getByLabelText("Selected context, sentence or plot summary"),
    "An author-written summary.",
  );
}
function requestFromUI(): AssistanceRequest {
  return JSON.parse((screen.getByLabelText("Complete request JSON") as HTMLTextAreaElement).value);
}
const parsedWorking = () => JSON.parse(screen.getByTestId("working").textContent ?? "{}");

it.each([
  {
    task: "description",
    target: "beat:unfinished",
    output: { description: "The traveler stays." },
  },
  {
    task: "sections",
    target: "source:guide",
    output: {
      sections: [
        { id: "harbor", title: "Harbor", anchor: "#Harbor", description: "A quiet dock." },
      ],
    },
  },
  {
    task: "condition",
    target: "scene:harbor",
    output: { condition: { cmp: ["var/trust", ">=", 2] } },
  },
  {
    task: "perspective",
    target: "fragment:mira",
    output: { outward_text: "A blue coat.", inner_text: "A private fear." },
  },
  { task: "play", output: { object: { id: "next", title: "Next", opening: "A new arrival." } } },
])(
  "requires review and separate Apply for $task, then Undo keeps unrelated edits and history",
  async (item) => {
    const { changed } = setup();
    await start(item.task, "target" in item ? item.target : undefined);
    if (item.task === "play") await userEvent.type(screen.getByLabelText("New object ID"), "next");
    if (item.task === "sections") {
      const file = new File([assistanceBody], "guide.md", { type: "text/markdown" });
      Object.defineProperty(file, "arrayBuffer", {
        value: async () => assistanceBody.slice().buffer,
      });
      await userEvent.upload(
        screen.getByLabelText("Original uploaded document for this source"),
        file,
      );
      await screen.findByText(/Selected local document: guide.md/);
    }
    await userEvent.click(screen.getByRole("button", { name: "Prepare request for review" }));
    const request = requestFromUI();
    expect(request.input.context).toBe("An author-written summary.");
    expect(request.response_schema).toMatchObject({ additionalProperties: false });
    expect(request).not.toHaveProperty("working");
    expect(parsedWorking()).toEqual(assistanceWorking);
    fireEvent.change(screen.getByLabelText("Candidate JSON to review"), {
      target: { value: candidate(request, item.output) },
    });
    expect(changed).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Review candidate changes" }));
    expect(screen.getByRole("region", { name: "Assistance candidate review" })).toBeTruthy();
    expect(screen.getAllByText("After").length).toBeGreaterThan(0);
    expect(changed).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Apply reviewed candidate" }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(parsedWorking().provenance.authored_by_agent).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Edit something else" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo assisted changes" }));
    expect(parsedWorking().summary).toBe("Later summary");
    expect(parsedWorking().provenance.authored_by_agent).toBe(true);
    expect(parsedWorking().story.scenes).toEqual(
      (assistanceWorking.story as { scenes: unknown[] }).scenes,
    );
  },
);
it("does not apply an approved file, and keeps a stale review unapplied after a local edit", async () => {
  const { changed } = setup();
  await start("description", "beat:unfinished");
  await userEvent.click(screen.getByRole("button", { name: "Prepare request for review" }));
  const request = requestFromUI();
  const json = candidate(request, { description: "A promise." });
  fireEvent.change(screen.getByLabelText("Candidate JSON to review"), {
    target: { value: JSON.stringify({ ...JSON.parse(json), approved: true }) },
  });
  await userEvent.click(screen.getByRole("button", { name: "Review candidate changes" }));
  expect(screen.queryByRole("button", { name: "Apply reviewed candidate" })).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Candidate JSON to review"), { target: { value: json } });
  await userEvent.click(screen.getByRole("button", { name: "Review candidate changes" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit something else" }));
  expect(
    (screen.getByRole("button", { name: "Apply reviewed candidate" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Apply reviewed candidate" }));
  expect(changed).not.toHaveBeenCalled();
});
it("discards a late local file result when account identity changes before React remount", async () => {
  const { queryClient, changed } = setup();
  await start("description", "beat:unfinished");
  await userEvent.click(screen.getByRole("button", { name: "Prepare request for review" }));
  const original = candidate(requestFromUI(), { description: "A promise." });
  let finish: ((bytes: ArrayBuffer) => void) | undefined;
  const file = new File([original], "candidate.json", { type: "application/json" });
  Object.defineProperty(file, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  });
  await userEvent.upload(screen.getByLabelText("Candidate JSON file"), file);
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => {
    queryClient.setQueryData(keys.me, { ...ME, id: "usr_01j00000000000000000000002" });
    finish?.(new TextEncoder().encode(original).buffer);
  });
  expect(
    (screen.queryByLabelText("Candidate JSON to review") as HTMLTextAreaElement | null)?.value ??
      "",
  ).not.toBe(original);
  await waitFor(() => expect(screen.queryByLabelText("Candidate JSON to review")).toBeNull());
  expect(changed).not.toHaveBeenCalled();
  expect(parsedWorking()).toEqual(assistanceWorking);
});
it("does not report Apply or Undo success when the editor skips its update callback", async () => {
  const control = { skip: true };
  const { changed } = setup(control);
  await start("description", "beat:unfinished");
  await userEvent.click(screen.getByRole("button", { name: "Prepare request for review" }));
  fireEvent.change(screen.getByLabelText("Candidate JSON to review"), {
    target: { value: candidate(requestFromUI(), { description: "A promise." }) },
  });
  await userEvent.click(screen.getByRole("button", { name: "Review candidate changes" }));
  await userEvent.click(screen.getByRole("button", { name: "Apply reviewed candidate" }));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByText(/editor did not apply/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Apply reviewed candidate" })).toBeTruthy();
  expect(screen.queryByText(/Applied to this draft/)).toBeNull();
  control.skip = false;
  await userEvent.click(screen.getByRole("button", { name: "Apply reviewed candidate" }));
  control.skip = true;
  await userEvent.click(screen.getByRole("button", { name: "Undo assisted changes" }));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/editor did not undo/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Undo assisted changes" })).toBeTruthy();
  expect(screen.queryByText(/Undid the assisted changes/)).toBeNull();
});
it("checks actual document bytes even when the selected File reports a small size", async () => {
  setup();
  await start("sections", "source:guide");
  const file = new File(["small metadata"], "guide.md", { type: "text/markdown" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new ArrayBuffer(8 * 1024 * 1024 + 1),
  });
  await userEvent.upload(screen.getByLabelText("Original uploaded document for this source"), file);
  expect(await screen.findByText(/file exceeds/)).toBeTruthy();
  expect(screen.queryByText(/Selected local document:/)).toBeNull();
});
it("keeps a manually edited candidate when an earlier local file read finishes", async () => {
  setup();
  await start("description", "beat:unfinished");
  await userEvent.click(screen.getByRole("button", { name: "Prepare request for review" }));
  const original = candidate(requestFromUI(), { description: "Original candidate." });
  let finish: ((bytes: ArrayBuffer) => void) | undefined;
  const file = new File([original], "candidate.json", { type: "application/json" });
  Object.defineProperty(file, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  });
  await userEvent.upload(screen.getByLabelText("Candidate JSON file"), file);
  const edited = candidate(requestFromUI(), { description: "My edited candidate." });
  fireEvent.change(screen.getByLabelText("Candidate JSON to review"), {
    target: { value: edited },
  });
  await act(async () => {
    finish?.(new TextEncoder().encode(original).buffer);
  });
  expect((screen.getByLabelText("Candidate JSON to review") as HTMLTextAreaElement).value).toBe(
    edited,
  );
});

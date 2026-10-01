import { describe, expect, it } from "vitest";
import { parseExampleDialogue, splitDecorators } from "../src/text.js";

describe("CCv3 decorator text", () => {
  it("preserves names, fallback markers, values and the remaining line endings", () => {
    expect(splitDecorators("\r\n\t@@activate\r@@@fallback  some value\r\n\rbody\rnext")).toEqual({
      decorators: [
        { name: "activate", value: "", fallback: false },
        { name: "fallback", value: "some value", fallback: true },
      ],
      body: "body\nnext",
    });
    expect(splitDecorators("@@_A09\tvalue\n@@bad-name x\r\nbody")).toEqual({
      decorators: [{ name: "_A09", value: "value", fallback: false }],
      body: "@@bad-name x\nbody",
    });
  });

  it("keeps the original content when the first decorator is invalid", () => {
    for (const input of [
      "\r\n@@1name value\rbody",
      "@@@@name value",
      "@@name! value",
      "plain\rbody",
    ]) {
      expect(splitDecorators(input)).toEqual({ decorators: [], body: input });
    }
  });

  it("accepts Unicode whitespace before a value but retains a value containing a Unicode line break as body", () => {
    expect(splitDecorators("\ufeff@@name\u00a0\u2028\u2029value\ufeff\nbody")).toEqual({
      decorators: [{ name: "name", value: "value", fallback: false }],
      body: "body",
    });
    for (const separator of ["\u2028", "\u2029"]) {
      const content = `@@name first${separator}second\r\nbody`;
      expect(splitDecorators(content)).toEqual({ decorators: [], body: content });
    }
  });

  it("handles long ambiguous whitespace without rejecting valid input or repeatedly scanning a failed value", () => {
    const spaces = " ".repeat(150_000);
    const valid = `@@name${spaces}\u2028value\nbody`;
    expect(splitDecorators(valid)).toEqual({
      decorators: [{ name: "name", value: "value", fallback: false }],
      body: "body",
    });
    const invalid = `@@name${spaces}first\u2028second`;
    expect(splitDecorators(invalid)).toEqual({ decorators: [], body: invalid });
  });
});

describe("CCv3 example dialogue text", () => {
  it("separates mixed-case START markers across blank lines while retaining continuation indentation", () => {
    expect(
      parseExampleDialogue(
        "\t\r\n <sTaRt> \r\n\t{{ CHAR }}: Hello\r\n  indented\n \t\n<START>\r<USER>: Hi\rnext\n\t",
      ),
    ).toEqual([
      { turns: [{ speaker: "{{self}}", text: "Hello\n  indented" }] },
      { turns: [{ speaker: "{{user}}", text: "Hi\nnext" }] },
    ]);
  });

  it("requires a complete marker line and never discards ordinary example prose", () => {
    for (const input of [
      "preamble\n<START>\n{{char}}: Hello",
      "<START> trailing\n{{char}}: Hello",
      "@@text",
    ]) {
      expect(parseExampleDialogue(input)).toBeNull();
    }
    expect(parseExampleDialogue("{{char}}: Hello <START> there\n <START> trailing")).toEqual([
      { turns: [{ speaker: "{{self}}", text: "Hello <START> there\n <START> trailing" }] },
    ]);
  });

  it("keeps Unicode separator behavior distinct from CR/LF dialogue lines", () => {
    expect(
      parseExampleDialogue("<START>\u2028{{char}}: first\u2029<start>\r\n{{user}}: second"),
    ).toEqual([
      { turns: [{ speaker: "{{self}}", text: "first" }] },
      { turns: [{ speaker: "{{user}}", text: "second" }] },
    ]);
    expect(parseExampleDialogue("{{char}}: first\u2028{{user}}: still the same line")).toEqual([
      { turns: [{ speaker: "{{self}}", text: "first\u2028{{user}}: still the same line" }] },
    ]);
  });

  it("allows empty turns and discards empty START blocks and trailing ECMAScript whitespace", () => {
    expect(
      parseExampleDialogue(
        "<START>\n<START>\n{{char}}:\n{{user}}: Yes\ufeff\u00a0\u2029\n<START>\n",
      ),
    ).toEqual([
      {
        turns: [
          { speaker: "{{self}}", text: "" },
          { speaker: "{{user}}", text: "Yes" },
        ],
      },
    ]);
    expect(parseExampleDialogue("\r\n\t<START>\u2028\u2029\n ")).toBeNull();
  });

  it("processes long unsuccessful marker and edge-whitespace runs without losing the final body", () => {
    const middle = "\n ".repeat(60_000);
    expect(parseExampleDialogue(`{{char}}: first${middle}last\n\t`)).toEqual([
      { turns: [{ speaker: "{{self}}", text: `first${middle}last` }] },
    ]);
    expect(parseExampleDialogue(`${" \n".repeat(60_000)}<START>\n{{user}}: final`)).toEqual([
      { turns: [{ speaker: "{{user}}", text: "final" }] },
    ]);
  });
});

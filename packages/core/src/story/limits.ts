import { CharError } from "../errors.js";

/** Check recursive input before Zod or canonical normalization can recurse into it. */
export function assertConditionLimits(input: unknown, subject = "condition"): void {
  const stack = [{ value: input, depth: 1 }];
  let count = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    if (++count > 512 || entry.depth > 32)
      throw new CharError({ code: "story.condition_limit", subject });
    const value = entry.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if ("not" in value) stack.push({ value: value.not, depth: entry.depth + 1 });
    const children = "all" in value ? value.all : "any" in value ? value.any : undefined;
    if (!Array.isArray(children)) continue;
    if (children.length + count > 512)
      throw new CharError({ code: "story.condition_limit", subject });
    for (const child of children) stack.push({ value: child, depth: entry.depth + 1 });
  }
}

/** Only condition-bearing fields are traversed; malformed shapes are left to the schema. */
export function assertStoryLimits(input: unknown): void {
  if (!input || typeof input !== "object") return;
  for (const key of ["scenes", "beats", "endings", "events", "choices"] as const) {
    const items = Reflect.get(input, key);
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      if (item && typeof item === "object" && "when" in item)
        assertConditionLimits(item.when, `story.${key}[${index}].when`);
    });
  }
}

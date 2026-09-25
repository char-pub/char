/** Policy conversion is always explicit; private import reports are never restored implicitly. */
import {
  CharError,
  type CreationInput,
  type CreationMeta,
  PRESET_REGIONS,
  type PresetBlock,
  type ResolvedPreset,
  ResolvedPresetSchema,
} from "@char-pub/core";
import type { ImportReport } from "./import.js";

export interface PolicyLossItem {
  subject: string;
  detail: string;
}

export function importPolicyPreset(
  report: Pick<ImportReport, "omitted_policy_fields" | "source_digest" | "format">,
  options: {
    id: string;
    ref: string;
    display_name: string;
    meta: CreationMeta;
    authors?: CreationInput["authors"];
  },
): CreationInput {
  const blocks = report.omitted_policy_fields.flatMap<PresetBlock>(({ field, value }) => {
    if (value.trim() === "") return [];
    if (field === "system_prompt")
      return [{ id: "system", text: value, position: "main" as const }];
    if (field === "post_history_instructions")
      return [{ id: "post-history", text: value, position: "after-history" as const }];
    return [];
  });
  if (blocks.length === 0) throw new CharError({ code: "ccv3.policy_empty", subject: options.ref });
  return {
    ...options,
    type: "preset",
    policy: {
      version: "0-draft",
      blocks,
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
    },
    provenance: {
      imported_from: { format: report.format, source_digest: report.source_digest },
    },
  };
}

export function exportPolicyFields(input: ResolvedPreset): {
  fields: { system_prompt: string; post_history_instructions: string };
  losses: PolicyLossItem[];
} {
  const preset = ResolvedPresetSchema.parse(input);
  const blocks = preset.policy.blocks.filter((block) => block.enabled !== false);
  const losses: PolicyLossItem[] = [
    {
      subject: "policy.layout",
      detail:
        "CCv3 stores policy text only; the consumer controls region ordering and system message boundaries",
    },
    {
      subject: "policy.requires",
      detail: "CCv3 cannot enforce runtime capability requirements",
    },
  ];
  if (Object.keys(preset.policy.region_budgets ?? {}).length > 0)
    losses.push({
      subject: "policy.region_budgets",
      detail: "CCv3 cannot enforce region token budgets",
    });
  if (blocks.some((block) => block.id.includes("#")))
    losses.push({
      subject: "policy.imports",
      detail:
        "module text is flattened; exact release locks and block origins are not executable in CCv3",
    });
  if (blocks.some((block) => /\{\{[^}]+\}\}/.test(block.text)))
    losses.push({
      subject: "policy.blocks",
      detail: "policy text is literal in char.pub; CCv3 consumers may interpret macro syntax",
    });
  return {
    fields: {
      system_prompt: blocks
        .filter((block) => block.position === "main")
        .map((block) => block.text)
        .join("\n\n"),
      post_history_instructions: blocks
        .filter((block) => block.position === "after-history")
        .map((block) => block.text)
        .join("\n\n"),
    },
    losses,
  };
}

/**
 * 评级、权利和许可的选项文案。编辑器和导入向导共用，保证两处说法一致。
 *
 * 许可只提供 SPDX 标识和 Creative Commons，不自创许可证；列表之外的 SPDX 表达式在编辑器里
 * 手填。All rights reserved 是最保守的选择：作者自己能发布，别人不能再分发。
 */
import type { CreationMeta, Rating } from "@char-pub/core";

export const LICENSE_PRESETS = [
  { id: "LicenseRef-All-Rights-Reserved", label: "All rights reserved" },
  { id: "CC-BY-4.0", label: "CC BY 4.0 — reuse with credit" },
  { id: "CC-BY-SA-4.0", label: "CC BY-SA 4.0 — reuse with credit, share alike" },
  { id: "CC-BY-NC-4.0", label: "CC BY-NC 4.0 — non-commercial reuse with credit" },
  { id: "CC0-1.0", label: "CC0 — public domain" },
] as const;

/** 许可在摘要里的短名字：预设用简称，其他 SPDX 表达式原样显示。 */
export function licenseShort(id: string): string {
  if (id === "LicenseRef-All-Rights-Reserved") return "All rights reserved";
  return id;
}

export const RATING_OPTIONS: { id: Rating; label: string; hint: string }[] = [
  { id: "general", label: "General", hint: "Anyone" },
  { id: "teen", label: "Teen", hint: "Mild violence, language" },
  { id: "mature", label: "Mature", hint: "Strong themes; hidden by default" },
  { id: "explicit", label: "Explicit", hint: "Sexual content; hidden by default" },
];

export type Rights = CreationMeta["rights"];

export const RIGHTS_OPTIONS: { id: Rights; label: string; hint: string; note: string }[] = [
  {
    id: "original",
    label: "Original",
    hint: "I made this",
    note: "You made it, so you can choose any license.",
  },
  {
    id: "fan-work",
    label: "Fan work",
    hint: "Based on someone else's work",
    note: "Fan work is allowed; the original owner can still ask us to take it down.",
  },
  {
    id: "licensed",
    label: "Licensed",
    hint: "I have permission to publish it",
    note: "Keep the permission somewhere safe; we may ask for it if the owner objects.",
  },
];

export const LICENSE_HELP =
  "All rights reserved means only you can publish it. CC licenses let others build on it.";

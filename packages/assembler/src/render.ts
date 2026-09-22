/**
 * 把 IR fragment 渲染成最终给模型的文本。
 *
 * IR 里的文本已经完成了 early binding 和 params 替换，只剩下 `{{late:*}}` 占位符和
 * `{{{{` 转义。这里负责：选 locale 变体、替换 late 占位符、把说话人换成显示名、
 * 处理图片。fragment 内容本身不做任何改写。
 */
import {
  CharError,
  type ContextIR,
  compareStrings,
  finalizeIrText,
  type IRAsset,
  type IRContent,
  type IRFragment,
  type Participant,
  USER_LATE_SLOT,
  USER_PARTICIPANT,
} from "@char-pub/core";
import { localizedString, matchLocale } from "./locale.js";
import type { Session } from "./session.js";

/** 固定的提示文字。它们属于排版，不是创作内容；Runtime 可以按需要替换成其他语言。 */
export interface Labels {
  /** narrator 模式下给 private fragment 加的前缀，告诉模型只有这些角色知道。 */
  privateNote(names: readonly string[]): string;
  examplesHeader: string;
  memoryHeader: string;
  stateHeader: string;
  variantsHeader: string;
  bindingsHeader: string;
  /** 模型不支持图片时，用 alt 文本代替图片。 */
  imageAlt(alt: string): string;
}

export const DEFAULT_LABELS: Labels = {
  privateNote: (names) =>
    `[Only ${names.join(", ")} ${names.length === 1 ? "knows" : "know"} the following. Other characters must not act on it.]`,
  examplesHeader: "[Example dialogue]",
  memoryHeader: "[Memory]",
  stateHeader: "[Current state]",
  variantsHeader: "[Active variants]",
  bindingsHeader: "[Cast]",
  imageAlt: (alt) => `[Image: ${alt}]`,
};

export interface Attachment {
  asset: string;
  media_type: string;
  digest: string;
  /** 只有公开镜像的资源才有稳定 URL；私有资源需要 Runtime 另行向 Registry 申请短期 URL。 */
  url?: string;
  alt?: string;
}

export interface RenderedFragment {
  text: string;
  attachments: Attachment[];
  /** 请求的 locale 没有对应变体，回退到了默认内容。 */
  localeFallback: boolean;
  /** 有图片因为模型不支持而被换成 alt 文本或丢弃。 */
  mediaDegraded: boolean;
  /** 渲染后没有任何可用内容（例如不支持的图片又没有 alt）。 */
  empty: boolean;
}

export class RenderContext {
  readonly locale: string;
  private readonly participants = new Map<string, Participant>();
  private readonly assets = new Map<string, IRAsset>();
  private readonly lateSlots = new Set<string>();

  constructor(
    readonly ir: ContextIR,
    readonly session: Session,
    locale: string,
    readonly images: boolean,
    readonly labels: Labels,
  ) {
    this.locale = locale;
    for (const p of ir.participants) this.participants.set(p.key, p);
    for (const a of ir.assets) this.assets.set(a.id, a);
    for (const s of ir.late_slots) this.lateSlots.add(s.key);
  }

  /** 替换 `{{late:<key>}}`。引用了未声明或未绑定的 slot 时报错，绝不输出残留的占位符。 */
  bindLate = (key: string): string => {
    if (key !== USER_LATE_SLOT && !this.lateSlots.has(key)) {
      throw new CharError({ code: "assemble.unknown_late_slot", subject: key });
    }
    const b = this.session.bindings[key];
    if (!b) {
      throw new CharError({
        code: "assemble.late_slot_unbound",
        subject: key,
        detail: "text uses a late slot that the session did not bind",
      });
    }
    return b.display_name;
  };

  text(s: string): string {
    return finalizeIrText(s, this.bindLate);
  }

  hasParticipant(key: string): boolean {
    return key === USER_PARTICIPANT || this.participants.has(key);
  }

  /** participant 的显示名。由 Session 决定的参与者使用绑定对象的名字。 */
  participantName(key: string): string {
    const p = this.participants.get(key);
    if (!p) {
      if (key === USER_PARTICIPANT) return this.bindLate(USER_LATE_SLOT);
      throw new CharError({ code: "assemble.unknown_participant", subject: key });
    }
    if (p.late !== undefined) return this.bindLate(p.late);
    return localizedString(p.display_name, this.locale, this.ir.meta.default_locale);
  }

  /** `participant:<key>` → 显示名。 */
  speakerName(speaker: string): string {
    const prefix = "participant:";
    if (!speaker.startsWith(prefix)) {
      throw new CharError({ code: "assemble.invalid_speaker", subject: speaker });
    }
    return this.participantName(speaker.slice(prefix.length));
  }

  asset(id: string): IRAsset {
    const a = this.assets.get(id);
    if (!a) throw new CharError({ code: "assemble.unknown_asset", subject: id });
    return a;
  }

  /**
   * 选择 fragment 的内容变体：请求的 locale 与默认 locale、各变体一起按 BCP 47 lookup
   * 匹配，越具体的标签越优先。都匹配不上时回退到默认内容。
   */
  pickContent(f: IRFragment): { content: IRContent; fallback: boolean } {
    const def = this.ir.meta.default_locale;
    const variants = f.locales ?? {};
    const hit = matchLocale([def, ...Object.keys(variants).sort(compareStrings)], this.locale);
    if (hit === null) return { content: f.content, fallback: true };
    if (hit === def) return { content: f.content, fallback: false };
    return { content: variants[hit] ?? f.content, fallback: false };
  }

  render(f: IRFragment): RenderedFragment {
    const { content, fallback } = this.pickContent(f);
    const attachments: Attachment[] = [];
    let mediaDegraded = false;
    const parts: string[] = [];

    const addAsset = (id: string): void => {
      const a = this.asset(id);
      // 只有 context 资源可以进入模型；展示用资源即使被引用也不发给模型。
      if (this.images && a.role === "context") {
        const att: Attachment = { asset: a.id, media_type: a.media_type, digest: a.digest };
        if (a.url !== undefined) att.url = a.url;
        if (a.alt !== undefined) att.alt = a.alt;
        attachments.push(att);
        return;
      }
      mediaDegraded = true;
      if (a.alt !== undefined) parts.push(this.labels.imageAlt(a.alt));
    };

    switch (content.type) {
      case "text":
        parts.push(this.text(content.text));
        break;
      case "dialogue":
        parts.push(
          content.turns
            .map((t) => `${this.speakerName(t.speaker)}: ${this.text(t.text)}`)
            .join("\n"),
        );
        break;
      case "media":
        addAsset(content.asset);
        if (content.caption !== undefined) parts.push(this.text(content.caption));
        break;
      case "structured":
        // 扩展内容：参考实现不理解它的 schema，按 JSON 原样交给模型。
        parts.push(JSON.stringify(content.data));
        break;
    }
    for (const id of f.asset_refs ?? []) addAsset(id);

    const text = parts.filter((p) => p.length > 0).join("\n");
    return {
      text,
      attachments,
      localeFallback: fallback,
      mediaDegraded,
      empty: text.length === 0 && attachments.length === 0,
    };
  }
}

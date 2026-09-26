/**
 * Token 计数。
 *
 * Assembler 在浏览器里也要运行，所以默认用 tokenx 做启发式估算（体积约 2 kB，结果标记为
 * 估算）。用户指定了具体 tokenizer 时，按需动态加载 gpt-tokenizer 对应的编码表（体积较大，
 * 只在需要时下载），结果标记为精确。
 *
 * 计数只覆盖文本本身，不含各家 API 给每条消息附加的格式开销。
 */
import { CharError, type RuntimeProfile } from "@char-pub/core";
import { estimateTokenCount } from "tokenx";

export const TOKENIZER_NAMES = ["estimate", "o200k_base", "cl100k_base"] as const;
export type TokenizerName = (typeof TOKENIZER_NAMES)[number];

/** Versions form part of reproducible assembly fixtures; update when the pinned implementation changes. */
export const TOKENIZER_VERSIONS = {
  estimate: "tokenx@2.1.0",
  o200k_base: "gpt-tokenizer@4.0.0",
  cl100k_base: "gpt-tokenizer@4.0.0",
} as const;

export async function createPinnedTokenCounter(identity: {
  name: string;
  version: string;
}): Promise<TokenCounter> {
  if (!isTokenizerName(identity.name) || TOKENIZER_VERSIONS[identity.name] !== identity.version)
    throw new CharError({
      code: "assembly.tokenizer_version_unsupported",
      subject: identity.name,
      detail: identity.version,
    });
  return createTokenCounter(identity.name);
}

export interface TokenCounter {
  /** 实际使用的 tokenizer；Preview 必须把它展示给用户。 */
  readonly tokenizer: string;
  /** true 表示结果只是估算。 */
  readonly estimated: boolean;
  count(text: string): number;
}

export const estimateCounter: TokenCounter = {
  tokenizer: "estimate",
  estimated: true,
  count: (text) => estimateTokenCount(text),
};

export function isTokenizerName(s: string): s is TokenizerName {
  return (TOKENIZER_NAMES as readonly string[]).includes(s);
}

/**
 * 作者写的文本里可能出现 `<|endoftext|>` 之类的字符串。它们只是普通文字，
 * 不能被当成控制 token（否则 gpt-tokenizer 会直接报错）。
 */
const NO_SPECIAL_TOKENS: Set<string> = new Set();

type CountFn = (text: string, options: { disallowedSpecial: Set<string> }) => number;

function exactCounter(tokenizer: TokenizerName, countTokens: CountFn): TokenCounter {
  return {
    tokenizer,
    estimated: false,
    count: (text) => countTokens(text, { disallowedSpecial: NO_SPECIAL_TOKENS }),
  };
}

/** 加载指定的 tokenizer。具体编码表是异步按需加载的。 */
export async function createTokenCounter(name: string): Promise<TokenCounter> {
  switch (name) {
    case "estimate":
      return estimateCounter;
    case "o200k_base": {
      const m = await import("gpt-tokenizer/encoding/o200k_base");
      return exactCounter(name, m.countTokens);
    }
    case "cl100k_base": {
      const m = await import("gpt-tokenizer/encoding/cl100k_base");
      return exactCounter(name, m.countTokens);
    }
    default:
      throw new CharError({
        code: "tokenizer.unsupported",
        subject: name,
        detail: `supported: ${TOKENIZER_NAMES.join(", ")}`,
      });
  }
}

/** 按 Runtime Profile 选择 tokenizer；不认识的名字退回估算，并在结果里如实标注。 */
export async function counterForProfile(
  profile: Pick<RuntimeProfile, "tokenizer">,
): Promise<TokenCounter> {
  return isTokenizerName(profile.tokenizer)
    ? createTokenCounter(profile.tokenizer)
    : estimateCounter;
}

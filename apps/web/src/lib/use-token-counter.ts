/**
 * 按用户选择加载 tokenizer。精确编码表很大，按需动态加载；加载完成前用估算，
 * 界面必须如实标注。
 */
import {
  createTokenCounter,
  estimateCounter,
  type TokenCounter,
  type TokenizerName,
} from "@char-pub/assembler";
import { useEffect, useState } from "react";

export function useTokenCounter(name: TokenizerName) {
  const [counter, setCounter] = useState<TokenCounter>(estimateCounter);
  const [status, setStatus] = useState<"ready" | "loading" | "error">("ready");

  useEffect(() => {
    if (name === "estimate") {
      setCounter(estimateCounter);
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setCounter(estimateCounter);
    createTokenCounter(name).then(
      (c) => {
        if (cancelled) return;
        setCounter(c);
        setStatus("ready");
      },
      () => {
        if (cancelled) return;
        setCounter(estimateCounter);
        setStatus("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [name]);

  return { counter, status };
}

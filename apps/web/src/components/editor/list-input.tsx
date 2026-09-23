/**
 * 逗号分隔的列表输入（关键词、标签、内容警告）。输入框保留用户正在输入的原文，
 * 解析后的列表随每次输入提交；外部值变化（例如重新加载草稿）时同步回输入框。
 */
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { splitList } from "@/lib/draft";

export function ListInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));
  const committed = useRef(value.join("\u0000"));
  useEffect(() => {
    const key = value.join("\u0000");
    if (key !== committed.current) {
      committed.current = key;
      setText(value.join(", "));
    }
  }, [value]);
  return (
    <Input
      {...props}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = splitList(e.target.value);
        committed.current = next.join("\u0000");
        onChange(next);
      }}
    />
  );
}

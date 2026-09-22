/**
 * 用户内容的渲染。所有作者写的文本都经过这里：Markdown 用 react-markdown 渲染，
 * 原始 HTML 一律跳过（`skipHtml`），链接只允许 http(s) 与 mailto，图片不渲染
 * （作品中的图片只能通过经过扫描的 asset 展示）。绝不使用 dangerouslySetInnerHTML。
 */
import ReactMarkdown, { type Components } from "react-markdown";

const SAFE_URL = /^(https?:|mailto:)/i;

function safeUrl(url: string): string {
  return SAFE_URL.test(url) ? url : "";
}

const components: Components = {
  a: ({ href, children }) =>
    href && safeUrl(href) ? (
      <a href={href} rel="nofollow noopener noreferrer ugc" target="_blank">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => <span className="text-muted-foreground">[image: {alt ?? ""}]</span>,
};

export function UserMarkdown({ text }: { text: string }) {
  return (
    <div className="prose-sm space-y-2 leading-relaxed [&_code]:font-mono [&_code]:text-[0.85em]">
      <ReactMarkdown skipHtml urlTransform={safeUrl} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** 纯文本：保留换行，不解释任何标记。 */
export function UserText({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap">{text}</span>;
}

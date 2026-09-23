/**
 * 需要登录的页面或区块在未登录时显示的说明，页面里直接放登录按钮（打开登录对话框）。
 *
 * ```tsx
 * if (!me.data) return <SignInRequired what="see your creations" />;
 * <SignInRequired what="propose a change" description="Contributions to Alice need a char.pub account." level={2} />
 * ```
 */
import { LogIn } from "lucide-react";
import type * as React from "react";
import { SignInButton } from "./sign-in";
import { StatePanel } from "./states";

export function SignInRequired({
  what,
  description = "char.pub uses your GitHub, Discord or Google account. There is no password.",
  level = 1,
  className,
}: {
  /** 标题里 “Sign in to …” 后面的部分。 */
  what: string;
  description?: React.ReactNode;
  /** 整页用 1（默认），页面里的一块区域用 2。 */
  level?: 1 | 2;
  className?: string;
}) {
  return (
    <StatePanel
      icon={LogIn}
      level={level}
      className={className ?? (level === 1 ? "mx-auto w-full max-w-xl" : undefined)}
      title={`Sign in to ${what}`}
      description={description}
    >
      <SignInButton />
    </StatePanel>
  );
}

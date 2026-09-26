/**
 * mature / explicit 内容默认遮挡：直接打开成人作品时先遮住正文、预览和对比，用户确认后才显示。
 *
 * - 账号开启了“显示成人内容”（并确认过满 18 岁）时由调用方传 `allowed`，不遮挡。
 * - “Show this once” 只在当前浏览器会话里有效：传了 `remember`（作品的 ref）时记在
 *   sessionStorage 里，按账号与评级隔离；刷新或切换作品标签页仍有效，关掉标签页就失效。
 * - 嵌套预览继承同账号外层已确认的评级；选择更高评级的 Preset 时仍需额外确认。
 * - 想一直显示的用户：登录用户去账号设置，未登录用户先登录。`signedIn` 不传时不显示这个入口
 *   （例如没有路由的单独渲染）。
 */
import type { Rating } from "@char-pub/core";
import { Link } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { highestRating, isAdultRating, RATING_LABEL } from "./rating";
import { SignInButton } from "./sign-in";
import { StatePanel } from "./states";

const STORAGE_PREFIX = "charpub.mature-shown:";
const ConfirmedRating = createContext<{ identity: string; rating: Rating } | null>(null);

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // 浏览器禁用了存储：退回到只在组件里记住。
    return null;
  }
}

function shownBefore(key: string | undefined): boolean {
  if (!key) return false;
  try {
    return session()?.getItem(STORAGE_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

function rememberShown(key: string | undefined): void {
  if (!key) return;
  try {
    session()?.setItem(STORAGE_PREFIX + key, "1");
  } catch {
    // 存不下也没关系：这一次已经显示了。
  }
}

export function MatureGate({
  rating,
  allowed = false,
  remember,
  reason,
  signedIn,
  identity = "anonymous",
  children,
}: {
  rating: Rating;
  /** 用户已在设置中开启成人内容显示。 */
  allowed?: boolean | undefined;
  /** 在这个会话里记住确认：传作品的 ref（例如 `@djj/alice`）。 */
  remember?: string | undefined;
  /** 评级从哪里来，例如 “Rated Mature because of @vee/afterlife (World).” */
  reason?: ReactNode;
  /** 当前是否登录，决定“一直显示”去设置页还是打开登录对话框。 */
  signedIn?: boolean | undefined;
  /** 将临时确认隔离到当前账号；匿名访问使用默认值。 */
  identity?: string | undefined;
  children: ReactNode;
}) {
  const parent = useContext(ConfirmedRating);
  const inherited = parent?.identity === identity ? parent.rating : "general";
  // 组件复用、账号切换或评级提升都不能沿用上一次局部确认。
  const scope = JSON.stringify([identity, remember ?? null, rating]);
  const storageKey = remember ? scope : undefined;
  const [confirmed, setConfirmed] = useState<string>();
  if (
    !isAdultRating(rating) ||
    allowed ||
    confirmed === scope ||
    shownBefore(storageKey) ||
    highestRating(inherited, rating) === inherited
  ) {
    return (
      <ConfirmedRating.Provider value={{ identity, rating: highestRating(inherited, rating) }}>
        {children}
      </ConfirmedRating.Provider>
    );
  }
  const label = RATING_LABEL[rating];
  return (
    <StatePanel
      icon={EyeOff}
      tone="danger"
      title={`${label} content is hidden`}
      description={
        <>
          <p>{reason ?? `This is rated ${label}.`}</p>
          <p className="mt-1">
            It is only shown to adults who choose to see it. Continue only if you are 18 or older.
          </p>
        </>
      }
    >
      <Button
        variant="outline"
        onClick={() => {
          rememberShown(storageKey);
          setConfirmed(scope);
        }}
      >
        <Eye aria-hidden /> Show this once
      </Button>
      {signedIn === true ? (
        <Link to="/settings" className={buttonVariants({ variant: "link" })}>
          Always show in settings
        </Link>
      ) : signedIn === false ? (
        <SignInButton variant="link">Sign in to always show it</SignInButton>
      ) : null}
    </StatePanel>
  );
}

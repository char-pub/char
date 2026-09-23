/** 需要登录的页面在未登录时显示的说明；登录入口在顶栏右上角。 */
export function SignInRequired({ what }: { what: string }) {
  return (
    <section className="max-w-xl space-y-3 py-10">
      <p className="stamp border-seal text-seal">Sign in</p>
      <h1 className="text-3xl">Sign in to {what}.</h1>
      <p className="text-muted-foreground">
        Use the <strong>Sign in</strong> menu at the top right with GitHub, Discord or Google.
        char.pub never asks for a password.
      </p>
    </section>
  );
}

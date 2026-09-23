/*
 * 首屏渲染前应用保存的主题，避免选了深色（或系统是深色）的用户先看到一闪浅色。
 *
 * CSP 只允许同源脚本、不允许 inline script，所以这是 index.html 的 <head> 里一个同步的
 * 外链脚本。规则和 src/lib/theme.ts 一致：localStorage `charpub.theme` 是 light / dark 时
 * 按它来，没有保存（或是 system）时跟随系统；手动选过主题时，浏览器的 theme-color 也跟着改。
 */
(() => {
  let pref = null;
  try {
    pref = window.localStorage.getItem("charpub.theme");
  } catch {
    // 隐私模式等情况下读不到 localStorage，按跟随系统处理。
  }
  const dark =
    pref === "dark" ||
    (pref !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
  document.documentElement.classList.toggle("dark", dark);
  if (pref === "light" || pref === "dark") {
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", dark ? "#171B22" : "#F8F7F4");
    }
  }
})();

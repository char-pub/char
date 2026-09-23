/**
 * 把后端返回的文件交给浏览器保存。只触发下载，不在页面中打开或预览内容，
 * 对隔离证据也是同样的处理。
 */
import type { DownloadedFile } from "./api";

export function saveFile(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  // 下载开始后才能释放，留一点时间给浏览器。
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

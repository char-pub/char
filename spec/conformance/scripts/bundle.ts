/**
 * `pnpm conformance:bundle`：把 cases/ 下的全部用例打包成 runner/cases.gen.json。
 * 浏览器和 workerd 没有文件系统，测试通过 import 这个 JSON 加载用例。
 * 修改任何用例后都要重新运行；防漂移测试会在 bundle 过期时失败。
 */
import { writeFileSync } from "node:fs";
import { BUNDLE_PATH, buildBundle, serializeBundle } from "./cases.js";

const bundle = buildBundle();
writeFileSync(BUNDLE_PATH, serializeBundle(bundle));
console.log(`bundled ${bundle.cases.length} cases → ${BUNDLE_PATH}`);

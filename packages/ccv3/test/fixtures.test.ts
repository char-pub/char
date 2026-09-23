/**
 * `test/fixtures/` 下的合成卡片文件（JSON、PNG、CHARX 各一份），用来确认真实文件形态的输入
 * 能被导入。需要重新生成时设置 `CCV3_WRITE_FIXTURES=1` 运行本测试。
 * 所有内容都是为测试编写的合成数据，不含任何第三方卡片。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importCard } from "../src/import.js";
import { charx, pngCard, tinyPng, v3Card } from "./helpers.js";

const dir = fileURLToPath(new URL("./fixtures/", import.meta.url));
const OPTS = { ids: { creation: "cr_01h455vb4pex5vsknk084sn001" }, ref: "@fixtures/mira" };

function fixtures(): Record<string, Uint8Array> {
  const card = v3Card();
  const json = new TextEncoder().encode(`${JSON.stringify(card, null, 2)}\n`);
  const charxCard = v3Card({
    assets: [
      { type: "icon", uri: "embeded://assets/icon/images/main.png", name: "main", ext: "png" },
      {
        type: "emotion",
        uri: "embeded://assets/emotion/images/happy.png",
        name: "happy",
        ext: "png",
      },
    ],
  });
  return {
    "synthetic-mira.json": json,
    "synthetic-mira.png": pngCard(card, {
      v2: { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Mira" } },
    }),
    "synthetic-mira.charx": charx({
      "card.json": JSON.stringify(charxCard),
      "assets/icon/images/main.png": tinyPng(),
      "assets/emotion/images/happy.png": tinyPng(),
    }),
  };
}

describe("committed synthetic fixtures", () => {
  const files = fixtures();
  if (process.env.CCV3_WRITE_FIXTURES === "1") {
    for (const [name, bytes] of Object.entries(files)) writeFileSync(`${dir}${name}`, bytes);
  }

  it.each(Object.keys(files))("%s imports cleanly", (name) => {
    const bytes = new Uint8Array(readFileSync(`${dir}${name}`));
    const r = importCard(bytes, OPTS);
    expect(r.creation.display_name).toBe("Mira");
    expect(r.creation.provenance?.imported_from?.omitted_policy_fields).toEqual([
      "system_prompt",
      "post_history_instructions",
    ]);
    expect(r.report.lorebook.filter((e) => e.fragment_id !== undefined)).toHaveLength(4);
  });

  it("CHARX fixture yields avatar and emotion assets; PNG fixture yields avatar", () => {
    const png = importCard(new Uint8Array(readFileSync(`${dir}synthetic-mira.png`)), OPTS);
    expect(png.assets.map((a) => a.slot)).toEqual(["avatar"]);
    const zip = importCard(new Uint8Array(readFileSync(`${dir}synthetic-mira.charx`)), OPTS);
    expect(zip.assets.map((a) => a.slot)).toEqual(["avatar", "emotion"]);
  });
});

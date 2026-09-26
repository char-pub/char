import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { isCharError } from "../src/errors.js";
import { checkPublish } from "../src/publish.js";
import { resolve } from "../src/resolve/index.js";
import { PRESET_REGIONS } from "../src/schema/policy.js";
import { level0Character, tid } from "./fixtures.js";

const creation = {
  ...level0Character({ type: "preset", fragments: [], bootstrap: undefined, assets: [] }),
  policy: {
    version: "0-draft" as const,
    blocks: [],
    layout: [...PRESET_REGIONS],
    requires: { system_role: true as const },
  },
};
const root = {
  creation,
  release: tid("rel", 1),
  visibility: "public" as const,
  semantic_digest: canonicalizeCreation(creation).semantic_digest,
};

function rejectContent(fn: () => unknown) {
  try {
    fn();
    throw new Error("expected content resolver to reject the preset");
  } catch (error) {
    expect(isCharError(error) && error.code).toBe("resolve.preset_not_content");
  }
}

describe("Creative and Policy resolver boundaries", () => {
  it("does not silently erase a Preset root's policy", () => {
    rejectContent(() => resolve({ root }));
  });

  it("does not admit a Preset through a pinned Creative dependency", () => {
    const content = level0Character({
      id: tid("cr", 2),
      ref: "@djj/bob",
      references: [
        {
          id: "policy",
          mode: "default",
          use: creation.ref,
          pin: { release: root.release, semantic_digest: root.semantic_digest },
        },
      ],
    });
    rejectContent(() =>
      resolve({
        root: { release: tid("rel", 2), visibility: "public", creation: content },
        dependencies: [root],
      }),
    );
  });

  it("publishes Presets through a policy artifact without manufacturing content IR", () => {
    const report = checkPublish({
      ...root,
      label: "v1",
      dependencies: [],
      registry: {
        existingLabels: {},
        assetStatus: {},
        blockedDigests: new Set(),
        ownerNamespaces: new Set(["djj"]),
      },
    });
    expect(report.ok).toBe(true);
    expect(report.resolved).toBeUndefined();
    expect(report.artifact?.kind).toBe("preset");
  });
});

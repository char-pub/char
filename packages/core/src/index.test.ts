import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.js";

describe("core", () => {
  it("exports a version", () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

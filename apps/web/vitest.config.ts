import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

const sourceConditions = ["@char-pub/source", "module", "browser", "import", "default"];

export default defineProject({
  plugins: [react()],
  resolve: {
    conditions: sourceConditions,
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    name: "web",
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
  },
});

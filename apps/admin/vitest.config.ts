import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    name: "admin",
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
  },
});

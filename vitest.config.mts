import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: { include: ["tests/**/*.test.ts"], env: { BOULDLEADS_DATA_DIR: path.resolve(import.meta.dirname, "tests/.data") } },
});

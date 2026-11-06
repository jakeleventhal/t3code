import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["scripts/personal-background.ts"],
    outDir: "dist-personal",
    platform: "node",
    format: "esm",
    target: "node24",
    clean: true,
    deps: { alwaysBundle: () => true, onlyBundle: false },
  },
});

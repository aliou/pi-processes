import { defineConfig } from "tsup";

export default defineConfig({
  entry: { durable: "durable/index.ts" },
  format: ["esm"],
  target: "node22",
  clean: true,
  splitting: false,
  external: ["@earendil-works/pi-durable", "@earendil-works/chord"],
  dts: true,
});

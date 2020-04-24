import typescript from "@rollup/plugin-typescript";
import wasm from "@rollup/plugin-wasm";

export default {
  input: "src/index.ts",
  output: {
    dir: "dist",
    format: "iife",
  },
  plugins: [wasm(), typescript()], // the typescript plugin automatically reads tsconfig.json
};

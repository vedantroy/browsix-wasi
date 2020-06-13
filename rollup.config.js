import typescript from "@rollup/plugin-typescript";
//import wasm from "@rollup/plugin-wasm";
import nodePolyfills from 'rollup-plugin-node-polyfills'
import resolve from "@rollup/plugin-node-resolve";
import commonJS from "@rollup/plugin-commonjs";
import internal from "rollup-plugin-internal";

export default {
  input: "src/index.ts",
  output: {
    dir: "dist",
    format: "iife",
  },
  plugins: [
    //nodePolyfills(),
    resolve(),
    commonJS({ include: "node_modules/**/*" }),
    //wasm(),
    typescript(),
    internal(["@wasmer/wasi", "@wasmer/wasm-transformer"]),
  ], // the typescript plugin automatically reads tsconfig.json
};

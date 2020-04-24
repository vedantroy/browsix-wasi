# WASI Wrapper for Browsix

A JavaScript wrapper that lets WASI-compatible WebAssembly programs run in Browsix.

## Instructions
- Compile a program to WASI compatible WebAssembly using Clang/[wasi-sdk](https://github.com/WebAssembly/wasi-sdk)
- Rename the file to "program.wasm" and place it in the "src" directory
- Execute `yarn install && yarn run build`
- In "index.js" replace `window.atob` with `atob` (`@rollup/plugin-wasm` does not support Web Workers)
    - index.js will embed your wasm

## Caveats
Right now, only `fd_write` and `proc_exit` are supported. The generated WebAssembly should explicitly call `proc_exit`.
// @rollup/plugin-wasm creates a function with the name of your import
// inside this function, your wasm is inlined as a string
// if you pass in an import object, the function will compile and instantiate
// the wasm. Otherwise, it just compiles it into a module. We want the module (not the
// instance), so we declare the type signature as accepting no parameters
declare const loadWasm: () => Promise<WebAssembly.Module>;
export default loadWasm;

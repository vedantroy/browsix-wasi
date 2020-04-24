// Technical notes:
// we wait for an init function
// then we allocate shared memory and use personality changed to signal
// send over this shared memory

// Inside of the compiled helper, you will need to replace "window.atob"
// with just "atob" b/c "window" is not defined for web workers
import loadProgram from "./program.wasm";
import {
  PER_BLOCKING,
  MAX_SHARE_BYTES,
  SIGNAL_OFFSET,
  DATA_OFFSET,
  SYS,
  WasiError,
} from "./constants";

type InitSignalArgs = [
  // Command line arguments. The first one always exists,
  // and is the name of the program. The rest are optional.
  [string, ...string[]],
  // Environment variables
  { [name: string]: string },
  // debug flag
  boolean,
  // process id (pid)
  number,
  // TODO-VED: Fill in these types. Or maybe not b/c
  // these entries are only used by "fork", which is not implemented in WASI
  unknown,
  unknown
];

interface SignalEventData {
  id: number;
  name: string;
  // Currently, the kernel will only ever send the "init" signal
  // so we could just do "args: InitSignalArgs"
  args: unknown[];
}

// https://stackoverflow.com/questions/33800497/check-if-an-object-implements-an-interface-at-runtime-with-typescript
function isBrowsixEventData(obj: any): obj is SignalEventData {
  // TODO-VED: This assumes that "id" and "args" are not null and that args
  // is an array. This seems like a reasonable assumption, but confirm.
  return (
    typeof obj.id === "number" &&
    // name can be undefined if the event is representing the completion of an
    // async system call
    (typeof obj.name === "string" || obj.name === undefined) &&
    Array.isArray(obj.args)
  );
}

class BrowsixWASI {
  constructor(workerScope: WorkerGlobalScope & typeof globalThis) {
    this.workerScope = workerScope;
    this.workerScope.onmessage = this.handleKernelMessage;
  }

  workerScope: WorkerGlobalScope & typeof globalThis;
  // $wasmer-js means:
  // Taken from or based off of
  // https://github.com/wasmerio/wasmer-js
  // commit: 1e4db4a21e81eb3f6be0a423d3904687180951b7

  // $wasmer-js index.ts
  private memory: WebAssembly.Memory;
  private view: DataView;

  // WebAssembly controls the memory completely, so we copy
  // values used by Browsix into a SharedArrayBuffer
  // and copy them back after we are done
  private sharedData = new SharedArrayBuffer(MAX_SHARE_BYTES);

  private instance: WebAssembly.Instance;

  // All messages from the Browsix kernel are handled here

  // $wasmer-js index.ts
  private setMemory(memory: WebAssembly.Memory) {
    this.memory = memory;
  }

  // $wasmer-js index.ts
  private refreshMemory() {
    // TODO-VED: Understand exactly why the second condition is needed
    // (Probably if we call "refreshMemory" before "start")
    // or if the wasm calls memory.grow
    if (!this.view || this.view.buffer.byteLength === 0) {
      this.view = new DataView(this.memory.buffer);
    }
  }

  // $wasmer-js index.ts
  /**
   * @param iovs location of first ciovec in array
   * @param iovsLen number of ciovecs
   * @returns the buffers pointed to by the ciovecs
   */
  /*
  private getIovsBuffers(iovs: number, iovsLen: number): Uint8Array[] {
    this.refreshMemory();
    const buffers = [];
    for (
      let ptrToCurIovec = iovs;
      ptrToCurIovec < iovs + iovsLen * 8;
      ptrToCurIovec += 8
    ) {
      const bufStart = this.view.getUint32(ptrToCurIovec, true);
      const bufLen = this.view.getUint32(ptrToCurIovec + 4, true);
      buffers.push(new Uint8Array(this.memory.buffer, bufStart, bufLen));
    }
    return buffers;
  }
  */

  // copy the contents of the buffers referenced by the iov vectors to the SharedArrayBuffer
  // starting at DATA_OFFSET
  private copyIovsBuffers(iovsPtr: number, iovsLen: number): number {
    this.refreshMemory();
    /**
     * ciovec {
     *    bufStart: i32 (address of start of string)
     *    bufLen: i32 (length of string in bytes)
     * }
     *
     * Each i32 is 4 bytes. Hence a ciovec is 8 bytes long.
     */
    const iovSize = 8;
    const iovsEnd = iovsPtr + iovsLen * iovSize;
    let bytesCopied = 0;

    for (let curIovPtr = iovsPtr; curIovPtr < iovsEnd; curIovPtr += iovSize) {
      const bufStart = this.view.getUint32(curIovPtr, true);
      const bufLen = this.view.getUint32(curIovPtr + 4, true);
      // this shouldn't create an intermediate copy b/c Uint8Array is a "view" on the data
      // A Uint8 is 1 byte, so this copies bytes from wasm memory to the SharedArrayBuffer
      new Uint8Array(this.sharedData).set(
        new Uint8Array(this.memory.buffer, bufStart, bufLen),
        DATA_OFFSET + bytesCopied
      );
      bytesCopied += bufLen;
    }
    return bytesCopied;
  }

  // The Browsix kernel runs on a separate thread and communicates
  // through messages. If not assigned in the constructor, assign this function
  // to self.onmessage. TODO-VED: Should we validate that msg is of type MessageEvent?
  // It seems like the compile time check is sufficient
  public readonly handleKernelMessage = (msg: MessageEvent) => {
    const { data } = msg;
    if (isBrowsixEventData(data)) {
      const { name } = data;
      if (name) {
        const handler = this.handlers[name];
        if (handler) handler(data.args);
        else console.log(`Unhandled signal: ${name}`);
      } else {
        // The message must be indicating the completion of an async syscall
        // Execute the corresponding callback
        this.complete(data.id, data.args);
      }
    } else {
      console.log("Malformed/unrecognizable message:");
      console.log(msg);
    }
  };

  private handlers = {
    // TODO-VED: We are assuming that the args array
    // is properly shaped. Don't assume this.
    init: async (args: InitSignalArgs) => {
      console.log(`Recieved "init" signal`);
      if (typeof SharedArrayBuffer !== "function")
        throw new Error(
          "The Browsix WASI wrapper requires SharedArrayBuffer support"
        );
      const module = await this.getWasmModule();
      this.instance = await WebAssembly.instantiate(module, {
        ...this.getImports(module),
      });
      // TODO-VED: Create a wrapper that accepts a callback as an input
      // and returns a callback that does error checking
      this.makeAsyncSysCall(
        (err: number) => {
          if (err) {
            console.log(`"Personality" async syscall returned error: ${err}`);
            // TODO-VED: In the original implementation, there was some fancy machinery
            // to ensure "ready" (which eventually lead to the program starting)
            // only got emitted once. I didn't see the need. Confirm this is ok.
          } else this.start();
        },
        "personality",
        [
          PER_BLOCKING,
          this.sharedData, // we need to let the kernel know about our SharedArrayBuffer
          SIGNAL_OFFSET,
        ]
      );
    },
  };

  /**
   * Finishes an async syscall.
   */
  private complete(id: number, args: unknown[]) {
    const callback = this.outstanding.get(id);
    this.outstanding.delete(id);
    // if the callback is an arrow function, then the this parameter
    // (which is undefined here) will be ignored
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions
    if (callback) callback.apply(undefined, args);
    else {
      console.log(`Unknown callback for msg with id: ${id} and args:`);
      console.log(args);
    }
  }

  // TODO-VED: Call this "getAndCompileWasm" instead?
  public getWasmModule: () => Promise<WebAssembly.Module> = loadProgram;

  // Wrapping msgId in an IIFE/closure creates
  // a variable that is private to even its own class!
  nextMsgId = (() => {
    // TODO-VED: Why start at 2, and not 0?
    let sequentialMessageId = 2;
    return () => sequentialMessageId++;
  })();

  // Stores the callbacks that are executed once a async sys call finishes
  // Side note: WASI seems to have very few async calls? *Most* "async calls"
  // are just signals to the Browsix kernel (not WASI sys calls)
  private outstanding = new Map<number, Function>();

  private makeAsyncSysCall(
    // callbacks are invoked through a hashmap at runtime, so there is
    // no type checking on the parameter type/even number of parameters. You
    // just need to trust the kernel :(. This is why the type is "Function".
    callback: Function,
    sysCallName: string,
    args: unknown[],
    transferrables?: Transferable[]
  ) {
    const id = this.nextMsgId();
    this.outstanding.set(id, callback);
    // TODO-Ved: Should we pass in self into the constructor of this class?
    this.workerScope.postMessage(
      { id, name: sysCallName, args },
      transferrables !== undefined ? transferrables : []
    );
  }

  private makeSyncSysCall(
    trap: number,
    ...args: [number?, number?, number?, number?, number?, number?]
  ) {
    // fill indexes from args.length to 5 with 0s
    const filledArgs = args.concat(Array(6 - args.length).fill(0));
    // TODO-VED: Should this be moved outside?
    const heap32 = new Int32Array(this.sharedData);
    Atomics.store(heap32, SIGNAL_OFFSET, 0);
    this.workerScope.postMessage({ trap, args: filledArgs });

    // TODO-VED: What is the point of this paranoid stuff?/need example scenario
    const paranoid = Atomics.load(heap32, SIGNAL_OFFSET);
    if (paranoid !== 1 && paranoid !== 0) {
      console.error(
        `WARN: someone wrote over our futex alloc('${SIGNAL_OFFSET}'): ${paranoid}`
      );
      debugger;
    }

    // wait until the 32 bit integer at SIGNAL_OFFSET is not 0
    Atomics.wait(heap32, SIGNAL_OFFSET, 0);
    // Reset for the next system call
    // TODO-VED: Why is this needed? Don't we reset anyway?
    Atomics.store(heap32, SIGNAL_OFFSET, 0);
    return Atomics.load(heap32, SIGNAL_OFFSET + 1);
  }

  // $wasmer-js index.ts with significant modifications for Browsix.
  // API spec: https://github.com/WebAssembly/WASI/blob/master/phases/snapshot/docs.md
  // Using snapshot_1.
  // WASI doesn't support multiple return values, so
  // return values after the first one are converted into pointer parameters.
  // Arrays are converted into 2 parameters: pointer to start and length.
  // TODO-VED: Browsix sys calls return 1 value, but WASI sys calls can have
  // multiple return values.
  wasiImports = {
    /**
     * @param nwrittenPtr - address to write number of bytes written.
     */
    fd_write: (
      fd: number,
      iovsPtr: number,
      iovsLen: number,
      nwrittenPtr: number
    ) => {
      const bytesCopied = this.copyIovsBuffers(iovsPtr, iovsLen);

      const returnCode = this.makeSyncSysCall(
        SYS.WRITE,
        fd,
        DATA_OFFSET,
        bytesCopied
      );
      if (returnCode >= 0) this.view.setUint32(nwrittenPtr, returnCode, true);
      return WasiError.SUCCESS;
    },
    proc_exit: (rval: number) => {
      this.makeSyncSysCall(SYS.EXIT, rval);
    },
  };

  // $wasmer-js index.ts
  start() {
    const exports = this.instance.exports;
    if (exports === null || typeof exports !== "object") {
      throw new Error(
        `instance.exports must be an Object. Received ${exports}.`
      );
    }
    const { memory } = exports;
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error(
        `instance.exports.memory must be a WebAssembly.Memory. Recieved ${memory}.`
      );
    }

    this.setMemory(memory);
    // in WASI, _start is conventionally the entrypoint to the program
    if (exports._start) {
      (exports as any)._start();
    } else
      throw new Error(`WebAssembly instance does not have "_start" method.`);
  }

  // $wasmer-js index.ts
  private static getImportNamespace(module: WebAssembly.Module): string {
    let namespace = null;
    // TODO-VED: If "imp" is short for "import", then rename imp to import
    for (let imp of WebAssembly.Module.imports(module)) {
      // We only check for the functions
      if (imp.kind !== "function") {
        continue;
      }
      // We allow functions in other namespaces other than wasi
      if (!imp.module.startsWith("wasi_")) {
        continue;
      }
      if (!namespace) {
        namespace = imp.module;
      } else {
        if (namespace !== imp.module) {
          throw new Error("Multiple namespaces detected.");
        }
      }
    }
    return namespace!;
  }

  //$wasmer-js index.ts
  private getImports(
    module: WebAssembly.Module
    // TODO-VED: We can probably type this better
  ): {
    [wasiImportNamespace: string]: { [importedFunctionName: string]: Function };
  } {
    const namespace = BrowsixWASI.getImportNamespace(module);
    const validNamespaces = new Set<string>([
      "wasi_unstable",
      "wasi_snapshot_preview1",
    ]);
    if (!validNamespaces.has(namespace)) {
      throw new Error(
        "Can't detect a WASI namespace for the WebAssembly Module"
      );
      // TODO-VED: Right now, we return the same WASI imports,
      // regardless of the namespace. Check if this is ok.
    } else return { [namespace]: this.wasiImports };
  }
}

new BrowsixWASI(self);
/*
// Put your initialization code here
function main() {
  const wasi = new BrowsixWASI(self);
  self.onmessage = wasi.handleKernelMessage;
  wasi.getWasmModule = async () => {
      console.log(wasm)
    // TODO-VED: Right now, we hardcode in the wasm URL because of this:
    // https://stackoverflow.com/questions/60836401/failed-to-execute-fetch-on-workerglobalscope
    // Fix this issue by making Browsix send the origin URL
    const response = await fetch("http://localhost:5000/fs/usr/bin/hello.wasm");
    const responseArrayBuffer = await response.arrayBuffer();

    // Instantiate the WebAssembly file
    const wasm_bytes = new Uint8Array(responseArrayBuffer).buffer;
    return WebAssembly.compile(wasm_bytes);
  };
}
main();
*/

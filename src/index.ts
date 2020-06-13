/**
 * @wasmer/wasi is designed to run on Node.js or the browser.
 * We implement the basic node methods so @wasmer/wasi can work.
 *
 * We also need to
 * - receive the "init" signal and send back a response in the form of the "personality" async
 * system call.
 * - recieve the response from the personality system call and start the actual application
 *
 * All WASI calls are synchronous, so there's no point in handling any other signal/async
 * system call.
 */
import {
  WASI,
  WASIBindings,
  WASIExitError,
  WASIKillError,
  WASIEnv,
  WASIArgs,
} from "@wasmer/wasi";
//import bindings from "@wasmer/wasi/lib/bindings/browser"
import { lowerI64Imports } from "@wasmer/wasm-transformer";
import { PER_BLOCKING, SIGNAL_OFFSET, MAX_SHARE_BYTES } from "./constants";
import { NodeFSBindings, OtherBindings } from "./bindings";
import minimist from "minimist";

// Node-bindings initialization
const sharedData = new SharedArrayBuffer(MAX_SHARE_BYTES);

// Signal-handling initialization
interface SignalEventData {
  id: number;
  // signals are named, everything else is a response
  // to a message _we_ sent. The "init" message (that
  // has our args + environment) is also a signal.
  name?: string;
  // Currently, the kernel will only ever send the "init" signal
  // so we could just do "args: InitSignalArgs"
  args: unknown[];
}

function isBrowsixEventData(obj: any): obj is SignalEventData {
  return (
    typeof obj.id === "number" &&
    (typeof obj.name === "string" || obj.name === undefined) &&
    Array.isArray(obj.args)
  );
}

function processArgs(
  args: string[]
): [string, string[], Record<string, string>] {
  const format = `[exe name] [wasm file name] --arg ARG_1_NAME --arg ARG_2_NAME ... --dir IN_PROGRAM_PATH_1:REAL_PATH_1 ...`;
  const argv = minimist(args.slice(1));
  if (argv._.length !== 1) {
    throw new Error(`missing wasm file name. Correct format: ${format}`);
  }
  const wasmFileName = argv._[0];
  let programArgs: Array<string> = argv.arg === undefined ? [] : argv.arg;
  if (!Array.isArray(programArgs)) {
    programArgs = [programArgs];
  }
  programArgs.unshift(wasmFileName);
  let dirMappings = argv.dir === undefined ? [] : argv.dir;
  if (!Array.isArray(dirMappings)) {
    dirMappings = [dirMappings];
  }
  const preopens: { [key: string]: string } = {};
  for (const mapping of dirMappings) {
    let paths = mapping.split(":");
    if (paths.length !== 2) {
      throw new Error(
        `Arg: ${mapping} had invalid format. It should be <in_program_path>:<real_path>`
      );
    }
    let [fake, real] = paths;
    if (fake === "$") {
      fake = real;
      console.log(`using $ shortcut to set fake path to: ${real}`);
    }
    preopens[fake] = real;
  }
  return [wasmFileName, programArgs, preopens];
}

let personalityCallback: Function | null = null;
globalThis.onmessage = (msg: MessageEvent) => {
  const { data } = msg;
  if (isBrowsixEventData(data)) {
    const { name, args } = data;
    if (name) {
      if (name === "init") {
        personalityCallback = async (err: unknown) => {
          // Unclear what an actual error looks like
          if (!(Array.isArray(err) && err.length === 1 && err[0] === null)) {
            console.log(
              `"Personality" async syscall returned error: ${JSON.stringify(
                err
              )}`
            );
          } else {
            const fs = new NodeFSBindings(sharedData);
            const misc = new OtherBindings(sharedData);
            const [wasmFileName, programArgs, preOpenedDirs] = processArgs(
              args[0] as string[]
            );
            const wasi = new WASI({
              preopens: preOpenedDirs,
              args: programArgs as WASIArgs,
              env: args[1] as WASIEnv,
              // @ts-ignore
              bindings: {
                hrtime: misc.hrtime,
                isTTY: misc.isTTY,
                exit: misc.exit,
                fs,
                //path: bindings.path
              },
            });
            const file_fd = fs.openSync(wasmFileName, fs.constants.O_RDONLY);
            // TODO: stats are broken
            const stats = fs.fstatSync(file_fd)
            const exeSize = 38241 //stats.size
            const MAX_FILE_LEN = 2 << 18;
            if (exeSize > MAX_FILE_LEN) {
                throw new Error(`Executable size: ${exeSize} exceeds max exe size of ${MAX_FILE_LEN}`)
            }
            const fileBuf = new Uint8Array(exeSize);
            fs.readSync(file_fd, fileBuf, 0, exeSize, 0);
            const loweredBytes = await lowerI64Imports(fileBuf);
            const module = await WebAssembly.compile(loweredBytes);
            const instance = await WebAssembly.instantiate(module, {
              ...wasi.getImports(module),
            });
            wasi.start(instance);
          }
        };
        globalThis.postMessage(
          {
            // the id is used for callbacks -- it's not a unique identifier
            // for the personality system call
            id: 2,
            name: "personality",
            args: [PER_BLOCKING, sharedData, SIGNAL_OFFSET],
          },
          []
        );
      } else {
        console.error(
          `Unexpected signal (we only support "init"): ${name}. With data: ${JSON.stringify(
            data
          )}`
        );
      }
    } else {
      personalityCallback!!(data.args);
    }
  } else {
    console.error(
      `Unrecognizable message (was not signal or callback for async system call):`
    );
    console.error(msg);
  }
};

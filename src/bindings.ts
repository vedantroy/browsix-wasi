import * as marshal from "node-binary-marshal";
import { SIGNAL_OFFSET, DATA_OFFSET, SYS, WASI_ESUCCESS } from "./constants";

class Bindings {
  protected readonly shared: SharedArrayBuffer;
  protected readonly dataArray: Uint8Array;

  protected static assertUint8Array(val: any): asserts val is Uint8Array {
    const type = Object.prototype.toString.call(val);
    if (type !== "[object Uint8Array]") {
      debugger;
      throw new Error(
        `Unexpected buffer of type: ${type}. Expected Uint8Array.`
      );
    }
  }

  protected copy(to: Uint8Array, from: Uint8Array, len: number): void {
    to.set(from.slice(0, len));
  }

  protected copyBufferToShared(buffer: NodeJS.ArrayBufferView): void {
    //new Uint8Array(this.shared).set(buffer as Uint8Array, DATA_OFFSET);
    this.dataArray.set(buffer as Uint8Array);
  }

  protected copyStringToShared(s: string): void {
    this.dataArray.set(new TextEncoder().encode(s));
  }

  constructor(shared: SharedArrayBuffer) {
    this.shared = shared;
    this.dataArray = new Uint8Array(this.shared, DATA_OFFSET);
  }
}

const _constants = {
  UV_FS_SYMLINK_DIR: 1,
  UV_FS_SYMLINK_JUNCTION: 2,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  UV_DIRENT_UNKNOWN: 0,
  UV_DIRENT_FILE: 1,
  UV_DIRENT_DIR: 2,
  UV_DIRENT_LINK: 3,
  UV_DIRENT_FIFO: 4,
  UV_DIRENT_SOCKET: 5,
  UV_DIRENT_CHAR: 6,
  UV_DIRENT_BLOCK: 7,
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFCHR: 8192,
  S_IFBLK: 24576,
  S_IFIFO: 4096,
  S_IFLNK: 40960,
  S_IFSOCK: 49152,
  O_CREAT: 64,
  O_EXCL: 128,
  UV_FS_O_FILEMAP: 0,
  O_NOCTTY: 256,
  O_TRUNC: 512,
  O_APPEND: 1024,
  O_DIRECTORY: 65536,
  O_NOATIME: 262144,
  O_NOFOLLOW: 131072,
  O_SYNC: 1052672,
  O_DSYNC: 4096,
  O_DIRECT: 16384,
  O_NONBLOCK: 2048,
  S_IRWXU: 448,
  S_IRUSR: 256,
  S_IWUSR: 128,
  S_IXUSR: 64,
  S_IRWXG: 56,
  S_IRGRP: 32,
  S_IWGRP: 16,
  S_IXGRP: 8,
  S_IRWXO: 7,
  S_IROTH: 4,
  S_IWOTH: 2,
  S_IXOTH: 1,
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  UV_FS_COPYFILE_EXCL: 1,
  COPYFILE_EXCL: 1,
  UV_FS_COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE: 2,
  UV_FS_COPYFILE_FICLONE_FORCE: 4,
  COPYFILE_FICLONE_FORCE: 4,
};
Object.freeze(_constants);

// These must simulate normal Node apis.
// They are not WASI aware.
export class NodeFSBindings extends Bindings {
  // copied from node
  public readonly constants = _constants;

  constructor(shared: SharedArrayBuffer) {
    super(shared);
  }

  public writeSync(
    fd: number,
    buffer: Uint8Array /* NodeJS.ArrayBufferView */,
    offset?: number,
    length?: number | null,
    position?: number | null
  ): number {
    offset = offset === undefined ? 0 : offset;
    length =
      length === undefined || length === null
        ? buffer.byteLength - offset
        : length;
    this.copyBufferToShared(buffer);

    if (position !== null) {
      console.warn(`Position had value: ${position} even though it is ignored`);
    }

    const returnVal = makeSyncSysCall(
      this.shared,
      SYS.WRITE,
      fd,
      DATA_OFFSET,
      length
    );
    if (returnVal >= 0) return returnVal;
    else {
      // TODO: Map these into node errors
      throw new Error(`returnVal: ${returnVal}`);
    }
  }

  public closeSync(fd: number): void {
    const result = makeSyncSysCall(this.shared, SYS.CLOSE, fd);
    if (result !== 0) {
      debugger;
      // throw an error based on the browsix system return codes
      throw new Error(`Close failed with: ${result}`);
    }
  }

  public openSync(path: string, flags: number | undefined): number {
    this.copyStringToShared(path);
    if (flags === undefined) {
      console.error(`No flags were passed to open`);
      debugger;
    }
    const result = makeSyncSysCall(this.shared, SYS.OPEN, DATA_OFFSET, flags);
    if (result >= 0) return result;
    else {
      throw new Error(`returnVal: ${result}`);
    }
  }

  public fstatSync(fd: number): Stats {
    //console.log(`fstat is being called: ${fd}`);
    const returnVal = makeSyncSysCall(this.shared, SYS.FSTAT64, fd);
    if (returnVal < 0) {
      throw new Error(`fstatSync returned error: ${returnVal}`);
    }

    const stats = new Stats();
    const view = new DataView(this.shared, DATA_OFFSET);
    const [len, err] = marshal.Unmarshal(stats, view, 0, marshal.fs.StatDef);
    //console.log(len)
    if (err) {
      throw err;
    }
    stats._updateBirthtime();
    return stats;
  }

  public readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): number {
    position = position === null ? 0 : position;
    if (position !== 0) {
      throw new Error(
        `readSync does not support a non-zero offset. Recieved position of: ${offset}`
      );
    }
    const returnVal = makeSyncSysCall(
      this.shared,
      SYS.READ,
      fd,
      DATA_OFFSET + offset,
      length
    );
    if (returnVal !== length) {
      throw new Error(
        `readSync did not read full amount of bytes. This is bad because readSync doesn't support a non-zero position.`
      );
    }
    Bindings.assertUint8Array(buffer);
    this.copy(buffer, this.dataArray, length);
    return returnVal;
  }
}

export class Stats {
  dev: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  blksize: number;
  ino: number;
  size: number;
  blocks: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;

  constructor() {}

  _updateBirthtime(): void {
    let oldest = this.atime;
    if (this.mtime < oldest) oldest = this.mtime;
    if (this.ctime < oldest) oldest = this.ctime;
  }

  _checkModeProperty(property: any): boolean {
    return (this.mode & _constants.S_IFMT) === property;
  }

  isDirectory(): boolean {
    return this._checkModeProperty(_constants.S_IFDIR);
  }

  isFile(): boolean {
    return this._checkModeProperty(_constants.S_IFREG);
  }

  isBlockDevice(): boolean {
    return this._checkModeProperty(_constants.S_IFBLK);
  }

  isCharacterDevice(): boolean {
    return this._checkModeProperty(_constants.S_IFCHR);
  }

  isSymbolicLink(): boolean {
    return this._checkModeProperty(_constants.S_IFLNK);
  }

  isFIFO(): boolean {
    return this._checkModeProperty(_constants.S_IFIFO);
  }

  isSocket(): boolean {
    return this._checkModeProperty(_constants.S_IFSOCK);
  }
}

// These directly interact with the WASI layer.
// They are WASI aware.
// The methods in this class are directly used (instead of being called by an instance)
// so they must be arrow functions that capture the "this" value.
export class OtherBindings extends Bindings {
  public isTTY: () => true;
  public kill(signal: string) {}
  public exit = (code: number | null) => {
    if (code === null) {
      console.warn(`Recieved null return value, setting it to 0`);
      debugger;
      code = 0;
    }
    makeSyncSysCall(this.shared, SYS.EXIT, code);
    return WASI_ESUCCESS;
  };
  public hrtime() {
    // TODO: Actual bindings
    return BigInt(0);
  }
}

function makeSyncSysCall(
  sharedData: SharedArrayBuffer,
  trap: number,
  ...args: [number?, number?, number?, number?, number?, number?]
) {
  //debugger;
  // fill indexes from args.length to 5 with 0s
  const filledArgs = args.concat(Array(6 - args.length).fill(0));
  // TODO-VED: Should this be moved outside?
  const heap32 = new Int32Array(sharedData);
  Atomics.store(heap32, SIGNAL_OFFSET, 0);
  globalThis.postMessage({ trap, args: filledArgs });

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

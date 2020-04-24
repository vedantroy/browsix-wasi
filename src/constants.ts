// # Browsix Constants
// A magic number that is a parameter for the "personality" sys call in Browsix/Linux
// The other option is PER_KIND, which causes "personality" to return -EINVAL
// TODO-VED: What does this number actually mean/what is its significance?
export const PER_BLOCKING = 0x80;
export const MAX_SHARE_BYTES = 1024;
// Use bytes 0-7 to store 2 32-bit ints
// the first one is for signaling that a sys call has finished
// the 2nd is the return value of the sys call
export const SIGNAL_OFFSET = 0;
// Use bytes 8-11 to store a 32-bit int for disrupting sleep?
export const SLEEP_OFFSET = 8;
// Bytes 12 and onwards can be used to store data
export const DATA_OFFSET = 12;

// sys call codes? These aren't real Linux sys call codes,
// rather, they map to a table in kernel.ts. I don't know why Browsix
// doesn't use the actual linux system call codes
export enum SYS {
  WRITE = 4,
  EXIT = 252,
}

// # WASI Constants
export enum WasiError {
  SUCCESS = 0,
}

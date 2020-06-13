// # Browsix Constants
// A magic number that is a parameter for the "personality" sys call in Browsix/Linux
// The other option is PER_KIND, which causes "personality" to return -EINVAL
// TODO-VED: What does this number actually mean/what is its significance?
export const PER_BLOCKING = 0x80;
export const MAX_SHARE_BYTES = 2 << 19;
// Use bytes 0-7 to store 2 32-bit ints
// the first one is for signaling that a sys call has finished
// the 2nd is the return value of the sys call
export const SIGNAL_OFFSET = 0;
// Use bytes 8-11 to store a 32-bit int for disrupting sleep?
export const SLEEP_OFFSET = 8;
// Bytes 12 and onwards can be used to store data
export const DATA_OFFSET = 12;

export enum SYS {
  READ = 3,
  WRITE = 4,
  OPEN = 5,
  CLOSE = 6,
  FSTAT64 = 197,
  EXIT = 252,
}

export const WASI_ESUCCESS = 0;

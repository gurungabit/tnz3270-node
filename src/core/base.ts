/**
 * Base types and utilities for TNZ core modules.
 * This file helps avoid circular dependencies between tnz.ts and its sub-modules.
 */

/** General Tnz error. */
export class TnzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TnzError';
  }
}

/** Error that may be related to terminal characteristics. */
export class TnzTerminalError extends TnzError {
  constructor(message: string) {
    super(message);
    this.name = 'TnzTerminalError';
  }
}

/** Error processing file transfer. */
export class TnzTransferError extends TnzError {
  constructor(message: string) {
    super(message);
    this.name = 'TnzTransferError';
  }
}

/** 3270 data stream read state. */
export enum ReadState {
  NORMAL = 'NORMAL',
  RENTER = 'RENTER',
  RREAD = 'RREAD',
}

/**
 * Translate 6-bit control integer to printable EBCDIC byte value.
 *
 * Used for buffer address encoding where bits 0-1 are reserved.
 * See figure D-1 in 3270 Data Stream Programmers Reference.
 *
 */
export function bit6(controlInt: number): number {
  controlInt &= 0x3f; // zero bits 0,1
  const cc11 = controlInt | 0xc0; // bits 0,1 = 11

  if (controlInt === 48) return cc11; // 11 0000 -> 0xF0

  const cc01 = controlInt | 0x40; // bits 0,1 = 01

  if (controlInt === 33) return cc01; // 10 0001 -> 0x61

  if ((controlInt & 0x0f) > 0 && (controlInt & 0x0f) < 10) {
    return cc11; // low nibble 1-9
  }

  return cc01;
}

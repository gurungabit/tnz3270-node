/**
 * Stateless telnet negotiation helpers.
 *
 * Provides IAC sequence parsing, packet building, and IAC escaping/unescaping.
 * All functions are pure — no side effects, no state.
 *
 * Reference: RFC 854 (Telnet), RFC 855 (Options), RFC 2355 (TN3270E)
 *
 * @module core/telnet
 */

import { TELNET } from '../types';

// ---------------------------------------------------------------------------
// IAC sequence parsing
// ---------------------------------------------------------------------------

/**
 * Describes a single IAC command sequence found in a buffer.
 *
 */
export interface IacMatch {
  /** Byte offset where the IAC sequence starts */
  start: number;
  /** Byte offset past the end of the IAC sequence */
  end: number;
  /** The command byte (second byte after IAC) */
  command: number;
  /** The option byte (third byte), present for WILL/WONT/DO/DONT */
  option?: number;
}

/**
 * Find all IAC command sequences in a buffer.
 *
 * - IAC followed by a byte in 0x00-0xFA or 0xFF → 2-byte sequence
 * - IAC followed by WILL/WONT/DO/DONT (0xFB-0xFE) + option → 3-byte sequence
 *
 * @param buf - Buffer to scan
 * @returns Array of IAC match descriptors
 */
export function findIacSequences(buf: Buffer): IacMatch[] {
  const matches: IacMatch[] = [];
  let i = 0;
  while (i < buf.length - 1) {
    if (buf[i] !== TELNET.IAC) {
      i++;
      continue;
    }

    const cmd = buf[i + 1];

    if (cmd >= 0xfb && cmd <= 0xfe) {
      // 3-byte: IAC + WILL/WONT/DO/DONT + option
      if (i + 2 >= buf.length) break; // incomplete
      matches.push({
        start: i,
        end: i + 3,
        command: cmd,
        option: buf[i + 2],
      });
      i += 3;
    } else {
      // 2-byte: IAC + command/data (0x00-0xFA or 0xFF)
      matches.push({
        start: i,
        end: i + 2,
        command: cmd,
      });
      i += 2;
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// IAC escaping / unescaping
// ---------------------------------------------------------------------------

/**
 * Escape IAC bytes in data for transmission.
 * Replaces every 0xFF with 0xFF 0xFF.
 *
 */
export function escapeIac(data: Buffer): Buffer {
  // Fast path: no IAC bytes
  if (!data.includes(0xff)) return data;

  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    result.push(data[i]);
    if (data[i] === 0xff) {
      result.push(0xff);
    }
  }
  return Buffer.from(result);
}

/**
 * Unescape IAC sequences in received record data.
 * - IAC IAC (0xFF 0xFF) → single 0xFF
 * - Other IAC sequences are removed (shouldn't appear in record data)
 *
 * where `__repl` returns b"\xff" for IAC IAC, b"" for everything else.
 */
export function unescapeIac(data: Buffer): Buffer {
  // Fast path: no IAC bytes
  if (!data.includes(0xff)) return data;

  const result: number[] = [];
  let i = 0;
  while (i < data.length) {
    if (data[i] === 0xff && i + 1 < data.length) {
      if (data[i + 1] === 0xff) {
        // IAC IAC → single 0xFF
        result.push(0xff);
        i += 2;
      } else if (data[i + 1] >= 0xfb && data[i + 1] <= 0xfe) {
        // 3-byte IAC command — skip entirely
        i += 3;
      } else {
        // 2-byte IAC command — skip entirely
        i += 2;
      }
    } else {
      result.push(data[i]);
      i++;
    }
  }
  return Buffer.from(result);
}

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

/** Build an IAC WILL packet. */
export function buildWill(opt: number): Buffer {
  return Buffer.from([TELNET.IAC, TELNET.WILL, opt]);
}

/** Build an IAC WONT packet. */
export function buildWont(opt: number): Buffer {
  return Buffer.from([TELNET.IAC, TELNET.WONT, opt]);
}

/** Build an IAC DO packet. */
export function buildDo(opt: number): Buffer {
  return Buffer.from([TELNET.IAC, TELNET.DO, opt]);
}

/** Build an IAC DONT packet. */
export function buildDont(opt: number): Buffer {
  return Buffer.from([TELNET.IAC, TELNET.DONT, opt]);
}

/**
 * Build an IAC SB ... IAC SE subnegotiation packet.
 * The value is IAC-escaped automatically.
 */
export function buildSub(value: Buffer): Buffer {
  const escaped = escapeIac(value);
  const result = Buffer.alloc(escaped.length + 4);
  result[0] = TELNET.IAC;
  result[1] = TELNET.SB;
  escaped.copy(result, 2);
  result[result.length - 2] = TELNET.IAC;
  result[result.length - 1] = TELNET.SE;
  return result;
}

/** Build an IAC EOR packet. */
export function buildEor(): Buffer {
  return Buffer.from([TELNET.IAC, TELNET.EOR]);
}

/**
 * Build a single-byte telnet command packet (IAC + command).
 * Valid command codes: 241 (NOP) through 249 (GA).
 *
 * @throws {RangeError} if code is not in 241-249
 */
export function buildCommand(code: number): Buffer {
  if (code < 241 || code > 249) {
    throw new RangeError(`Telnet command ${code} not valid (must be 241-249)`);
  }
  return Buffer.from([TELNET.IAC, code]);
}

// ---------------------------------------------------------------------------
// Option name lookup
// ---------------------------------------------------------------------------

/** Human-readable names for telnet option codes. */
const OPTION_NAMES: Record<number, string> = {
  0x00: 'TRANSMIT-BINARY',
  0x01: 'ECHO',
  0x03: 'SUPPRESS-GO-AHEAD',
  0x06: 'TIMING-MARK',
  0x18: 'TERMINAL-TYPE',
  0x19: 'END-OF-RECORD',
  0x1d: '3270-REGIME',
  0x28: 'TN3270E',
  0x2e: 'START_TLS',
};

/**
 * Get a human-readable name for a telnet option code.
 *
 */
export function optionName(opt: number): string {
  return OPTION_NAMES[opt] ?? `OPT(${opt})`;
}

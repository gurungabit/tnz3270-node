/**
 * Tests for src/core/telnet.ts — stateless telnet helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  findIacSequences,
  escapeIac,
  unescapeIac,
  buildWill,
  buildWont,
  buildDo,
  buildDont,
  buildSub,
  buildEor,
  buildCommand,
  optionName,
} from '../../src/core/telnet';
import { TELNET } from '../../src/types';

describe('telnet', () => {
  describe('findIacSequences', () => {
    it('returns empty array for data with no IAC', () => {
      const buf = Buffer.from([0x00, 0x41, 0x42, 0x43]);
      expect(findIacSequences(buf)).toEqual([]);
    });

    it('finds 2-byte IAC commands', () => {
      // IAC NOP (0xFF 0xF1)
      const buf = Buffer.from([0xff, 0xf1]);
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({ start: 0, end: 2, command: 0xf1 });
    });

    it('finds IAC IAC (escaped 0xFF data)', () => {
      const buf = Buffer.from([0x41, 0xff, 0xff, 0x42]);
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({ start: 1, end: 3, command: 0xff });
    });

    it('finds 3-byte IAC DO/WILL/WONT/DONT sequences', () => {
      // IAC DO BINARY (0xFF 0xFD 0x00)
      const buf = Buffer.from([0xff, 0xfd, 0x00]);
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({
        start: 0,
        end: 3,
        command: 0xfd,
        option: 0x00,
      });
    });

    it('finds IAC WILL', () => {
      const buf = Buffer.from([0xff, 0xfb, 0x18]); // WILL TERMINAL-TYPE
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(1);
      expect(matches[0].command).toBe(TELNET.WILL);
      expect(matches[0].option).toBe(TELNET.OPT_TERMINAL_TYPE);
    });

    it('finds IAC WONT', () => {
      const buf = Buffer.from([0xff, 0xfc, 0x28]); // WONT TN3270E
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(1);
      expect(matches[0].command).toBe(TELNET.WONT);
      expect(matches[0].option).toBe(TELNET.OPT_TN3270E);
    });

    it('finds IAC DONT', () => {
      const buf = Buffer.from([0xff, 0xfe, 0x19]); // DONT EOR
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(1);
      expect(matches[0].command).toBe(TELNET.DONT);
      expect(matches[0].option).toBe(TELNET.OPT_EOR);
    });

    it('finds IAC SB and IAC SE', () => {
      // IAC SB ... IAC SE
      const buf = Buffer.from([0xff, 0xfa, 0x18, 0x01, 0xff, 0xf0]);
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(2);
      expect(matches[0]).toEqual({ start: 0, end: 2, command: 0xfa }); // SB
      expect(matches[1]).toEqual({ start: 4, end: 6, command: 0xf0 }); // SE
    });

    it('finds IAC EOR', () => {
      const buf = Buffer.from([0x41, 0x42, 0xff, 0xef]);
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({ start: 2, end: 4, command: 0xef });
    });

    it('finds multiple sequences in one buffer', () => {
      // IAC DO BINARY, some data, IAC WILL BINARY, IAC EOR
      const buf = Buffer.from([
        0xff, 0xfd, 0x00, // DO BINARY
        0x41, 0x42,       // data
        0xff, 0xfb, 0x00, // WILL BINARY
        0xff, 0xef,       // EOR
      ]);
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(3);
      expect(matches[0].command).toBe(0xfd); // DO
      expect(matches[1].command).toBe(0xfb); // WILL
      expect(matches[2].command).toBe(0xef); // EOR
    });

    it('handles incomplete 3-byte sequence at end', () => {
      // IAC DO but no option byte
      const buf = Buffer.from([0x41, 0xff, 0xfd]);
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(0); // incomplete, skip
    });

    it('handles single IAC at end of buffer', () => {
      const buf = Buffer.from([0x41, 0xff]);
      const matches = findIacSequences(buf);
      expect(matches).toHaveLength(0);
    });
  });

  describe('escapeIac', () => {
    it('returns same buffer when no IAC present', () => {
      const buf = Buffer.from([0x41, 0x42, 0x43]);
      const result = escapeIac(buf);
      expect(result).toBe(buf); // identity — same reference
    });

    it('doubles IAC bytes', () => {
      const buf = Buffer.from([0x41, 0xff, 0x42]);
      const result = escapeIac(buf);
      expect(result).toEqual(Buffer.from([0x41, 0xff, 0xff, 0x42]));
    });

    it('doubles multiple IAC bytes', () => {
      const buf = Buffer.from([0xff, 0xff]);
      const result = escapeIac(buf);
      expect(result).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff]));
    });

    it('handles buffer that is all IAC', () => {
      const buf = Buffer.from([0xff]);
      const result = escapeIac(buf);
      expect(result).toEqual(Buffer.from([0xff, 0xff]));
    });

    it('handles empty buffer', () => {
      const buf = Buffer.alloc(0);
      const result = escapeIac(buf);
      expect(result).toBe(buf); // same reference
    });
  });

  describe('unescapeIac', () => {
    it('returns same buffer when no IAC present', () => {
      const buf = Buffer.from([0x41, 0x42, 0x43]);
      const result = unescapeIac(buf);
      expect(result).toBe(buf);
    });

    it('unescapes IAC IAC to single IAC', () => {
      const buf = Buffer.from([0x41, 0xff, 0xff, 0x42]);
      const result = unescapeIac(buf);
      expect(result).toEqual(Buffer.from([0x41, 0xff, 0x42]));
    });

    it('removes 2-byte IAC commands', () => {
      // IAC NOP should be removed
      const buf = Buffer.from([0x41, 0xff, 0xf1, 0x42]);
      const result = unescapeIac(buf);
      expect(result).toEqual(Buffer.from([0x41, 0x42]));
    });

    it('removes 3-byte IAC commands', () => {
      // IAC DO BINARY should be removed
      const buf = Buffer.from([0x41, 0xff, 0xfd, 0x00, 0x42]);
      const result = unescapeIac(buf);
      expect(result).toEqual(Buffer.from([0x41, 0x42]));
    });

    it('handles empty buffer', () => {
      const buf = Buffer.alloc(0);
      const result = unescapeIac(buf);
      expect(result).toBe(buf);
    });

    it('handles trailing IAC byte', () => {
      const buf = Buffer.from([0x41, 0xff]);
      const result = unescapeIac(buf);
      // Trailing 0xFF with nothing after — kept as-is
      expect(result).toEqual(Buffer.from([0x41, 0xff]));
    });
  });

  describe('packet builders', () => {
    it('buildWill creates correct packet', () => {
      const pkt = buildWill(TELNET.OPT_BINARY);
      expect(pkt).toEqual(Buffer.from([0xff, 0xfb, 0x00]));
    });

    it('buildWont creates correct packet', () => {
      const pkt = buildWont(TELNET.OPT_TN3270E);
      expect(pkt).toEqual(Buffer.from([0xff, 0xfc, 0x28]));
    });

    it('buildDo creates correct packet', () => {
      const pkt = buildDo(TELNET.OPT_EOR);
      expect(pkt).toEqual(Buffer.from([0xff, 0xfd, 0x19]));
    });

    it('buildDont creates correct packet', () => {
      const pkt = buildDont(TELNET.OPT_TERMINAL_TYPE);
      expect(pkt).toEqual(Buffer.from([0xff, 0xfe, 0x18]));
    });

    it('buildSub wraps with IAC SB / IAC SE', () => {
      const sub = buildSub(Buffer.from([0x18, 0x00, 0x49]));
      expect(sub[0]).toBe(0xff); // IAC
      expect(sub[1]).toBe(0xfa); // SB
      expect(sub[2]).toBe(0x18);
      expect(sub[3]).toBe(0x00);
      expect(sub[4]).toBe(0x49);
      expect(sub[sub.length - 2]).toBe(0xff); // IAC
      expect(sub[sub.length - 1]).toBe(0xf0); // SE
    });

    it('buildSub escapes IAC in value', () => {
      const sub = buildSub(Buffer.from([0xff]));
      // IAC SB, 0xFF 0xFF (escaped), IAC SE
      expect(sub).toEqual(
        Buffer.from([0xff, 0xfa, 0xff, 0xff, 0xff, 0xf0]),
      );
    });

    it('buildEor creates IAC EOR', () => {
      const pkt = buildEor();
      expect(pkt).toEqual(Buffer.from([0xff, 0xef]));
    });

    it('buildCommand creates valid command packet', () => {
      const pkt = buildCommand(241); // NOP
      expect(pkt).toEqual(Buffer.from([0xff, 0xf1]));
    });

    it('buildCommand rejects invalid codes', () => {
      expect(() => buildCommand(240)).toThrow(RangeError);
      expect(() => buildCommand(250)).toThrow(RangeError);
    });
  });

  describe('optionName', () => {
    it('returns known option names', () => {
      expect(optionName(0x00)).toBe('TRANSMIT-BINARY');
      expect(optionName(0x18)).toBe('TERMINAL-TYPE');
      expect(optionName(0x19)).toBe('END-OF-RECORD');
      expect(optionName(0x28)).toBe('TN3270E');
      expect(optionName(0x2e)).toBe('START_TLS');
    });

    it('returns formatted unknown option', () => {
      expect(optionName(0x99)).toBe('OPT(153)');
    });
  });
});

/**
 * Tests for src/core/tnz.ts — 3270 command processing, buffer helpers,
 * order processing, WSF, query reply, and screen reading.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Tnz, TnzTerminalError, ReadState, bit6 } from '../../src/core/tnz';
import { AID, CMD, ORDER } from '../../src/types';

// Helper: create a Tnz instance with default 24x80 screen
function createTnz(opts?: { rows?: number; cols?: number }): Tnz {
  const tnz = new Tnz('test');
  if (opts?.rows) {
    tnz.amaxRow = opts.rows;
    tnz.amaxCol = opts.cols ?? 80;
  }
  return tnz;
}

// Helper: build a Write data stream
// CMD + WCC + orders/data
function buildWrite(
  cmd: number,
  wcc: number,
  ordersData: number[],
): Buffer {
  return Buffer.from([cmd, wcc, ...ordersData]);
}

// Helper: encode a 12-bit buffer address for SBA, RA, EUA
function encode12bit(addr: number): [number, number] {
  const high6 = Math.floor(addr / 64);
  const low6 = addr % 64;
  return [bit6(high6), bit6(low6)];
}

describe('Tnz', () => {
  // =========================================================================
  // Static helpers: ucba, rcba
  // =========================================================================

  describe('ucba (update circular byte array)', () => {
    it('copies data into array at start position', () => {
      const dst = new Uint8Array(10);
      Tnz.ucba(dst, 3, [0xaa, 0xbb, 0xcc]);
      expect(dst[3]).toBe(0xaa);
      expect(dst[4]).toBe(0xbb);
      expect(dst[5]).toBe(0xcc);
      expect(dst[2]).toBe(0);
      expect(dst[6]).toBe(0);
    });

    it('wraps around end of array', () => {
      const dst = new Uint8Array(5);
      Tnz.ucba(dst, 3, [0x01, 0x02, 0x03, 0x04]);
      expect(dst[3]).toBe(0x01);
      expect(dst[4]).toBe(0x02);
      expect(dst[0]).toBe(0x03);
      expect(dst[1]).toBe(0x04);
    });

    it('supports begIdx and endIdx range', () => {
      const dst = new Uint8Array(5);
      const src = [0x00, 0xaa, 0xbb, 0xcc, 0x00];
      Tnz.ucba(dst, 0, src, 1, 4);
      expect(dst[0]).toBe(0xaa);
      expect(dst[1]).toBe(0xbb);
      expect(dst[2]).toBe(0xcc);
      expect(dst[3]).toBe(0);
    });

    it('does nothing for zero-length data', () => {
      const dst = new Uint8Array(5).fill(0xff);
      Tnz.ucba(dst, 0, [], 0, 0);
      expect(dst[0]).toBe(0xff);
    });

    it('throws if start >= array length', () => {
      const dst = new Uint8Array(5);
      expect(() => Tnz.ucba(dst, 5, [0x01])).toThrow('start too big');
    });
  });

  describe('rcba (read circular byte array)', () => {
    it('reads a contiguous slice', () => {
      const arr = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
      const result = Tnz.rcba(arr, 1, 4);
      expect([...result]).toEqual([0x02, 0x03, 0x04]);
    });

    it('wraps around when stop < start', () => {
      const arr = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee]);
      const result = Tnz.rcba(arr, 3, 2);
      expect([...result]).toEqual([0xdd, 0xee, 0xaa, 0xbb]);
    });
  });

  // =========================================================================
  // bit6
  // =========================================================================

  describe('bit6', () => {
    it('translates known values correctly', () => {
      expect(bit6(0)).toBe(0x40);
      expect(bit6(48)).toBe(0xf0); // 11 0000
      expect(bit6(33)).toBe(0x61); // 10 0001
    });

    it('applies cc11 for low nibble 1-9', () => {
      expect(bit6(1)).toBe(0xc1);
      expect(bit6(9)).toBe(0xc9);
    });

    it('applies cc01 for other values', () => {
      expect(bit6(10)).toBe(0x4a);
    });
  });

  // =========================================================================
  // Field navigation
  // =========================================================================

  describe('field navigation', () => {
    let tnz: Tnz;

    beforeEach(() => {
      tnz = createTnz();
    });

    describe('_field', () => {
      it('returns [-1, 0] when no fields exist', () => {
        const [addr, val] = tnz._field(10);
        expect(addr).toBe(-1);
        expect(val).toBe(0);
      });

      it('finds the field attribute at addr', () => {
        tnz.planeFa[5] = bit6(0x20); // protected field
        const [addr, val] = tnz._field(5);
        expect(addr).toBe(5);
        expect(val).toBe(bit6(0x20));
      });

      it('scans backwards to find governing field', () => {
        tnz.planeFa[5] = bit6(0x00); // unprotected field
        const [addr] = tnz._field(8);
        expect(addr).toBe(5);
      });
    });

    describe('nextField', () => {
      it('returns [-1, 0] when no fields exist', () => {
        const [addr, val] = tnz.nextField(0);
        expect(addr).toBe(-1);
        expect(val).toBe(0);
      });

      it('finds next field attribute', () => {
        tnz.planeFa[10] = bit6(0x20);
        const [addr] = tnz.nextField(5);
        expect(addr).toBe(10);
      });

      it('wraps around buffer', () => {
        tnz.planeFa[2] = bit6(0x00);
        const [addr] = tnz.nextField(100);
        expect(addr).toBe(2);
      });
    });

    describe('fields iterator', () => {
      it('yields all field attributes', () => {
        tnz.planeFa[5] = bit6(0x20);
        tnz.planeFa[20] = bit6(0x00);
        const result = [...tnz.fields()];
        expect(result.length).toBe(2);
        expect(result[0][0]).toBe(5);
        expect(result[1][0]).toBe(20);
      });
    });

    describe('isProtectedAttr', () => {
      it('returns true for protected fields', () => {
        expect(tnz.isProtectedAttr(0x60)).toBe(true);
      });

      it('returns false for unprotected fields', () => {
        expect(tnz.isProtectedAttr(0x40)).toBe(false);
      });
    });
  });

  // =========================================================================
  // Address encoding/decoding
  // =========================================================================

  describe('address helpers', () => {
    let tnz: Tnz;

    beforeEach(() => {
      tnz = createTnz();
    });

    it('round-trips 12-bit addresses', () => {
      for (const addr of [0, 1, 79, 80, 160, 1919]) {
        const encoded = tnz.addressBytes(addr);
        const decoded = tnz.address(encoded);
        expect(decoded).toBe(addr);
      }
    });

    it('handles 14-bit addresses for large screens', () => {
      tnz.amaxRow = 62;
      tnz.amaxCol = 160;
      tnz.eraseReset(true);
      // 62*160 = 9920, which is > 4095 → 14-bit mode
      const addr = 5000;
      const encoded = tnz.addressBytes(addr);
      const decoded = tnz.address(encoded);
      expect(decoded).toBe(addr);
    });
  });

  // =========================================================================
  // eraseReset
  // =========================================================================

  describe('eraseReset', () => {
    it('resets to default size', () => {
      const tnz = createTnz();
      tnz.amaxRow = 43;
      tnz.amaxCol = 80;
      tnz.eraseReset(false);
      expect(tnz.maxRow).toBe(24);
      expect(tnz.maxCol).toBe(80);
      expect(tnz.bufferSize).toBe(1920);
      expect(tnz.curadd).toBe(0);
    });

    it('resets to alternate size', () => {
      const tnz = createTnz();
      tnz.amaxRow = 43;
      tnz.amaxCol = 80;
      tnz.eraseReset(true);
      expect(tnz.maxRow).toBe(43);
      expect(tnz.maxCol).toBe(80);
      expect(tnz.bufferSize).toBe(3440);
    });

    it('clears all buffer planes', () => {
      const tnz = createTnz();
      tnz.planeDc[0] = 0xc1;
      tnz.planeFa[0] = 0x60;
      tnz.eraseReset(false);
      expect(tnz.planeDc[0]).toBe(0);
      expect(tnz.planeFa[0]).toBe(0);
    });
  });

  // =========================================================================
  // 3270 Write command processing
  // =========================================================================

  describe('Write command processing', () => {
    let tnz: Tnz;

    beforeEach(() => {
      tnz = createTnz();
      // Simulate connection state needed for command processing
      tnz.systemLockWait = true;
    });

    describe('Write (W) command', () => {
      it('processes character data', () => {
        // W + WCC(0x00) + data "AB"
        const data = buildWrite(CMD.WRITE, 0x00, [0xc1, 0xc2]);
        tnz._proc3270ds(data);

        expect(tnz.planeDc[0]).toBe(0xc1); // EBCDIC 'A'
        expect(tnz.planeDc[1]).toBe(0xc2); // EBCDIC 'B'
        expect(tnz.updated).toBe(true);
      });

      it('processes SBA + data', () => {
        const [hi, lo] = encode12bit(160); // row 2, col 0
        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.SBA, hi, lo,
          0xc1, 0xc2, 0xc3,
        ]);
        tnz._proc3270ds(data);

        expect(tnz.planeDc[160]).toBe(0xc1);
        expect(tnz.planeDc[161]).toBe(0xc2);
        expect(tnz.planeDc[162]).toBe(0xc3);
      });

      it('processes SF (Start Field) order', () => {
        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.SF, 0x20, // protected field
          0xc1, 0xc2,     // data after field
        ]);
        tnz._proc3270ds(data);

        expect(tnz.planeFa[0]).toBe(bit6(0x20));
        expect(tnz.planeDc[0]).toBe(0); // FA position has no data
        expect(tnz.planeDc[1]).toBe(0xc1);
        expect(tnz.planeDc[2]).toBe(0xc2);
      });

      it('processes IC (Insert Cursor) order', () => {
        const [hi, lo] = encode12bit(80);
        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.SBA, hi, lo,
          ORDER.IC,
        ]);
        tnz._proc3270ds(data);
        expect(tnz.curadd).toBe(80);
      });

      it('processes RA (Repeat to Address) order', () => {
        const [hi, lo] = encode12bit(80); // fill to addr 80
        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.RA, hi, lo, 0x00, // repeat null to addr 80
        ]);
        tnz._proc3270ds(data);
        expect(tnz.bufadd).toBe(80);
        // All 80 positions should be filled with 0x00
        for (let i = 0; i < 80; i++) {
          expect(tnz.planeDc[i]).toBe(0x00);
        }
      });

      it('processes SA (Set Attribute) order', () => {
        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.SA, 0x41, 0xf2, // SA: extended highlight = reverse video
          0xc1,                  // 'A'
        ]);
        tnz._proc3270ds(data);
        expect(tnz.planeEh[0]).toBe(0xf2);
        expect(tnz.planeDc[0]).toBe(0xc1);
      });

      it('processes GE (Graphic Escape) order', () => {
        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.GE, 0x41, // GE + char
        ]);
        tnz._proc3270ds(data);
        expect(tnz.planeDc[0]).toBe(0x41);
        expect(tnz.planeCs[0]).toBe(0xf1); // charset F1
      });

      it('WCC bit 1 resets MDT', () => {
        // Set up a field with MDT
        tnz.planeFa[0] = bit6(0x01); // MDT set
        // W with WCC bit 7 = reset MDT (0x01)
        const data = buildWrite(CMD.WRITE, 0x01, []);
        tnz._proc3270ds(data);
        // MDT should be cleared
        expect(tnz.planeFa[0]).toBe(bit6(0x00));
      });

      it('WCC bit 6 restores keyboard', () => {
        tnz.systemLockWait = true;
        tnz.aid = AID.ENTER;
        const data = buildWrite(CMD.WRITE, 0x02, []); // bit 6 = restore keyboard
        tnz._proc3270ds(data);
        expect(tnz.systemLockWait).toBe(false);
        expect(tnz.aid).toBe(AID.NONE);
      });
    });

    describe('Erase/Write (EW) command', () => {
      it('clears screen then writes data', () => {
        // Pre-fill some data
        tnz.planeDc[100] = 0xc1;
        tnz.planeFa[50] = bit6(0x20);

        const data = buildWrite(CMD.ERASE_WRITE, 0x00, [
          0xc1, 0xc2,
        ]);
        tnz._proc3270ds(data);

        // Old data cleared
        expect(tnz.planeDc[100]).toBe(0);
        expect(tnz.planeFa[50]).toBe(0);
        // New data at start
        expect(tnz.planeDc[0]).toBe(0xc1);
        expect(tnz.planeDc[1]).toBe(0xc2);
        // Uses default screen size
        expect(tnz.maxRow).toBe(24);
        expect(tnz.maxCol).toBe(80);
      });
    });

    describe('Erase/Write Alternate (EWA) command', () => {
      it('uses alternate screen size', () => {
        tnz.amaxRow = 43;
        tnz.amaxCol = 80;

        const data = buildWrite(CMD.ERASE_WRITE_ALTERNATE, 0x00, [
          0xc1,
        ]);
        tnz._proc3270ds(data);

        expect(tnz.maxRow).toBe(43);
        expect(tnz.maxCol).toBe(80);
        expect(tnz.bufferSize).toBe(3440);
        expect(tnz.planeDc[0]).toBe(0xc1);
      });
    });

    describe('Erase All Unprotected (EAU) command', () => {
      it('erases unprotected fields', () => {
        // Set up: protected field at 0, unprotected at 10
        tnz.planeFa[0] = bit6(0x20); // protected
        tnz.planeFa[10] = bit6(0x00); // unprotected
        tnz.planeDc[11] = 0xc1; // data in unprotected field
        tnz.planeDc[1] = 0xc2;  // data in protected field

        const data = Buffer.from([CMD.ERASE_ALL_UNPROTECTED]);
        tnz._proc3270ds(data);

        // Protected field data preserved
        expect(tnz.planeDc[1]).toBe(0xc2);
        expect(tnz.systemLockWait).toBe(false);
      });
    });

    describe('SFE (Start Field Extended) order', () => {
      it('sets field with extended attributes', () => {
        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.SFE,
          0x02,             // 2 attribute pairs
          0xc0, 0x20,       // field attribute: protected
          0x42, 0xf2,       // foreground: red
        ]);
        tnz._proc3270ds(data);

        expect(tnz.planeFa[0]).toBe(bit6(0x20));
        expect(tnz.planeFg[0]).toBe(0xf2);
        expect(tnz.bufadd).toBe(1);
      });
    });

    describe('MF (Modify Field) order', () => {
      it('modifies an existing field attribute', () => {
        // Set up a field at position 0
        tnz.planeFa[0] = bit6(0x00);

        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.MF,
          0x01,             // 1 attribute pair
          0x42, 0xf4,       // foreground: green
        ]);
        tnz._proc3270ds(data);

        expect(tnz.planeFg[0]).toBe(0xf4);
      });

      it('throws if not at a field position', () => {
        // No field at position 0
        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.MF,
          0x01,
          0x42, 0xf4,
        ]);
        expect(() => tnz._proc3270ds(data)).toThrow(TnzTerminalError);
      });
    });

    describe('EUA (Erase Unprotected to Address) order', () => {
      it('erases unprotected data to target address', () => {
        // Set up: field at 0 (unprotected), data at 1-9
        tnz.planeFa[0] = bit6(0x00);
        for (let i = 1; i < 10; i++) {
          tnz.planeDc[i] = 0xc1;
        }

        const [hi, lo] = encode12bit(10);
        const data = buildWrite(CMD.WRITE, 0x00, [
          ORDER.EUA, hi, lo,
        ]);
        tnz._proc3270ds(data);
        expect(tnz.bufadd).toBe(10);
      });
    });
  });

  // =========================================================================
  // Read Buffer and Send AID
  // =========================================================================

  describe('Read commands', () => {
    let tnz: Tnz;

    beforeEach(() => {
      tnz = createTnz();
      // Need a socket-like object to capture sent data
      tnz['_sendBuf'] = [];
    });

    describe('sendAid', () => {
      it('sends short AID response (AID only)', () => {
        const sent: Buffer[] = [];
        tnz.send3270Data = (data: Buffer) => { sent.push(data); };

        tnz.aid = AID.CLEAR;
        tnz.curadd = 80;
        tnz.sendAid(AID.CLEAR, true);

        expect(sent.length).toBe(1);
        expect(sent[0][0]).toBe(AID.CLEAR);
        // Short read is only 1 byte
        expect(sent[0].length).toBe(1);
      });

      it('sends full AID response with modified fields', () => {
        const sent: Buffer[] = [];
        tnz.send3270Data = (data: Buffer) => { sent.push(data); };

        // Set up a modified field
        tnz.planeFa[0] = bit6(0x01); // MDT set
        tnz.planeDc[1] = 0xc1;

        tnz.sendAid(AID.ENTER, false);

        expect(sent.length).toBe(1);
        const response = sent[0];
        expect(response[0]).toBe(AID.ENTER);
        // Should contain SBA order for modified field
        expect(response.includes(ORDER.SBA)).toBe(true);
      });
    });

    describe('Read Buffer (RB)', () => {
      it('sends buffer contents in response', () => {
        const sent: Buffer[] = [];
        tnz.send3270Data = (data: Buffer) => { sent.push(data); };

        // Put some data in the buffer
        tnz.planeDc[0] = 0xc1;
        tnz.planeDc[1] = 0xc2;

        tnz.readState = ReadState.NORMAL;
        const data = Buffer.from([CMD.READ_BUFFER]);
        tnz._proc3270ds(data);

        expect(sent.length).toBe(1);
        expect(sent[0][0]).toBe(AID.NONE); // current AID
      });

      it('includes SF orders for field attributes', () => {
        const sent: Buffer[] = [];
        tnz.send3270Data = (data: Buffer) => { sent.push(data); };

        tnz.planeFa[5] = bit6(0x20); // protected field
        tnz.planeDc[6] = 0xc1;

        const data = Buffer.from([CMD.READ_BUFFER]);
        tnz._proc3270ds(data);

        expect(sent.length).toBe(1);
        const response = sent[0];
        // Should contain SF order (0x1D)
        expect(response.includes(ORDER.SF)).toBe(true);
      });
    });

    describe('Read Modified (RM)', () => {
      it('sends AID response', () => {
        const sent: Buffer[] = [];
        tnz.send3270Data = (data: Buffer) => { sent.push(data); };

        tnz.aid = AID.ENTER;
        const data = Buffer.from([CMD.READ_MODIFIED]);
        tnz._proc3270ds(data);

        expect(sent.length).toBe(1);
        expect(sent[0][0]).toBe(AID.ENTER);
      });
    });

    describe('Read Modified All (RMA)', () => {
      it('sends full AID response and resets read state', () => {
        const sent: Buffer[] = [];
        tnz.send3270Data = (data: Buffer) => { sent.push(data); };

        tnz.aid = AID.PF3;
        tnz.readState = ReadState.RREAD;

        const data = Buffer.from([CMD.READ_MODIFIED_ALL]);
        tnz._proc3270ds(data);

        expect(tnz.readState).toBe(ReadState.NORMAL);
        expect(sent.length).toBe(1);
      });
    });
  });

  // =========================================================================
  // Write Structured Field (WSF)
  // =========================================================================

  describe('Write Structured Field (WSF)', () => {
    let tnz: Tnz;

    beforeEach(() => {
      tnz = createTnz();
    });

    it('rejects WSF shorter than 4 bytes', () => {
      const data = Buffer.from([CMD.WRITE_STRUCTURED_FIELD, 0x00, 0x00]);
      expect(() => tnz._proc3270ds(data)).toThrow('WSF needs 4 bytes');
    });

    describe('Read Partition (0x01)', () => {
      it('handles Query (type 0x02)', () => {
        const sent: Buffer[] = [];
        tnz.send3270Data = (data: Buffer) => { sent.push(data); };

        // WSF header: cmd + len(2) + SF_ID(0x01) + pid(0xFF) + type(0x02)
        const data = Buffer.from([
          CMD.WRITE_STRUCTURED_FIELD,
          0x00, 0x05, // SF length = 5
          0x01,       // Read Partition
          0xff,       // pid = query
          0x02,       // Query type
        ]);
        tnz._proc3270ds(data);

        expect(sent.length).toBe(1);
        // Response should start with AID.STRUCTURED_FIELD (0x88)
        expect(sent[0][0]).toBe(AID.STRUCTURED_FIELD);
      });

      it('handles Query List (type 0x03)', () => {
        const sent: Buffer[] = [];
        tnz.send3270Data = (data: Buffer) => { sent.push(data); };

        const data = Buffer.from([
          CMD.WRITE_STRUCTURED_FIELD,
          0x00, 0x07,
          0x01, 0xff, 0x03, // Query List
          0x02,             // reqtype
          0x81,             // qcode
        ]);
        tnz._proc3270ds(data);

        expect(sent.length).toBe(1);
        expect(sent[0][0]).toBe(AID.STRUCTURED_FIELD);
      });
    });

    describe('Set Reply Mode (0x09)', () => {
      it('sets field mode', () => {
        const data = Buffer.from([
          CMD.WRITE_STRUCTURED_FIELD,
          0x00, 0x05,
          0x09,       // Set Reply Mode
          0x00,       // pid = 0
          0x00,       // mode = Field
        ]);
        tnz._proc3270ds(data);
        expect(tnz._replyMode).toBe(0);
      });

      it('sets character mode with cattrs', () => {
        const data = Buffer.from([
          CMD.WRITE_STRUCTURED_FIELD,
          0x00, 0x07,
          0x09,       // Set Reply Mode
          0x00,       // pid = 0
          0x02,       // mode = Character
          0x41, 0x42, // cattrs: EH, FG
        ]);
        tnz._proc3270ds(data);
        expect(tnz._replyMode).toBe(2);
        expect([...tnz._replyCattrs]).toEqual([0x41, 0x42]);
      });

      it('rejects non-zero PID', () => {
        const data = Buffer.from([
          CMD.WRITE_STRUCTURED_FIELD,
          0x00, 0x05,
          0x09, 0x01, 0x00,
        ]);
        expect(() => tnz._proc3270ds(data)).toThrow('Non-zero PID');
      });
    });

    describe('Erase/Reset (0x03)', () => {
      it('resets with default screen', () => {
        tnz.amaxRow = 43;
        tnz.planeDc[0] = 0xc1;

        const data = Buffer.from([
          CMD.WRITE_STRUCTURED_FIELD,
          0x00, 0x04,
          0x03,       // Erase/Reset
          0x00,       // flags: default size (bit 7 = 0)
        ]);
        tnz._proc3270ds(data);

        expect(tnz.maxRow).toBe(24);
        expect(tnz.planeDc[0]).toBe(0);
        expect(tnz.updated).toBe(true);
      });

      it('resets with alternate screen', () => {
        tnz.amaxRow = 43;
        tnz.amaxCol = 80;

        const data = Buffer.from([
          CMD.WRITE_STRUCTURED_FIELD,
          0x00, 0x04,
          0x03,
          0x80,       // flags: alternate size (bit 7 = 1)
        ]);
        tnz._proc3270ds(data);

        expect(tnz.maxRow).toBe(43);
        expect(tnz.bufferSize).toBe(3440);
      });
    });

    describe('Outbound 3270DS (0x40)', () => {
      it('dispatches embedded Write command', () => {
        const [hi, lo] = encode12bit(80);
        const data = Buffer.from([
          CMD.WRITE_STRUCTURED_FIELD,
          0x00, 0x0a,       // length = 10
          0x40,             // Outbound 3270DS
          0x00,             // pid
          CMD.WRITE,        // embedded Write
          0x00,             // WCC
          ORDER.SBA, hi, lo,
          0xc1,             // 'A'
        ]);
        tnz._proc3270ds(data);
        expect(tnz.planeDc[80]).toBe(0xc1);
      });

      it('dispatches embedded Erase/Write', () => {
        tnz.planeDc[0] = 0xff;
        const data = Buffer.from([
          CMD.WRITE_STRUCTURED_FIELD,
          0x00, 0x07,       // SF length = 7 (includes len + sfid + pid + cmd + wcc + data)
          0x40,             // Outbound 3270DS
          0x00,             // pid
          CMD.ERASE_WRITE,
          0x00,             // WCC
          0xc1,             // data 'A'
        ]);
        tnz._proc3270ds(data);
        expect(tnz.planeDc[0]).toBe(0xc1);
      });
    });
  });

  // =========================================================================
  // Query Reply
  // =========================================================================

  describe('Query Reply', () => {
    it('includes Summary, Usable Area, Implicit Partition, Char Sets, Highlight, Reply Modes, DDM', () => {
      const tnz = createTnz();
      const sent: Buffer[] = [];
      tnz.send3270Data = (data: Buffer) => { sent.push(data); };

      // Trigger query reply via WSF Read Partition Query
      const data = Buffer.from([
        CMD.WRITE_STRUCTURED_FIELD,
        0x00, 0x05,
        0x01, 0xff, 0x02,
      ]);
      tnz._proc3270ds(data);

      expect(sent.length).toBe(1);
      const response = sent[0];

      // Should start with AID 0x88
      expect(response[0]).toBe(0x88);

      // Should contain query reply IDs
      expect(response.includes(0x81)).toBe(true); // Usable Area
      expect(response.includes(0x85)).toBe(true); // Character Sets
      expect(response.includes(0x87)).toBe(true); // Highlight
      expect(response.includes(0x88)).toBe(true); // Reply Modes
      expect(response.includes(0x95)).toBe(true); // DDM
      expect(response.includes(0xa6)).toBe(true); // Implicit Partition
    });

    it('includes Color query reply when capableColor is set', () => {
      const tnz = createTnz();
      tnz.capableColor = true;
      const sent: Buffer[] = [];
      tnz.send3270Data = (data: Buffer) => { sent.push(data); };

      const data = Buffer.from([
        CMD.WRITE_STRUCTURED_FIELD,
        0x00, 0x05,
        0x01, 0xff, 0x02,
      ]);
      tnz._proc3270ds(data);

      const response = sent[0];
      expect(response.includes(0x86)).toBe(true); // Color
    });
  });

  // =========================================================================
  // Screen reading helpers
  // =========================================================================

  describe('Screen reading', () => {
    let tnz: Tnz;

    beforeEach(() => {
      tnz = createTnz();
    });

    describe('scrstr', () => {
      it('reads EBCDIC text from buffer', () => {
        // Write "HELLO" in EBCDIC (cp037)
        const codec = tnz.codec;
        const encoded = codec.encode('HELLO');
        for (let i = 0; i < encoded.length; i++) {
          tnz.planeDc[i] = encoded[i];
        }

        const text = tnz.scrstr(0, 5);
        expect(text).toBe('HELLO');
      });
    });

    describe('scrhas', () => {
      it('returns true when text is present', () => {
        const encoded = tnz.codec.encode('READY');
        for (let i = 0; i < encoded.length; i++) {
          tnz.planeDc[i] = encoded[i];
        }

        expect(tnz.scrhas('READY')).toBe(true);
      });

      it('returns false when text is absent', () => {
        expect(tnz.scrhas('NOTHERE')).toBe(false);
      });
    });
  });

  // =========================================================================
  // TN3270E header processing
  // =========================================================================

  describe('TN3270E header handling', () => {
    it('strips 5-byte header in TN3270E mode', () => {
      const tnz = createTnz();
      tnz['_tn3270e'] = true;

      // TN3270E header (5 bytes) + EW + WCC + data
      const data = Buffer.from([
        0x00, 0x00, 0x00, 0x00, 0x00, // header: 3270-DATA
        CMD.ERASE_WRITE, 0x00, 0xc1,
      ]);
      tnz._proc3270ds(data);
      expect(tnz.planeDc[0]).toBe(0xc1);
    });

    it('sends TN3270E response when response_flag is 2', () => {
      const tnz = createTnz();
      tnz['_tn3270e'] = true;
      const sent: Buffer[] = [];
      tnz.sendRec = (data: Buffer) => { sent.push(data); };

      // response_flag = 2, seq = 0x0001
      const data = Buffer.from([
        0x00, 0x00, 0x02, 0x00, 0x01,
        CMD.ERASE_WRITE, 0x00, 0xc1,
      ]);
      tnz._proc3270ds(data);

      expect(sent.length).toBe(1);
      expect(sent[0][0]).toBe(0x02); // DATA-TYPE=RESPONSE
    });

    it('rejects short TN3270E records', () => {
      const tnz = createTnz();
      tnz['_tn3270e'] = true;

      const data = Buffer.from([0x00, 0x00, 0x00]);
      expect(() => tnz._proc3270ds(data)).toThrow('too short');
    });

    it('rejects unsupported data types', () => {
      const tnz = createTnz();
      tnz['_tn3270e'] = true;

      // data_type = 1 (SCS-DATA)
      const data = Buffer.from([
        0x01, 0x00, 0x00, 0x00, 0x00,
        CMD.WRITE, 0x00,
      ]);
      expect(() => tnz._proc3270ds(data)).toThrow('SCS-DATA');
    });
  });

  // =========================================================================
  // Unknown/invalid command handling
  // =========================================================================

  describe('Error handling', () => {
    it('rejects unknown 3270 commands', () => {
      const tnz = createTnz();
      const data = Buffer.from([0xaa]); // invalid command
      expect(() => tnz._proc3270ds(data)).toThrow('Unknown 3270 command');
    });

    it('rejects RB with wrong length', () => {
      const tnz = createTnz();
      const data = Buffer.from([CMD.READ_BUFFER, 0x00]); // should be 1 byte
      expect(() => tnz._proc3270ds(data)).toThrow('RB must be 1 byte');
    });

    it('rejects RM with wrong length', () => {
      const tnz = createTnz();
      const data = Buffer.from([CMD.READ_MODIFIED, 0x00]);
      expect(() => tnz._proc3270ds(data)).toThrow('RM must be 1 byte');
    });
  });

  // =========================================================================
  // Complex data stream scenarios
  // =========================================================================

  describe('Complex data stream scenarios', () => {
    it('handles a typical login screen', () => {
      const tnz = createTnz();

      // Simulate: EW + WCC + SF(protected) + "USERID" + SF(unprotected) + IC
      // Layout: FA@160 | "USERID"@161-166 | FA@167 | cursor@168
      const [sba1Hi, sba1Lo] = encode12bit(160); // row 2, col 0
      const [sba2Hi, sba2Lo] = encode12bit(167); // field boundary
      const [sba3Hi, sba3Lo] = encode12bit(200); // cursor target

      const codec = tnz.codec;
      const useridBytes = [...codec.encode('USERID')];

      const data = Buffer.from([
        CMD.ERASE_WRITE, 0x02, // WCC with keyboard restore
        ORDER.SBA, sba1Hi, sba1Lo,
        ORDER.SF, 0x20,        // protected field at 160
        ...useridBytes,        // "USERID" at 161-166
        ORDER.SBA, sba2Hi, sba2Lo,
        ORDER.SF, 0x00,        // unprotected field at 167
        ORDER.SBA, sba3Hi, sba3Lo,
        ORDER.IC,              // cursor here
      ]);

      tnz._proc3270ds(data);

      // Check screen content — 6 data characters between fields
      const text = tnz.scrstr(161, 167);
      expect(text).toBe('USERID');

      // Cursor positioned at SBA3 address
      expect(tnz.curadd).toBe(200);

      // Keyboard restored
      expect(tnz.systemLockWait).toBe(false);

      // Fields set up
      expect(tnz.planeFa[160]).toBe(bit6(0x20)); // protected
      expect(tnz.planeFa[167]).toBe(bit6(0x00)); // unprotected
      // FA position has dc=0 (field attrs occupy the position)
      expect(tnz.planeDc[167]).toBe(0);
    });

    it('handles RA filling entire screen with nulls', () => {
      const tnz = createTnz();
      // EW + WCC + RA to 0 (fills entire 1920 buffer with 0x00)
      const [hi, lo] = encode12bit(0);
      const data = Buffer.from([
        CMD.ERASE_WRITE, 0x00,
        ORDER.RA, hi, lo, 0x00,
      ]);
      tnz._proc3270ds(data);
      expect(tnz.bufadd).toBe(0);
      // All positions should be 0x00
      for (let i = 0; i < tnz.bufferSize; i++) {
        expect(tnz.planeDc[i]).toBe(0x00);
      }
    });

    it('handles multiple orders in sequence', () => {
      const tnz = createTnz();
      const [sba1Hi, sba1Lo] = encode12bit(0);
      const [sba2Hi, sba2Lo] = encode12bit(80);

      const data = Buffer.from([
        CMD.WRITE, 0x00,
        ORDER.SBA, sba1Hi, sba1Lo,
        ORDER.SF, 0x20,
        0xc1, 0xc2, 0xc3, // "ABC"
        ORDER.SBA, sba2Hi, sba2Lo,
        ORDER.SF, 0x00,
        ORDER.IC,
        0xc4, 0xc5, // "DE"
      ]);

      tnz._proc3270ds(data);

      expect(tnz.planeFa[0]).toBe(bit6(0x20));
      expect(tnz.planeDc[1]).toBe(0xc1);
      expect(tnz.planeDc[2]).toBe(0xc2);
      expect(tnz.planeDc[3]).toBe(0xc3);
      expect(tnz.planeFa[80]).toBe(bit6(0x00));
      expect(tnz.curadd).toBe(81);
      expect(tnz.planeDc[81]).toBe(0xc4);
      expect(tnz.planeDc[82]).toBe(0xc5);
    });
  });

  // =========================================================================
  // Keyboard methods
  // =========================================================================

  describe('Keyboard methods', () => {
    /**
     * Helper: set up a simple field layout on a Tnz instance.
     *
     * Layout: FA(protected)@pos0 | data | FA(unprotected)@pos1 | data | ...
     *
     * Uses the Write command processor so FA values go through bit6.
     */
    function setupFields(
      tnz: Tnz,
      fields: { addr: number; attr: number; data?: string }[],
    ): void {
      const codec = tnz.codec;
      const orders: number[] = [];
      for (const f of fields) {
        const [hi, lo] = encode12bit(f.addr);
        orders.push(ORDER.SBA, hi, lo, ORDER.SF, f.attr);
        if (f.data) {
          orders.push(...codec.encode(f.data));
        }
      }
      const data = buildWrite(CMD.ERASE_WRITE, 0x02, orders);
      tnz._proc3270ds(data);
    }

    // -----------------------------------------------------------------------
    // Cursor movement
    // -----------------------------------------------------------------------

    describe('cursor movement', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('keyCurDown moves cursor one row down', () => {
        tnz.curadd = 0;
        tnz.keyCurDown();
        expect(tnz.curadd).toBe(80);
      });

      it('keyCurDown wraps from last row to first', () => {
        tnz.curadd = 23 * 80 + 5; // last row, col 5
        tnz.keyCurDown();
        expect(tnz.curadd).toBe(5);
      });

      it('keyCurUp moves cursor one row up', () => {
        tnz.curadd = 160;
        tnz.keyCurUp();
        expect(tnz.curadd).toBe(80);
      });

      it('keyCurUp wraps from first row to last', () => {
        tnz.curadd = 5;
        tnz.keyCurUp();
        expect(tnz.curadd).toBe(23 * 80 + 5);
      });

      it('keyCurLeft moves cursor one position left', () => {
        tnz.curadd = 10;
        tnz.keyCurLeft();
        expect(tnz.curadd).toBe(9);
      });

      it('keyCurLeft wraps from 0 to end of buffer', () => {
        tnz.curadd = 0;
        tnz.keyCurLeft();
        expect(tnz.curadd).toBe(1919);
      });

      it('keyCurRight moves cursor one position right', () => {
        tnz.curadd = 10;
        tnz.keyCurRight();
        expect(tnz.curadd).toBe(11);
      });

      it('keyCurRight wraps from end to 0', () => {
        tnz.curadd = 1919;
        tnz.keyCurRight();
        expect(tnz.curadd).toBe(0);
      });
    });

    // -----------------------------------------------------------------------
    // setCursorPosition
    // -----------------------------------------------------------------------

    describe('setCursorPosition', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('sets cursor from 1-based row/col', () => {
        tnz.setCursorPosition(1, 1);
        expect(tnz.curadd).toBe(0);
      });

      it('sets cursor to last position', () => {
        tnz.setCursorPosition(24, 80);
        expect(tnz.curadd).toBe(1919);
      });

      it('sets cursor to middle of screen', () => {
        tnz.setCursorPosition(3, 10);
        expect(tnz.curadd).toBe(2 * 80 + 9);
      });

      it('throws for row out of range', () => {
        expect(() => tnz.setCursorPosition(0, 1)).toThrow('not in range');
        expect(() => tnz.setCursorPosition(25, 1)).toThrow('not in range');
      });

      it('throws for col out of range', () => {
        expect(() => tnz.setCursorPosition(1, 0)).toThrow('not in range');
        expect(() => tnz.setCursorPosition(1, 81)).toThrow('not in range');
      });
    });

    // -----------------------------------------------------------------------
    // isProtected / isUnprotected
    // -----------------------------------------------------------------------

    describe('isProtected / isUnprotected', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('isProtected returns true on FA position', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
        ]);
        expect(tnz.isProtected(0)).toBe(true);
      });

      it('isProtected returns true for protected field', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x20 },
        ]);
        expect(tnz.isProtected(5)).toBe(true);
      });

      it('isProtected returns false for unprotected data', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
        ]);
        expect(tnz.isProtected(5)).toBe(false);
      });

      it('isUnprotected returns true when all fields unprotected', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
          { addr: 40, attr: 0x00 },
        ]);
        expect(tnz.isUnprotected()).toBe(true);
      });

      it('isUnprotected returns false when a field is protected', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x20 },
          { addr: 40, attr: 0x00 },
        ]);
        expect(tnz.isUnprotected()).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // keyTab / keyBacktab
    // -----------------------------------------------------------------------

    describe('keyTab', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('tabs to start of next unprotected field', () => {
        // FA(prot)@0 | data | FA(unprot)@40 | data
        setupFields(tnz, [
          { addr: 0, attr: 0x20 },
          { addr: 40, attr: 0x00 },
        ]);
        tnz.curadd = 5;
        tnz.keyTab();
        expect(tnz.curadd).toBe(41);
      });

      it('wraps around to find unprotected field', () => {
        // FA(prot)@80 | data | FA(unprot)@10 | data
        setupFields(tnz, [
          { addr: 10, attr: 0x00 },
          { addr: 80, attr: 0x20 },
        ]);
        tnz.curadd = 85;
        tnz.keyTab();
        expect(tnz.curadd).toBe(11);
      });

      it('returns 0 when no unprotected field', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x20 },
          { addr: 80, attr: 0x20 },
        ]);
        tnz.curadd = 5;
        tnz.keyTab();
        expect(tnz.curadd).toBe(0);
      });
    });

    describe('keyBacktab', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('backtabs to start of previous unprotected field', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
          { addr: 40, attr: 0x00 },
        ]);
        tnz.curadd = 50;
        tnz.keyBacktab();
        expect(tnz.curadd).toBe(41);
      });

      it('backtabs from beginning of field goes to previous', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
          { addr: 40, attr: 0x00 },
        ]);
        tnz.curadd = 41; // first char of second field
        tnz.keyBacktab();
        expect(tnz.curadd).toBe(1);
      });

      it('wraps around to last unprotected field', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
          { addr: 40, attr: 0x00 },
        ]);
        tnz.curadd = 1; // first char of first field
        tnz.keyBacktab();
        expect(tnz.curadd).toBe(41);
      });

      it('returns 0 when no fields', () => {
        tnz.curadd = 50;
        tnz.keyBacktab();
        expect(tnz.curadd).toBe(0);
      });
    });

    // -----------------------------------------------------------------------
    // keyHome
    // -----------------------------------------------------------------------

    describe('keyHome', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('homes to position 0 when unprotected', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
        ]);
        // Position 0 is an FA, so isProtected(0) = true
        // Should tab to first unprotected field start = 1
        tnz.curadd = 100;
        tnz.keyHome();
        // Position 0 has FA -> isProtected returns true -> tabs
        expect(tnz.curadd).toBe(1);
      });

      it('homes to first unprotected field when 0 is protected', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x20 },
          { addr: 40, attr: 0x00 },
        ]);
        tnz.curadd = 100;
        tnz.keyHome();
        expect(tnz.curadd).toBe(41);
      });

      it('homes to 0 when no fields', () => {
        tnz.curadd = 100;
        tnz.keyHome();
        expect(tnz.curadd).toBe(0);
      });
    });

    // -----------------------------------------------------------------------
    // keyNewline
    // -----------------------------------------------------------------------

    describe('keyNewline', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('moves to first unprotected pos on next line', () => {
        // FA(prot)@0 | data | FA(unprot)@80 | data
        setupFields(tnz, [
          { addr: 0, attr: 0x20 },
          { addr: 80, attr: 0x00 },
        ]);
        tnz.curadd = 5; // row 0
        tnz.keyNewline();
        expect(tnz.curadd).toBe(81);
      });

      it('moves to next row start when no fields', () => {
        tnz.curadd = 5;
        tnz.keyNewline();
        expect(tnz.curadd).toBe(80);
      });
    });

    // -----------------------------------------------------------------------
    // keyEnd
    // -----------------------------------------------------------------------

    describe('keyEnd', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('moves cursor to end of data in unprotected field', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00, data: 'ABC' },
          { addr: 40, attr: 0x00 },
        ]);
        // Field data at 1,2,3 = 'A','B','C'; rest are nulls until FA@40
        tnz.curadd = 1;
        tnz.keyEnd();
        // Should go to position after last non-null = 4
        expect(tnz.curadd).toBe(4);
      });

      it('stays on last char if field is full (unprotected)', () => {
        // Create a field and fill it completely
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
          { addr: 5, attr: 0x20 },
        ]);
        // Manually fill positions 1-4 with non-null data
        tnz.planeDc[1] = 0xc1;
        tnz.planeDc[2] = 0xc2;
        tnz.planeDc[3] = 0xc3;
        tnz.planeDc[4] = 0xc4;
        tnz.curadd = 1;
        tnz.keyEnd();
        // Field full: caddr == eaddr, unprotected -> back up 1
        expect(tnz.curadd).toBe(4);
      });

      it('does nothing when no fields', () => {
        tnz.curadd = 10;
        tnz.keyEnd();
        expect(tnz.curadd).toBe(10);
      });
    });

    // -----------------------------------------------------------------------
    // keyData
    // -----------------------------------------------------------------------

    describe('keyData', () => {
      let tnz: Tnz;
      beforeEach(() => {
        tnz = createTnz();
        tnz.pwait = false;
        tnz.systemLockWait = false;
      });

      it('types characters into unprotected field', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
          { addr: 40, attr: 0x20 },
        ]);
        // Restore keyboard after write
        tnz.pwait = false;
        tnz.systemLockWait = false;

        tnz.curadd = 1;
        const consumed = tnz.keyData('AB');
        expect(consumed).toBe(2);

        // Verify EBCDIC data written
        expect(tnz.planeDc[1]).toBe(0xc1); // 'A' in EBCDIC cp037
        expect(tnz.planeDc[2]).toBe(0xc2); // 'B'

        // Cursor advanced
        expect(tnz.curadd).toBe(3);

        // MDT set on field
        expect(tnz.planeFa[0] & 0x01).toBe(1);
      });

      it('stops at field boundary', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
          { addr: 5, attr: 0x20 },
        ]);
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.curadd = 1;
        // Field has 4 characters (1,2,3,4), try to type 6
        const consumed = tnz.keyData('ABCDEF');
        expect(consumed).toBe(4);
        expect(tnz.planeDc[1]).toBe(0xc1);
        expect(tnz.planeDc[4]).toBe(0xc4);
      });

      it('rejects input on field attribute', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
        ]);
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.curadd = 0; // on FA
        const consumed = tnz.keyData('A');
        expect(consumed).toBe(0);
      });

      it('rejects input on protected field', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x20 },
        ]);
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.curadd = 5;
        const consumed = tnz.keyData('A');
        expect(consumed).toBe(0);
      });

      it('throws on PWAIT', () => {
        tnz.pwait = true;
        expect(() => tnz.keyData('A')).toThrow('PWAIT');
      });

      it('throws on system lock', () => {
        tnz.systemLockWait = true;
        expect(() => tnz.keyData('A')).toThrow('System Lock');
      });
    });

    // -----------------------------------------------------------------------
    // keyDelete
    // -----------------------------------------------------------------------

    describe('keyDelete', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('shifts field data left and clears last position', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00, data: 'ABCD' },
          { addr: 10, attr: 0x20 },
        ]);
        tnz.curadd = 2; // on 'B' (position 2)
        const result = tnz.keyDelete();
        expect(result).toBe(true);

        // 'A' stays, 'B' deleted, 'C' and 'D' shift left
        expect(tnz.planeDc[1]).toBe(0xc1); // A
        expect(tnz.planeDc[2]).toBe(0xc3); // C (shifted from 3)
        expect(tnz.planeDc[3]).toBe(0xc4); // D (shifted from 4)
        // Last position in field cleared
        // Positions 5-9 were null, last data pos was 4
        // After shift: positions 1-3 have data, 4 should be 0
        // Actually the last char in field is pos 9 (before FA@10)
        expect(tnz.planeDc[9]).toBe(0);
      });

      it('returns false on field attribute', () => {
        setupFields(tnz, [{ addr: 0, attr: 0x00 }]);
        tnz.curadd = 0;
        expect(tnz.keyDelete()).toBe(false);
      });

      it('returns false on protected field', () => {
        setupFields(tnz, [{ addr: 0, attr: 0x20 }]);
        tnz.curadd = 5;
        expect(tnz.keyDelete()).toBe(false);
      });

      it('sets MDT when deleting', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00, data: 'X' },
          { addr: 10, attr: 0x20 },
        ]);
        tnz.curadd = 1;
        tnz.keyDelete();
        expect(tnz.planeFa[0] & 0x01).toBe(1); // MDT set
      });
    });

    // -----------------------------------------------------------------------
    // keyBackspace
    // -----------------------------------------------------------------------

    describe('keyBackspace', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('moves left and deletes', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00, data: 'ABC' },
          { addr: 10, attr: 0x20 },
        ]);
        tnz.curadd = 3; // on 'C'
        const result = tnz.keyBackspace();
        expect(result).toBe(true);
        expect(tnz.curadd).toBe(2);
        // 'B' at position 2 was deleted, 'C' shifted left
        expect(tnz.planeDc[2]).toBe(0xc3); // C shifted to 2
      });

      it('returns false on field attribute', () => {
        setupFields(tnz, [{ addr: 0, attr: 0x00 }]);
        tnz.curadd = 0;
        expect(tnz.keyBackspace()).toBe(false);
      });

      it('returns false when left is field attribute', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00, data: 'A' },
          { addr: 10, attr: 0x20 },
        ]);
        tnz.curadd = 1; // first data char, left is FA@0
        expect(tnz.keyBackspace()).toBe(false);
      });

      it('returns false on protected field', () => {
        setupFields(tnz, [{ addr: 0, attr: 0x20 }]);
        tnz.curadd = 5;
        expect(tnz.keyBackspace()).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // keyEraseEof
    // -----------------------------------------------------------------------

    describe('keyEraseEof', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('erases from cursor to end of field', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00, data: 'ABCDEF' },
          { addr: 10, attr: 0x20 },
        ]);
        tnz.curadd = 4; // on 'D'
        const result = tnz.keyEraseEof();
        expect(result).toBe(true);

        // A, B, C remain
        expect(tnz.planeDc[1]).toBe(0xc1);
        expect(tnz.planeDc[2]).toBe(0xc2);
        expect(tnz.planeDc[3]).toBe(0xc3);
        // D, E, F erased
        expect(tnz.planeDc[4]).toBe(0);
        expect(tnz.planeDc[5]).toBe(0);
        expect(tnz.planeDc[6]).toBe(0);
      });

      it('returns false on field attribute', () => {
        setupFields(tnz, [{ addr: 0, attr: 0x00 }]);
        tnz.curadd = 0;
        expect(tnz.keyEraseEof()).toBe(false);
      });

      it('returns false on protected field', () => {
        setupFields(tnz, [{ addr: 0, attr: 0x20 }]);
        tnz.curadd = 5;
        expect(tnz.keyEraseEof()).toBe(false);
      });

      it('sets MDT', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00, data: 'X' },
          { addr: 10, attr: 0x20 },
        ]);
        tnz.curadd = 1;
        tnz.keyEraseEof();
        expect(tnz.planeFa[0] & 0x01).toBe(1);
      });
    });

    // -----------------------------------------------------------------------
    // keyEraseInput
    // -----------------------------------------------------------------------

    describe('keyEraseInput', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('erases all unprotected fields and homes cursor', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x20, data: 'PROT' },
          { addr: 20, attr: 0x00, data: 'UNPR' },
          { addr: 40, attr: 0x20, data: 'PROT' },
        ]);
        tnz.curadd = 100;
        tnz.keyEraseInput();

        // Protected data preserved
        expect(tnz.planeDc[1]).not.toBe(0); // 'P' from 'PROT'

        // Unprotected data erased
        expect(tnz.planeDc[21]).toBe(0);
        expect(tnz.planeDc[22]).toBe(0);

        // Cursor homed to first unprotected field
        expect(tnz.curadd).toBe(21);
      });
    });

    // -----------------------------------------------------------------------
    // keyInsData
    // -----------------------------------------------------------------------

    describe('keyInsData', () => {
      let tnz: Tnz;
      beforeEach(() => {
        tnz = createTnz();
        tnz.pwait = false;
        tnz.systemLockWait = false;
      });

      it('inserts text and shifts existing data right', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00, data: 'AC' },
          { addr: 10, attr: 0x20 },
        ]);
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.curadd = 2; // after 'A', on 'C' (position 2)
        const inserted = tnz.keyInsData('B');
        expect(inserted).toBe(1);

        // 'A' at 1, 'B' inserted at 2, 'C' shifted to 3
        expect(tnz.planeDc[1]).toBe(0xc1); // A
        expect(tnz.planeDc[2]).toBe(0xc2); // B (inserted)
        expect(tnz.planeDc[3]).toBe(0xc3); // C (shifted)
      });

      it('returns 0 on field attribute', () => {
        setupFields(tnz, [{ addr: 0, attr: 0x00 }]);
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.curadd = 0;
        expect(tnz.keyInsData('X')).toBe(0);
      });

      it('returns 0 on protected field', () => {
        setupFields(tnz, [{ addr: 0, attr: 0x20 }]);
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.curadd = 5;
        expect(tnz.keyInsData('X')).toBe(0);
      });

      it('returns 0 when field is full', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
          { addr: 5, attr: 0x20 },
        ]);
        tnz.pwait = false;
        tnz.systemLockWait = false;
        // Fill all 4 positions
        tnz.planeDc[1] = 0xc1;
        tnz.planeDc[2] = 0xc2;
        tnz.planeDc[3] = 0xc3;
        tnz.planeDc[4] = 0xc4;
        tnz.curadd = 1;
        expect(tnz.keyInsData('X')).toBe(0);
      });

      it('throws on PWAIT', () => {
        tnz.pwait = true;
        expect(() => tnz.keyInsData('X')).toThrow('PWAIT');
      });
    });

    // -----------------------------------------------------------------------
    // keyAid / enter / PF / PA / clear
    // -----------------------------------------------------------------------

    describe('keyAid', () => {
      let tnz: Tnz;
      beforeEach(() => {
        tnz = createTnz();
        // Allow sending by clearing inhibit state
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.readState = ReadState.NORMAL;
      });

      it('sets system lock and pwait', () => {
        tnz.keyAid(AID.ENTER);
        expect(tnz.systemLockWait).toBe(true);
        expect(tnz.pwait).toBe(true);
        expect(tnz.readState).toBe(ReadState.RENTER);
      });

      it('throws on PWAIT', () => {
        tnz.pwait = true;
        expect(() => tnz.keyAid(AID.ENTER)).toThrow('PWAIT');
      });

      it('throws on system lock', () => {
        tnz.systemLockWait = true;
        expect(() => tnz.keyAid(AID.ENTER)).toThrow('System Lock');
      });

      it('throws on retry-enter state', () => {
        tnz.readState = ReadState.RENTER;
        expect(() => tnz.keyAid(AID.ENTER)).toThrow('Retry Enter');
      });
    });

    describe('enter', () => {
      let tnz: Tnz;
      beforeEach(() => {
        tnz = createTnz();
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.readState = ReadState.NORMAL;
      });

      it('sends AID ENTER', () => {
        tnz.enter();
        expect(tnz.readState).toBe(ReadState.RENTER);
      });

      it('types text then sends ENTER', () => {
        setupFields(tnz, [
          { addr: 0, attr: 0x00 },
          { addr: 40, attr: 0x20 },
        ]);
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.readState = ReadState.NORMAL;
        tnz.curadd = 1;
        tnz.enter('AB');
        // Data typed
        expect(tnz.planeDc[1]).toBe(0xc1);
        expect(tnz.planeDc[2]).toBe(0xc2);
        // AID sent
        expect(tnz.readState).toBe(ReadState.RENTER);
      });
    });

    describe('PF keys', () => {
      let tnz: Tnz;
      beforeEach(() => {
        tnz = createTnz();
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.readState = ReadState.NORMAL;
      });

      it('pf1 through pf24 all set RENTER state', () => {
        const pfMethods = [
          'pf1', 'pf2', 'pf3', 'pf4', 'pf5', 'pf6',
          'pf7', 'pf8', 'pf9', 'pf10', 'pf11', 'pf12',
          'pf13', 'pf14', 'pf15', 'pf16', 'pf17', 'pf18',
          'pf19', 'pf20', 'pf21', 'pf22', 'pf23', 'pf24',
        ] as const;

        for (const method of pfMethods) {
          tnz.pwait = false;
          tnz.systemLockWait = false;
          tnz.readState = ReadState.NORMAL;
          (tnz[method] as () => void)();
          expect(tnz.readState).toBe(ReadState.RENTER);
        }
      });
    });

    describe('PA keys', () => {
      let tnz: Tnz;
      beforeEach(() => {
        tnz = createTnz();
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.readState = ReadState.NORMAL;
      });

      it('pa1 sends correct AID', () => {
        tnz.pa1();
        expect(tnz.readState).toBe(ReadState.RENTER);
      });

      it('pa2 sends correct AID', () => {
        tnz.pa2();
        expect(tnz.readState).toBe(ReadState.RENTER);
      });

      it('pa3 sends correct AID', () => {
        tnz.pa3();
        expect(tnz.readState).toBe(ReadState.RENTER);
      });
    });

    describe('clear', () => {
      let tnz: Tnz;
      beforeEach(() => {
        tnz = createTnz();
        tnz.pwait = false;
        tnz.systemLockWait = false;
        tnz.readState = ReadState.NORMAL;
      });

      it('sends CLEAR AID', () => {
        tnz.clear();
        expect(tnz.readState).toBe(ReadState.RENTER);
      });
    });
  });

  // =========================================================================
  // Enhanced screen reading
  // =========================================================================

  describe('Enhanced screen reading', () => {
    describe('scrstr', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('reads a range of characters', () => {
        const codec = tnz.codec;
        const encoded = codec.encode('HELLO');
        for (let i = 0; i < encoded.length; i++) {
          tnz.planeDc[10 + i] = encoded[i];
        }
        const result = tnz.scrstr(10, 15, false);
        expect(result).toBe('HELLO');
      });

      it('translates NULL bytes to spaces', () => {
        // NULL (0x00) should become space
        tnz.planeDc[0] = 0x00;
        tnz.planeDc[1] = 0xc1; // 'A'
        tnz.planeDc[2] = 0x00;
        const result = tnz.scrstr(0, 3, false);
        expect(result).toBe(' A ');
      });

      it('translates control chars (FF, CR, NL, EM, EO) to spaces', () => {
        tnz.planeDc[0] = 0x0c; // FF
        tnz.planeDc[1] = 0x0d; // CR
        tnz.planeDc[2] = 0x15; // NL
        tnz.planeDc[3] = 0x19; // EM
        tnz.planeDc[4] = 0xff; // EO
        const result = tnz.scrstr(0, 5, false);
        expect(result).toBe('     ');
      });

      it('translates special ordinals (SUB, DUP, FM)', () => {
        // We need to place EBCDIC bytes that decode to U+001A, U+001C, U+001E
        // In cp037: 0x3F -> U+001A (SUB), 0x1C -> U+001C (FS/DUP), 0x1E -> U+001E (RS/FM)
        // Actually the codec translates these. Let's encode them.
        // SUB = 0x3F in EBCDIC cp037 maps to Unicode SUB (U+001A)
        tnz.planeDc[0] = 0x3f; // SUB in cp037
        const result = tnz.scrstr(0, 1, false);
        // SUB (U+001A) should become U+2218 (ring operator)
        expect(result).toBe('\u2218');
      });

      it('full-buffer read with rstrip joins rows with newlines', () => {
        // Put 'AB' at start of row 0, rest is nulls
        const codec = tnz.codec;
        const ab = codec.encode('AB');
        tnz.planeDc[0] = ab[0];
        tnz.planeDc[1] = ab[1];
        // Put 'CD' at start of row 1
        const cd = codec.encode('CD');
        tnz.planeDc[80] = cd[0];
        tnz.planeDc[81] = cd[1];

        const result = tnz.scrstr(); // defaults: saddr=0, eaddr=0, rstrip=true
        const lines = result.split('\n');
        expect(lines[0]).toBe('AB');
        expect(lines[1]).toBe('CD');
        // Remaining rows should be empty strings
        expect(lines[2]).toBe('');
        // Total: 24 rows + trailing empty = 25 elements
        expect(lines.length).toBe(25);
      });

      it('partial read with rstrip=false returns raw string', () => {
        const codec = tnz.codec;
        const hello = codec.encode('HI');
        tnz.planeDc[0] = hello[0];
        tnz.planeDc[1] = hello[1];
        // positions 2-4 are null -> will become spaces
        const result = tnz.scrstr(0, 5, false);
        expect(result).toBe('HI   ');
      });
    });

    describe('scrhas', () => {
      let tnz: Tnz;
      beforeEach(() => { tnz = createTnz(); });

      it('finds text in the full screen buffer', () => {
        const codec = tnz.codec;
        const text = codec.encode('READY');
        for (let i = 0; i < text.length; i++) {
          tnz.planeDc[100 + i] = text[i];
        }
        expect(tnz.scrhas('READY')).toBe(true);
      });

      it('returns false when text not present', () => {
        expect(tnz.scrhas('NOTFOUND')).toBe(false);
      });

      it('searches from a specific start address', () => {
        const codec = tnz.codec;
        const text = codec.encode('DATA');
        for (let i = 0; i < text.length; i++) {
          tnz.planeDc[50 + i] = text[i];
        }
        // Search starting after the text
        expect(tnz.scrhas('DATA', 55)).toBe(true);
        // The circular buffer wraps, so it should still find it
      });
    });
  });
});

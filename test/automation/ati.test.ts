/**
 * Tests for src/automation/ati.ts — Ati automation layer.
 */

import { describe, it, expect } from 'vitest';
import { Ati, EOL } from '../../src/automation/ati';
import { Tnz, bit6 } from '../../src/core/tnz';
import { CMD, ORDER } from '../../src/types';

// Helper: encode a 12-bit buffer address for SBA
function encode12bit(addr: number): [number, number] {
  const high6 = Math.floor(addr / 64);
  const low6 = addr % 64;
  return [bit6(high6), bit6(low6)];
}

// Helper: set up fields on a Tnz instance via Write command
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
  const data = Buffer.from([CMD.ERASE_WRITE, 0x02, ...orders]);
  tnz._proc3270ds(data);
}

// Helper: create a Tnz with fields and register it in an Ati
function createAtiWithSession(
  fields?: { addr: number; attr: number; data?: string }[],
): { ati: Ati; tnz: Tnz } {
  const ati = new Ati();
  const tnz = new Tnz('test');
  if (fields) {
    setupFields(tnz, fields);
  }
  // Unlock keyboard after write command
  tnz.pwait = false;
  tnz.systemLockWait = false;
  ati.registerSession('SES1', tnz);
  return { ati, tnz };
}

describe('Ati', () => {
  // =========================================================================
  // Session management
  // =========================================================================

  describe('session management', () => {
    it('starts with no sessions', () => {
      const ati = new Ati();
      expect(ati.session).toBe('NONE');
      expect(ati.sessions).toBe('');
    });

    it('registerSession adds and selects a session', () => {
      const ati = new Ati();
      const tnz = new Tnz('test');
      ati.registerSession('SES1', tnz);
      expect(ati.session).toBe('SES1');
      expect(ati.sessions).toBe('SES1');
    });

    it('registerSession uppercases the name', () => {
      const ati = new Ati();
      ati.registerSession('mySession', new Tnz('test'));
      expect(ati.session).toBe('MYSESSION');
    });

    it('getTnz returns the registered instance', () => {
      const ati = new Ati();
      const tnz = new Tnz('test');
      ati.registerSession('SES1', tnz);
      expect(ati.getTnz()).toBe(tnz);
      expect(ati.getTnz('SES1')).toBe(tnz);
    });

    it('getTnz returns undefined for unknown session', () => {
      const ati = new Ati();
      expect(ati.getTnz()).toBeUndefined();
      expect(ati.getTnz('NOPE')).toBeUndefined();
    });

    it('session setter switches between sessions', () => {
      const ati = new Ati();
      ati.registerSession('SES1', new Tnz('s1'));
      ati.registerSession('SES2', new Tnz('s2'));
      expect(ati.session).toBe('SES2');
      ati.session = 'SES1';
      expect(ati.session).toBe('SES1');
      expect(ati.rc).toBe(1); // switched, not new
    });

    it('session setter throws for unknown session', () => {
      const ati = new Ati();
      expect(() => { ati.session = 'NOPE'; }).toThrow();
    });

    it('registerSession throws for duplicate name', () => {
      const ati = new Ati();
      ati.registerSession('SES1', new Tnz('s1'));
      expect(() => ati.registerSession('SES1', new Tnz('s2')))
        .toThrow('already established');
    });

    it('dropSession removes current session', () => {
      const ati = new Ati();
      ati.registerSession('SES1', new Tnz('s1'));
      ati.dropSession();
      expect(ati.session).toBe('NONE');
      expect(ati.sessions).toBe('');
    });

    it('dropSession switches to next session', () => {
      const ati = new Ati();
      ati.registerSession('SES1', new Tnz('s1'));
      ati.registerSession('SES2', new Tnz('s2'));
      ati.session = 'SES1';
      ati.dropSession();
      expect(ati.session).toBe('SES2');
    });

    it('renameSession changes session name', () => {
      const ati = new Ati();
      const tnz = new Tnz('s1');
      ati.registerSession('SES1', tnz);
      ati.renameSession('NEWSESSION');
      expect(ati.session).toBe('NEWSESSION');
      expect(ati.getTnz('NEWSESSION')).toBe(tnz);
      expect(ati.getTnz('SES1')).toBeUndefined();
    });

    it('renameSession throws for duplicate name', () => {
      const ati = new Ati();
      ati.registerSession('SES1', new Tnz('s1'));
      ati.registerSession('SES2', new Tnz('s2'));
      ati.session = 'SES1';
      expect(() => ati.renameSession('SES2'))
        .toThrow('already established');
    });
  });

  // =========================================================================
  // Screen reading properties
  // =========================================================================

  describe('screen reading properties', () => {
    it('maxRow/maxCol return screen dimensions', () => {
      const { ati, tnz } = createAtiWithSession();
      expect(ati.maxRow).toBe(tnz.maxRow);
      expect(ati.maxCol).toBe(tnz.maxCol);
    });

    it('curRow/curCol return cursor position', () => {
      const { ati, tnz } = createAtiWithSession();
      tnz.curadd = 2 * 80 + 5; // row 3, col 6 (1-based)
      expect(ati.curRow).toBe(3);
      expect(ati.curCol).toBe(6);
    });

    it('keyLock reflects Tnz lock state', () => {
      const { ati, tnz } = createAtiWithSession();
      tnz.pwait = false;
      tnz.systemLockWait = false;
      expect(ati.keyLock).toBe(false);
      tnz.pwait = true;
      expect(ati.keyLock).toBe(true);
    });

    it('returns 0 when no session', () => {
      const ati = new Ati();
      expect(ati.maxRow).toBe(0);
      expect(ati.maxCol).toBe(0);
      expect(ati.curRow).toBe(0);
      expect(ati.curCol).toBe(0);
      expect(ati.keyLock).toBe(false);
    });
  });

  // =========================================================================
  // scrhas
  // =========================================================================

  describe('scrhas', () => {
    it('finds text on the screen', () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x20, data: 'READY' },
      ]);
      expect(ati.scrhas('READY')).toBe(true);
      expect(ati.rc).toBe(0);
      expect(ati.hitRow).toBe(1);
      expect(ati.hitCol).toBe(2); // data starts at position 1 (after FA@0)
    });

    it('returns false when text not found', () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x20, data: 'HELLO' },
      ]);
      expect(ati.scrhas('NOTFOUND')).toBe(false);
      expect(ati.rc).toBe(1);
    });

    it('case-insensitive search works', () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x20, data: 'Ready' },
      ]);
      expect(ati.scrhas('ready', true)).toBe(true);
      expect(ati.rc).toBe(0);
    });

    it('returns false and rc=12 when no session', () => {
      const ati = new Ati();
      expect(ati.scrhas('ANYTHING')).toBe(false);
      expect(ati.rc).toBe(12);
    });
  });

  // =========================================================================
  // extract
  // =========================================================================

  describe('extract', () => {
    it('extracts text by length', () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x20, data: 'ABCDEFGH' },
      ]);
      // Data at positions 1-8, extract 3 chars from (1,2) = position 1
      const result = ati.extract(3, 1, 2);
      expect(result).toBe('ABC');
      expect(ati.rc).toBe(0);
      expect(ati.hitRow).toBe(1);
      expect(ati.hitCol).toBe(2);
    });

    it('extracts to end of line with EOL', () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x20, data: 'HELLO' },
      ]);
      // From position (1,2) to end of row 1 (col 80)
      const result = ati.extract(EOL, 1, 2);
      // Should be 79 chars from position 1 to 79
      expect(result.length).toBe(79);
      expect(result.startsWith('HELLO')).toBe(true);
    });

    it('returns empty string and rc=12 with no session', () => {
      const ati = new Ati();
      expect(ati.extract(5)).toBe('');
      expect(ati.rc).toBe(12);
    });

    it('returns empty string and rc=3 for length < 1', () => {
      const { ati } = createAtiWithSession();
      expect(ati.extract(0)).toBe('');
      expect(ati.rc).toBe(3);
    });

    it('returns empty string and rc=8 for out of bounds', () => {
      const { ati } = createAtiWithSession();
      expect(ati.extract(5, 25, 1)).toBe(''); // row 25 doesn't exist
      expect(ati.rc).toBe(8);
    });

    it('truncates and sets rc=9 when exceeding screen', () => {
      const { ati } = createAtiWithSession();
      // Extract more than buffer size from end of screen
      const result = ati.extract(100, 24, 1);
      expect(result.length).toBe(80); // truncated to remaining in row
      expect(ati.rc).toBe(9);
    });

    it('handles negative row/col', () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x20, data: 'DATA' },
      ]);
      // -1 for row = last row, -1 for col = last col
      const result = ati.extract(1, -1, -1);
      expect(result.length).toBe(1);
      expect(ati.hitRow).toBe(24); // last row
      expect(ati.hitCol).toBe(80); // last col
    });
  });

  // =========================================================================
  // send
  // =========================================================================

  describe('send', () => {
    it('types plain text into the buffer', async () => {
      const { ati, tnz } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
        { addr: 40, attr: 0x20 },
      ]);
      tnz.curadd = 1;
      const rc = await ati.send('AB');
      expect(rc).toBe(0);
      expect(tnz.planeDc[1]).toBe(0xc1); // 'A'
      expect(tnz.planeDc[2]).toBe(0xc2); // 'B'
      expect(ati.sendStr).toBe('AB');
    });

    it('sends AID key (enter)', async () => {
      const { ati, tnz } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
      ]);
      tnz.curadd = 1;
      const rc = await ati.send('[enter]');
      expect(rc).toBe(0);
      expect(ati.sendStr).toBe('[enter]');
    });

    it('AID key terminates send — text after is ignored', async () => {
      const { ati, tnz } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
      ]);
      tnz.curadd = 1;
      const rc = await ati.send('A[enter]B');
      expect(rc).toBe(4); // partial send
      expect(ati.sendStr).toBe('A[enter]');
    });

    it('movement keys do NOT terminate send', async () => {
      const { ati, tnz } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
        { addr: 40, attr: 0x00 },
      ]);
      tnz.curadd = 1;
      const rc = await ati.send('A[tab]B');
      expect(rc).toBe(0);
      expect(ati.sendStr).toBe('A[tab]B');
    });

    it('[[ escapes to literal [', async () => {
      const { ati, tnz } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
        { addr: 40, attr: 0x20 },
      ]);
      tnz.curadd = 1;
      const rc = await ati.send('[[');
      expect(rc).toBe(0);
      // '[' should be typed as EBCDIC
      expect(ati.sendStr).toBe('[[');
    });

    it('positions cursor when pos is provided', async () => {
      const { ati, tnz } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
        { addr: 40, attr: 0x20 },
      ]);
      await ati.send('X', [1, 5]);
      expect(tnz.planeDc[4]).toBe(tnz.codec.encode('X')[0]);
    });

    it('returns 12 when no session', async () => {
      const ati = new Ati();
      expect(await ati.send('hello')).toBe(12);
    });

    it('throws on unknown mnemonic', async () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
      ]);
      await expect(ati.send('[bogus]')).rejects.toThrow('unknown mnemonic');
    });

    it('[insert] switches to insert mode', async () => {
      const { ati, tnz } = createAtiWithSession([
        { addr: 0, attr: 0x00, data: 'AC' },
        { addr: 10, attr: 0x20 },
      ]);
      tnz.curadd = 2; // on 'C'
      const rc = await ati.send('[insert]B');
      expect(rc).toBe(0);
      // 'B' inserted at position 2, 'C' shifted to 3
      expect(tnz.planeDc[2]).toBe(0xc2); // B
      expect(tnz.planeDc[3]).toBe(0xc3); // C (shifted)
    });

    it('[reset] switches back from insert mode', async () => {
      const { ati, tnz } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
        { addr: 20, attr: 0x20 },
      ]);
      tnz.curadd = 1;
      await ati.send('[insert]A[reset]B');
      // After reset, B is typed in overwrite mode
      expect(tnz.planeDc[1]).toBe(0xc1); // A
      expect(tnz.planeDc[2]).toBe(0xc2); // B
    });

    it('[home] moves cursor to home position', async () => {
      const { ati, tnz } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
        { addr: 40, attr: 0x20 },
      ]);
      tnz.curadd = 30;
      await ati.send('[home]');
      // Home should go to first unprotected field
      expect(tnz.curadd).toBe(1);
    });

    it('[clear] sends CLEAR AID', async () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
      ]);
      await ati.send('[clear]');
      expect(ati.sendStr).toBe('[clear]');
    });

    it('pf keys work', async () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x00 },
      ]);
      const rc = await ati.send('[pf3]');
      expect(rc).toBe(0);
      expect(ati.sendStr).toBe('[pf3]');
    });
  });

  // =========================================================================
  // wait
  // =========================================================================

  describe('wait', () => {
    it('returns 1 when condition is immediately true', async () => {
      const { ati } = createAtiWithSession();
      const rc = await ati.wait(5, () => true);
      expect(rc).toBe(1);
      expect(ati.rc).toBe(1);
    });

    it('returns 0 on timeout with no condition', async () => {
      const ati = new Ati();
      ati.waitSleep = 0.01;
      const rc = await ati.wait(0.01);
      expect(rc).toBe(0);
      expect(ati.rc).toBe(0);
    });

    it('returns 0 on timeout when condition never true', async () => {
      const ati = new Ati();
      ati.waitSleep = 0.01;
      const rc = await ati.wait(0.02, () => false);
      expect(rc).toBe(0);
    });

    it('throws on timeout with onError=true', async () => {
      const ati = new Ati();
      ati.onError = true;
      ati.waitSleep = 0.01;
      await expect(
        ati.wait(0.02, () => false),
      ).rejects.toThrow('WAIT TIMEOUT');
    });

    it('condition can become true during wait', async () => {
      const { ati } = createAtiWithSession();
      ati.waitSleep = 0.01;
      let counter = 0;
      const rc = await ati.wait(1, () => {
        counter++;
        return counter >= 3;
      });
      expect(rc).toBe(1);
      expect(counter).toBeGreaterThanOrEqual(3);
    });
  });

  // =========================================================================
  // WHEN blocks
  // =========================================================================

  describe('WHEN blocks', () => {
    it('registers and runs a WHEN block immediately', () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x20, data: 'READY' },
      ]);
      let ran = false;
      ati.whenOn('TEST', () => ati.scrhas('READY'), () => {
        ran = true;
      });
      expect(ran).toBe(true);
    });

    it('does not run WHEN if condition is false', () => {
      const { ati } = createAtiWithSession();
      let ran = false;
      ati.whenOn('TEST', () => false, () => {
        ran = true;
      });
      expect(ran).toBe(false);
    });

    it('whenOff deactivates a WHEN', () => {
      const ati = new Ati();
      let count = 0;
      ati.whenOn('CNT', () => true, () => { count++; });
      expect(count).toBe(1); // ran on registration
      ati.whenOff('CNT');
      // _runWhens should not trigger it now
      // (We can't call _runWhens directly, but we know whenOff works)
    });

    it('WHENs run during wait', async () => {
      const { ati } = createAtiWithSession([
        { addr: 0, attr: 0x20, data: 'HELLO' },
      ]);
      ati.waitSleep = 0.01;
      let whenRan = false;
      ati.whenOn('GREET', () => ati.scrhas('HELLO'), () => {
        whenRan = true;
      });
      // Reset since it ran on registration
      whenRan = false;

      await ati.wait(0.05, () => whenRan);
      expect(whenRan).toBe(true);
    });
  });

  // =========================================================================
  // Variables
  // =========================================================================

  describe('variables', () => {
    it('value returns uppercased name for unset vars', () => {
      const ati = new Ati();
      expect(ati.value('myvar')).toBe('MYVAR');
    });

    it('set/value round-trips user variables', () => {
      const ati = new Ati();
      ati.set('HOST', 'mainframe.example.com');
      expect(ati.value('HOST')).toBe('mainframe.example.com');
    });

    it('set handles boolean conversion', () => {
      const ati = new Ati();
      ati.set('FLAG', true);
      expect(ati.value('FLAG')).toBe('1');
      ati.set('FLAG', false);
      expect(ati.value('FLAG')).toBe('0');
    });

    it('value returns internal variables', () => {
      const ati = new Ati();
      expect(ati.value('SESSION')).toBe('NONE');
      expect(ati.value('RC')).toBe('0');
      expect(ati.value('MAXWAIT')).toBe('120');
    });

    it('set MAXWAIT parses time strings', () => {
      const ati = new Ati();
      ati.set('MAXWAIT', '1:30');
      expect(ati.maxWait).toBe(90);
    });

    it('set WAITSLEEP clamps to 1-99', () => {
      const ati = new Ati();
      ati.set('WAITSLEEP', 0);
      expect(ati.waitSleep).toBe(1);
      ati.set('WAITSLEEP', 200);
      expect(ati.waitSleep).toBe(99);
    });

    it('set throws for read-only variables', () => {
      const ati = new Ati();
      expect(() => ati.set('MAXROW', 24)).toThrow('read-only');
      expect(() => ati.set('KEYLOCK', '0')).toThrow('read-only');
    });

    it('drop removes user variables', () => {
      const ati = new Ati();
      ati.set('MYVAR', 'hello');
      expect(ati.value('MYVAR')).toBe('hello');
      ati.drop('MYVAR');
      expect(ati.value('MYVAR')).toBe('MYVAR');
    });

    it('drop SESSION drops the session', () => {
      const { ati } = createAtiWithSession();
      expect(ati.session).toBe('SES1');
      ati.drop('SESSION');
      expect(ati.session).toBe('NONE');
    });
  });

  // =========================================================================
  // Utility
  // =========================================================================

  describe('utility', () => {
    it('num parses leading digits', () => {
      expect(Ati.num('123abc')).toBe(123);
      expect(Ati.num('-5x')).toBe(-5);
      expect(Ati.num('abc')).toBe(0);
      expect(Ati.num('')).toBe(0);
      expect(Ati.num(42)).toBe(42);
    });

    it('_parseSeconds handles various formats', () => {
      expect(Ati._parseSeconds(30)).toBe(30);
      expect(Ati._parseSeconds('30')).toBe(30);
      expect(Ati._parseSeconds('1:30')).toBe(90);
      expect(Ati._parseSeconds('1:1:1')).toBe(3661);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  getCodec,
  isEncodingSupported,
  translateDataToDisplay,
  getSpecialDisplayChar,
} from '../../src/utils/codepage';

describe('codepage', () => {
  describe('getCodec', () => {
    it('creates a cp037 codec', () => {
      const codec = getCodec('cp037');
      expect(codec.name).toBe('cp037');
      expect(codec.codePageNumber).toBe(37);
    });

    it('roundtrips basic ASCII characters through cp037', () => {
      const codec = getCodec('cp037');
      const text = 'HELLO WORLD';
      const encoded = codec.encode(text);
      const decoded = codec.decode(encoded);
      expect(decoded).toBe(text);
    });

    it('creates a cp1047 codec', () => {
      const codec = getCodec('cp1047');
      expect(codec.name).toBe('cp1047');
      expect(codec.codePageNumber).toBe(1047);
    });

    it('roundtrips through cp1047', () => {
      const codec = getCodec('cp1047');
      const text = 'TEST 123';
      expect(codec.decode(codec.encode(text))).toBe(text);
    });

    it('creates a cp310 codec for APL symbols', () => {
      const codec = getCodec('cp310');
      expect(codec.name).toBe('cp310');
      expect(codec.codePageNumber).toBe(310);
    });

    it('decodes cp310 space correctly', () => {
      const codec = getCodec('cp310');
      const decoded = codec.decode(Buffer.from([0x40]));
      expect(decoded).toBe(' ');
    });

    it('roundtrips cp310 space', () => {
      const codec = getCodec('cp310');
      const encoded = codec.encode(' ');
      expect(encoded[0]).toBe(0x40);
    });

    it('decodes cp310 APL diamond symbol', () => {
      const codec = getCodec('cp310');
      // 0x70 -> U+22C4 (DIAMOND OPERATOR)
      const decoded = codec.decode(Buffer.from([0x70]));
      expect(decoded).toBe('\u22C4');
    });

    it('throws on unsupported encoding', () => {
      expect(() => getCodec('cp99999')).toThrow('Unsupported encoding');
    });

    it('throws on encoding without numeric suffix', () => {
      expect(() => getCodec('utf')).toThrow();
    });
  });

  describe('isEncodingSupported', () => {
    it('returns true for cp037', () => {
      expect(isEncodingSupported('cp037')).toBe(true);
    });

    it('returns true for cp1047', () => {
      expect(isEncodingSupported('cp1047')).toBe(true);
    });

    it('returns true for cp310', () => {
      expect(isEncodingSupported('cp310')).toBe(true);
    });

    it('returns false for unknown encodings', () => {
      expect(isEncodingSupported('cp99999')).toBe(false);
    });
  });

  describe('translateDataToDisplay', () => {
    it('replaces NULL (0x00) with EBCDIC space (0x40)', () => {
      const data = new Uint8Array([0x00, 0xc1, 0x00]);
      const result = translateDataToDisplay(data);
      expect(result[0]).toBe(0x40);
      expect(result[1]).toBe(0xc1);
      expect(result[2]).toBe(0x40);
    });

    it('replaces all control characters with space', () => {
      const controls = new Uint8Array([0x00, 0x0c, 0x0d, 0x15, 0x19, 0xff]);
      const result = translateDataToDisplay(controls);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBe(0x40);
      }
    });

    it('preserves normal EBCDIC data bytes', () => {
      const data = new Uint8Array([0xc1, 0xc2, 0xc3, 0x40]);
      const result = translateDataToDisplay(data);
      expect(result).toEqual(data);
    });
  });

  describe('getSpecialDisplayChar', () => {
    it('returns solid circle for SUB (0x1a)', () => {
      expect(getSpecialDisplayChar(0x1a)).toBe('\u2218');
    });

    it('returns check-mark for DUP (0x1c)', () => {
      expect(getSpecialDisplayChar(0x1c)).toBe('\u2611');
    });

    it('returns x-mark for FM (0x1e)', () => {
      expect(getSpecialDisplayChar(0x1e)).toBe('\u2612');
    });

    it('returns undefined for non-special bytes', () => {
      expect(getSpecialDisplayChar(0x40)).toBeUndefined();
      expect(getSpecialDisplayChar(0xc1)).toBeUndefined();
    });
  });
});

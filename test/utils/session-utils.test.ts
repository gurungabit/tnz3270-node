import { describe, it, expect } from 'vitest';
import { sessionPsSize, sessionPs14bit } from '../../src/utils/session-utils';

describe('sessionPsSize', () => {
  it('returns predefined HOD sizes by numeric ID', () => {
    expect(sessionPsSize('2')).toEqual({ rows: 24, cols: 80 });
    expect(sessionPsSize('3')).toEqual({ rows: 32, cols: 80 });
    expect(sessionPsSize('4')).toEqual({ rows: 43, cols: 80 });
    expect(sessionPsSize('5')).toEqual({ rows: 27, cols: 132 });
    expect(sessionPsSize('6')).toEqual({ rows: 24, cols: 132 });
    expect(sessionPsSize('7')).toEqual({ rows: 36, cols: 80 });
    expect(sessionPsSize('8')).toEqual({ rows: 36, cols: 132 });
    expect(sessionPsSize('9')).toEqual({ rows: 48, cols: 80 });
    expect(sessionPsSize('10')).toEqual({ rows: 48, cols: 132 });
    expect(sessionPsSize('11')).toEqual({ rows: 72, cols: 80 });
    expect(sessionPsSize('12')).toEqual({ rows: 72, cols: 132 });
    expect(sessionPsSize('13')).toEqual({ rows: 144, cols: 80 });
    expect(sessionPsSize('14')).toEqual({ rows: 144, cols: 132 });
    expect(sessionPsSize('15')).toEqual({ rows: 25, cols: 80 });
    expect(sessionPsSize('16')).toEqual({ rows: 25, cols: 132 });
    expect(sessionPsSize('17')).toEqual({ rows: 62, cols: 160 });
    expect(sessionPsSize('18')).toEqual({ rows: 26, cols: 80 });
    expect(sessionPsSize('19')).toEqual({ rows: 26, cols: 132 });
  });

  it('accepts numeric IDs as numbers', () => {
    expect(sessionPsSize(2)).toEqual({ rows: 24, cols: 80 });
    expect(sessionPsSize(5)).toEqual({ rows: 27, cols: 132 });
  });

  it('parses rowsXcols notation', () => {
    expect(sessionPsSize('43X80')).toEqual({ rows: 43, cols: 80 });
    expect(sessionPsSize('62x160')).toEqual({ rows: 62, cols: 160 });
    expect(sessionPsSize('24x80')).toEqual({ rows: 24, cols: 80 });
  });

  it('parses rowsXcols case-insensitively', () => {
    expect(sessionPsSize('27X132')).toEqual({ rows: 27, cols: 132 });
    expect(sessionPsSize('27x132')).toEqual({ rows: 27, cols: 132 });
  });

  it('throws on invalid values', () => {
    expect(() => sessionPsSize('abc')).toThrow('Not a SESSION_PS_SIZE value');
    expect(() => sessionPsSize('')).toThrow('Not a SESSION_PS_SIZE value');
    expect(() => sessionPsSize('0X0')).toThrow('Not a SESSION_PS_SIZE value');
    expect(() => sessionPsSize('99')).toThrow('Not a SESSION_PS_SIZE value');
  });
});

describe('sessionPs14bit', () => {
  it('preserves small sizes within the 14-bit limit', () => {
    expect(sessionPs14bit(24, 80)).toEqual({ rows: 24, cols: 80 });
    expect(sessionPs14bit(43, 80)).toEqual({ rows: 43, cols: 80 });
    expect(sessionPs14bit(27, 132)).toEqual({ rows: 27, cols: 132 });
  });

  it('enforces minimum of 24 rows and 80 columns', () => {
    expect(sessionPs14bit(10, 40)).toEqual({ rows: 24, cols: 80 });
    expect(sessionPs14bit(1, 1)).toEqual({ rows: 24, cols: 80 });
  });

  it('clamps large dimensions to 14-bit maximum', () => {
    // 127 * 129 = 16383
    const result = sessionPs14bit(200, 200);
    expect(result.rows * result.cols).toBeLessThanOrEqual(16383);
    expect(result).toEqual({ rows: 127, cols: 129 });
  });

  it('handles the 129x127 case', () => {
    const result = sessionPs14bit(200, 100);
    expect(result.rows * result.cols).toBeLessThanOrEqual(16383);
  });

  it('caps rows at 204 and cols at 682', () => {
    const result = sessionPs14bit(300, 80);
    expect(result.rows).toBeLessThanOrEqual(204);

    const result2 = sessionPs14bit(24, 800);
    expect(result2.cols).toBeLessThanOrEqual(682);
  });

  it('reduces rows when product exceeds 16383', () => {
    const result = sessionPs14bit(100, 200);
    expect(result.rows * result.cols).toBeLessThanOrEqual(16383);
    expect(result.cols).toBe(200);
    expect(result.rows).toBe(Math.floor(16383 / 200));
  });
});

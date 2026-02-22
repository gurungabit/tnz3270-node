import { describe, it, expect } from 'vitest';
import { AID, TELNET, ORDER, CMD, FA, Color, ExtendedHighlight } from '../src';

describe('type exports', () => {
  describe('AID constants', () => {
    it('has correct ENTER code', () => {
      expect(AID.ENTER).toBe(0x7d);
    });

    it('has correct CLEAR code', () => {
      expect(AID.CLEAR).toBe(0x6d);
    });

    it('has correct NONE code', () => {
      expect(AID.NONE).toBe(0x60);
    });

    it('has all 24 PF keys', () => {
      const pfKeys = [
        AID.PF1, AID.PF2, AID.PF3, AID.PF4, AID.PF5, AID.PF6,
        AID.PF7, AID.PF8, AID.PF9, AID.PF10, AID.PF11, AID.PF12,
        AID.PF13, AID.PF14, AID.PF15, AID.PF16, AID.PF17, AID.PF18,
        AID.PF19, AID.PF20, AID.PF21, AID.PF22, AID.PF23, AID.PF24,
      ];
      expect(pfKeys).toHaveLength(24);
      // all unique
      expect(new Set(pfKeys).size).toBe(24);
    });

    it('has all 3 PA keys', () => {
      expect(AID.PA1).toBe(0x6c);
      expect(AID.PA2).toBe(0x6e);
      expect(AID.PA3).toBe(0x6b);
    });
  });

  describe('TELNET constants', () => {
    it('has correct IAC', () => {
      expect(TELNET.IAC).toBe(0xff);
    });

    it('has correct negotiation commands', () => {
      expect(TELNET.DO).toBe(0xfd);
      expect(TELNET.DONT).toBe(0xfe);
      expect(TELNET.WILL).toBe(0xfb);
      expect(TELNET.WONT).toBe(0xfc);
    });

    it('has correct subnegotiation delimiters', () => {
      expect(TELNET.SB).toBe(0xfa);
      expect(TELNET.SE).toBe(0xf0);
    });

    it('has correct EOR', () => {
      expect(TELNET.EOR).toBe(0xef);
    });

    it('has telnet option codes', () => {
      expect(TELNET.OPT_BINARY).toBe(0x00);
      expect(TELNET.OPT_TERMINAL_TYPE).toBe(0x18);
      expect(TELNET.OPT_EOR).toBe(0x19);
      expect(TELNET.OPT_TN3270E).toBe(0x28);
      expect(TELNET.OPT_START_TLS).toBe(0x2e);
    });
  });

  describe('ORDER constants', () => {
    it('has correct order codes', () => {
      expect(ORDER.SF).toBe(0x1d);
      expect(ORDER.SBA).toBe(0x11);
      expect(ORDER.IC).toBe(0x13);
      expect(ORDER.PT).toBe(0x05);
      expect(ORDER.RA).toBe(0x3c);
      expect(ORDER.EUA).toBe(0x12);
      expect(ORDER.SA).toBe(0x28);
      expect(ORDER.SFE).toBe(0x29);
      expect(ORDER.MF).toBe(0x2c);
      expect(ORDER.GE).toBe(0x08);
    });
  });

  describe('CMD constants', () => {
    it('has correct 3270 command codes', () => {
      expect(CMD.WRITE).toBe(0xf1);
      expect(CMD.ERASE_WRITE).toBe(0xf5);
      expect(CMD.ERASE_WRITE_ALTERNATE).toBe(0x7e);
      expect(CMD.READ_BUFFER).toBe(0xf2);
      expect(CMD.READ_MODIFIED).toBe(0xf6);
      expect(CMD.WRITE_STRUCTURED_FIELD).toBe(0xf3);
    });
  });

  describe('FA constants', () => {
    it('has correct field attribute flags', () => {
      expect(FA.PROTECTED).toBe(0x20);
      expect(FA.NUMERIC).toBe(0x10);
      expect(FA.MDT).toBe(0x01);
      expect(FA.NON_DISPLAY).toBe(0x0c);
    });
  });

  describe('Color constants', () => {
    it('has correct color values', () => {
      expect(Color.DEFAULT).toBe(0x00);
      expect(Color.BLUE).toBe(0xf1);
      expect(Color.RED).toBe(0xf2);
      expect(Color.GREEN).toBe(0xf4);
      expect(Color.NEUTRAL_WHITE).toBe(0xf7);
    });
  });

  describe('ExtendedHighlight constants', () => {
    it('has correct highlight values', () => {
      expect(ExtendedHighlight.DEFAULT).toBe(0x00);
      expect(ExtendedHighlight.BLINK).toBe(0xf1);
      expect(ExtendedHighlight.REVERSE_VIDEO).toBe(0xf2);
      expect(ExtendedHighlight.UNDERSCORE).toBe(0xf4);
    });
  });
});

import type { Tnz } from './tnz';
import * as bufUtil from './buffer';
import { TnzError, ReadState, bit6 } from './base';
import { AID } from '../types';

export function keyHome(tnz: Tnz): void {
  if (tnz.isProtected(0)) {
    tnz.curadd = tnz._tab(0);
  } else {
    tnz.curadd = 0;
  }
}

export function isProtected(tnz: Tnz, address: number): boolean {
  const [fa1, fattr] = tnz._field(address);
  return fa1 === address || (fattr & 0x20) !== 0;
}

export function isUnprotected(tnz: Tnz): boolean {
  for (const [, fattr] of tnz.fields()) {
    if (isProtectedAttr(fattr)) {
      return false;
    }
  }
  return true;
}

export function keyAid(tnz: Tnz, aid: number): void {
  if (tnz.pwait) throw new TnzError('PWAIT Input Inhibit');
  if (tnz.systemLockWait) throw new TnzError('System Lock Input Inhibit');
  if (tnz.readState === ReadState.RENTER) throw new TnzError('Retry Enter State');

  tnz.inpid = 0;
  tnz.inop = 0x06; // Read Modified

  if (aid !== 0x7f) {
    tnz.systemLockWait = true;
    tnz.pwait = true;
  }

  tnz.readState = ReadState.RENTER;
  tnz.sendAid(aid);
}

export function enter(tnz: Tnz, text?: string): void {
  if (text) keyData(tnz, text);
  keyAid(tnz, AID.ENTER);
}

export function keyCurDown(tnz: Tnz): void {
  tnz.curadd = (tnz.curadd + tnz.maxCol) % tnz.bufferSize;
}

export function keyCurUp(tnz: Tnz): void {
  tnz.curadd = (tnz.curadd - tnz.maxCol + tnz.bufferSize) % tnz.bufferSize;
}

export function keyCurLeft(tnz: Tnz): void {
  tnz.curadd = (tnz.curadd - 1 + tnz.bufferSize) % tnz.bufferSize;
}

export function keyCurRight(tnz: Tnz): void {
  tnz.curadd = (tnz.curadd + 1) % tnz.bufferSize;
}

export function setCursorPosition(tnz: Tnz, row: number, col: number): void {
  if (row < 1 || row > tnz.maxRow) throw new RangeError(`${row} not in range 1-${tnz.maxRow}`);
  if (col < 1 || col > tnz.maxCol) throw new RangeError(`${col} not in range 1-${tnz.maxCol}`);
  tnz.curadd = (row - 1) * tnz.maxCol + (col - 1);
}

export function setDataAt(tnz: Tnz, text: string, row?: number, col?: number): number {
  if (row !== undefined && col !== undefined) {
    setCursorPosition(tnz, row, col);
  }
  return keyData(tnz, text);
}

export function keyTab(tnz: Tnz): void {
  tnz.curadd = tnz._tab(tnz.curadd);
}

export function keyBacktab(tnz: Tnz): void {
  let addr = tnz.curadd;
  let [faddr, fav] = tnz._field(addr);
  if (faddr < 0) {
    tnz.curadd = 0;
    return;
  }

  const bufferSize = tnz.bufferSize;
  const addrM1 = (addr - 1 + bufferSize) % bufferSize;
  if (faddr === addr || faddr === addrM1) {
    addr = (faddr - 1 + bufferSize) % bufferSize;
    [faddr, fav] = tnz._field(addr);
  }

  const fa1 = faddr;
  const planeFa = tnz.planeFa;
  while (true) {
    if (!(fav & 0x20)) {
      addr = (faddr + 1) % bufferSize;
      const fav2 = planeFa[addr];
      if (fav2 === 0) {
        tnz.curadd = addr;
        return;
      }
    }

    faddr = (faddr - 1 + bufferSize) % bufferSize;
    [faddr, fav] = tnz._field(faddr);
    if (faddr === fa1) {
      tnz.curadd = 0;
      return;
    }
  }
}

export function keyNewline(tnz: Tnz): void {
  const addr0 = tnz.curadd;
  const line = Math.floor(addr0 / tnz.maxCol);
  const addr1 = (line + 1) * tnz.maxCol;
  const bufferSize = tnz.bufferSize;
  if (tnz._field(0)[0] === -1) {
    tnz.curadd = addr1 % bufferSize;
  } else {
    const lastCol = (addr1 - 1 + bufferSize) % bufferSize;
    tnz.curadd = lastCol;
    keyTab(tnz);
  }
}

export function keyEnd(tnz: Tnz): void {
  const caddr = tnz.curadd;
  const [faddr, fattr] = tnz._field(caddr);
  if (faddr === -1) return;

  const bufferSize = tnz.bufferSize;
  const faddr1 = (faddr + 1) % bufferSize;
  const [eaddr] = tnz.nextField(caddr);
  if (faddr1 === eaddr) return;

  const fieldDc = bufUtil.rcba(tnz.planeDc, faddr1, eaddr);
  let offset: number;
  if (fieldDc[fieldDc.length - 1] === 0x40) {
    let i = fieldDc.length;
    while (i > 0 && (fieldDc[i - 1] === 0 || fieldDc[i - 1] === 0x40)) i--;
    offset = i;
  } else {
    let i = fieldDc.length;
    while (i > 0 && fieldDc[i - 1] === 0) i--;
    offset = i;
  }

  let newAddr = (faddr1 + offset) % bufferSize;
  if (newAddr === eaddr && !isProtectedAttr(fattr)) {
    newAddr = (newAddr - 1 + bufferSize) % bufferSize;
  }
  tnz.curadd = newAddr;
}


export function _keyBytes(
  tnz: Tnz,
  data: Uint8Array,
  codecIndex: number,
  onerow: boolean,
): number {
  if (tnz.pwait) {
    throw new TnzError('PWAIT Input Inhibit');
  }
  if (tnz.systemLockWait) {
    throw new TnzError('System Lock Input Inhibit');
  }

  const bufferSize = tnz.bufferSize;

  let cax: number;
  if (onerow) {
    let row = Math.floor(tnz.curadd / tnz.maxCol);
    row += 1;
    cax = (row * tnz.maxCol) % bufferSize;
  } else {
    cax = tnz.curadd;
  }

  let charsKeyed = 0;
  let remaining = data;

  while (remaining.length > 0) {
    const ca1 = tnz.curadd;
    if (tnz.planeFa[ca1]) {
      return charsKeyed; // on field attribute
    }

    const dataLen = remaining.length;
    const [fa1, fattr] = tnz._field(ca1);
    if (fattr & 0x20) {
      return charsKeyed; // protected field
    }

    let [fa2] = tnz.nextField(ca1);
    if (fa2 < 0) {
      fa2 = cax;
    }

    let fieldLen: number;
    if (ca1 < fa2) {
      fieldLen = fa2 - ca1;
    } else {
      fieldLen = bufferSize + fa2 - ca1;
    }

    const usedLen = Math.min(fieldLen, dataLen);
    const slice = remaining.slice(0, usedLen);
    const zeros = new Uint8Array(usedLen);
    const csBytes = new Uint8Array(usedLen).fill(codecIndex);

    bufUtil.ucba(tnz.planeDc, ca1, slice);
    bufUtil.ucba(tnz.planeEh, ca1, zeros);
    bufUtil.ucba(tnz.planeCs, ca1, csBytes);
    bufUtil.ucba(tnz.planeFg, ca1, zeros);
    bufUtil.ucba(tnz.planeBg, ca1, zeros);

    // Set MDT
    if (fa1 >= 0) {
      tnz.planeFa[fa1] = bit6(fattr | 1);
    }

    tnz.curadd = (tnz.curadd + usedLen) % bufferSize;

    charsKeyed += usedLen;
    remaining = remaining.slice(usedLen);

    if (tnz.curadd === cax) {
      return charsKeyed;
    }

    const nextFattr = tnz.planeFa[tnz.curadd];
    if (nextFattr) { // on field attribute
      if (!(nextFattr & 0x10)) { // alphanumeric field
        tnz.curadd = (tnz.curadd + 1) % bufferSize;
      } else {
        keyTab(tnz);
      }
    }
  }

  return charsKeyed;
}

export function keyData(tnz: Tnz, text: string): number {
  const encoded = tnz.codec.encode(text);
  return _keyBytes(tnz, encoded, 0, false);
}
export function keyInsData(tnz: Tnz, text: string): number {
  if (tnz.pwait) throw new TnzError('PWAIT Input Inhibit');
  if (tnz.systemLockWait) throw new TnzError('System Lock Input Inhibit');

  const addr0 = tnz.curadd;
  const [faddr, fattr] = tnz._field(addr0);
  if (faddr === addr0) return 0;
  if (fattr & 0x20) return 0;

  const bufferSize = tnz.bufferSize;
  const planeDc = tnz.planeDc;
  const planeEh = tnz.planeEh;
  const planeCs = tnz.planeCs;
  const planeFg = tnz.planeFg;
  const planeBg = tnz.planeBg;

  let addr2: number;
  let dataLen: number;
  if (faddr < 0) {
    addr2 = addr0;
    dataLen = bufferSize;
  } else {
    [addr2] = tnz.nextField(addr0);
    if (addr0 < addr2) dataLen = addr2 - addr0;
    else dataLen = bufferSize - addr0 + addr2;
  }

  let insertText = text;
  if (dataLen < insertText.length) insertText = insertText.slice(0, dataLen);

  let insLen = 0;
  let i = (addr2 - 1 + bufferSize) % bufferSize;
  while (insLen < insertText.length) {
    const dcByte = planeDc[i];
    if (dcByte !== 0 && dcByte !== 0x40) break;
    insLen++;
    i = (i - 1 + bufferSize) % bufferSize;
  }

  if (insLen <= 0) return 0;
  insertText = insertText.slice(0, insLen);

  const addr1 = (addr0 + insLen) % bufferSize;
  const addr3 = (i + 1) % bufferSize;
  const ucba = bufUtil.ucba;
  const rcba = bufUtil.rcba;
  
  ucba(planeDc, addr1, rcba(planeDc, addr0, addr3));
  ucba(planeEh, addr1, rcba(planeEh, addr0, addr3));
  ucba(planeCs, addr1, rcba(planeCs, addr0, addr3));
  ucba(planeFg, addr1, rcba(planeFg, addr0, addr3));
  ucba(planeBg, addr1, rcba(planeBg, addr0, addr3));

  keyData(tnz, insertText);
  return insertText.length;
}

export function keyDelete(tnz: Tnz): boolean {
  const addr0 = tnz.curadd;
  const [faddr, fattr] = tnz._field(addr0);
  if (faddr === addr0) return false;
  if (fattr & 0x20) return false;

  const bufferSize = tnz.bufferSize;
  let addr3: number;
  if (faddr < 0) {
    addr3 = addr0;
  } else {
    [addr3] = tnz.nextField(addr0);
    tnz.planeFa[faddr] = bit6(fattr | 1);
  }

  const addr1 = (addr0 + 1) % bufferSize;
  const addr2 = (addr3 - 1 + bufferSize) % bufferSize;

  if (addr1 !== addr3) {
    bufUtil.ucba(tnz.planeDc, addr0, bufUtil.rcba(tnz.planeDc, addr1, addr3));
    bufUtil.ucba(tnz.planeEh, addr0, bufUtil.rcba(tnz.planeEh, addr1, addr3));
    bufUtil.ucba(tnz.planeCs, addr0, bufUtil.rcba(tnz.planeCs, addr1, addr3));
    bufUtil.ucba(tnz.planeFg, addr0, bufUtil.rcba(tnz.planeFg, addr1, addr3));
    bufUtil.ucba(tnz.planeBg, addr0, bufUtil.rcba(tnz.planeBg, addr1, addr3));
  }

  tnz.planeDc[addr2] = 0;
  tnz.planeEh[addr2] = 0;
  tnz.planeCs[addr2] = 0;
  tnz.planeFg[addr2] = 0;
  tnz.planeBg[addr2] = 0;

  return true;
}

export function keyBackspace(tnz: Tnz): boolean {
  const addr0 = tnz.curadd;
  const [faddr, fattr] = tnz._field(addr0);
  if (faddr === addr0) return false;
  if (fattr & 0x20) return false;

  const addr1 = (addr0 - 1 + tnz.bufferSize) % tnz.bufferSize;
  if (faddr === addr1) return false;

  tnz.curadd = addr1;
  keyDelete(tnz);
  return true;
}

export function keyEraseEof(tnz: Tnz): boolean {
  const addr0 = tnz.curadd;
  const [faddr, fattr] = tnz._field(addr0);
  if (faddr === addr0) return false;
  if (fattr & 0x20) return false;

  let addr2: number;
  if (faddr < 0) {
    addr2 = addr0;
  } else {
    [addr2] = tnz.nextField(addr0);
    tnz.planeFa[faddr] = bit6(fattr | 1);
  }

  tnz._erase(addr0, addr2);
  return true;
}

export function keyEraseInput(tnz: Tnz): void {
  tnz._eraseInput(0, 0);
  tnz._resetMdt();
  keyHome(tnz);
}

export function attn(tnz: Tnz): void {
  if (tnz._tn3270e) {
    tnz.sendCommand(244); // IP
  } else {
    tnz.sendCommand(243); // BRK
  }
}

export function isProtectedAttr(fattr: number): boolean {
  return (fattr & 0x20) !== 0;
}

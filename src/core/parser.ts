import type { Tnz } from './tnz';
import { TnzError, bit6 } from './base';
import { isProtectedAttr } from './keyboard';
import { CMD, ORDER, SF_ID, QR_TYPE } from '../types';

export function _proc3270ds(tnz: Tnz, data: Buffer): void {
  const op = data[0];

  switch (op) {
    case CMD.WRITE:
      _processW(tnz, data, 0, data.length);
      break;
    case CMD.ERASE_WRITE:
      _processEw(tnz, data, 0, data.length);
      break;
    case CMD.ERASE_WRITE_ALTERNATE:
      _processEwa(tnz, data, 0, data.length);
      break;
    case CMD.ERASE_ALL_UNPROTECTED:
      if (data.length !== 1) throw new TnzError(`EAU must be 1 byte, got ${data.length}`);
      _processEau(tnz);
      break;
    case CMD.READ_BUFFER:
      _processRb(tnz);
      break;
    case CMD.READ_MODIFIED:
      _processRm(tnz);
      break;
    case CMD.READ_MODIFIED_ALL:
      _processRma(tnz);
      break;
    case CMD.WRITE_STRUCTURED_FIELD:
      _processWsf(tnz, data, 0, data.length);
      break;
    default:
      if (op === 0x01) _processW(tnz, data, 0, data.length);
      else if (op === 0x02) _processRb(tnz);
      else if (op === 0x05) _processEw(tnz, data, 0, data.length);
      else if (op === 0x06) _processRm(tnz);
      else if (op === 0x0d) _processEwa(tnz, data, 0, data.length);
      else if (op === 0x0f) _processEau(tnz);
      else if (op === 0x11) _processWsf(tnz, data, 0, data.length);
      else throw new TnzError(`Unknown 3270 command: 0x${op.toString(16)}`);
  }

  if (tnz.onScreenUpdate) {
    tnz.onScreenUpdate();
  }
}

export function _processWsf(tnz: Tnz, data: Buffer, start: number, stop: number): void {
  let i = start + 1;
  while (i < stop) {
    const sfLen = data.readUInt16BE(i);
    if (sfLen < 3) throw new TnzError(`Bad Structured Field length: ${sfLen}`);

    const sfId = data[i + 2];
    _processWsfById(tnz, sfId, data, i, i + sfLen);
    i += sfLen;
  }
}

export function _processWsfById(tnz: Tnz, sfId: number, data: Buffer, start: number, stop: number): void {
  switch (sfId) {
    case SF_ID.READ_PARTITION:
      _wsfReadPartition(tnz, data, start, stop);
      break;
    case 0x03:
      _wsfEraseReset(tnz, data, start, stop);
      break;
    case 0x09:
      _wsfSetReplyMode(tnz, data, start, stop);
      break;
    case 0x40:
      _wsfOutbound3270ds(tnz, data, start, stop);
      break;
    case SF_ID.DDM:
      tnz.emit('ddm', data.subarray(start, stop));
      break;
    default:
      throw new TnzError(`Bad Structured Field ID: ${sfId}`);
  }
}

export function _wsfReadPartition(tnz: Tnz, data: Buffer, start: number, stop: number): void {
  const rpType = data[start + 4];
  if (rpType === 0x02) {
    tnz.inop = rpType;
    _queryReply(tnz, data, start, stop);
  } else if (rpType === 0x03) {
    _processRb(tnz);
  } else {
    throw new TnzError(`Unknown Read Partition type: ${rpType}`);
  }
}

export function _wsfEraseReset(tnz: Tnz, data: Buffer, start: number, stop: number): void {
  const sfLen = stop - start;
  if (sfLen < 4) throw new TnzError(`Erase/Reset needs 4 bytes, got ${sfLen}`);
  const ipz = (data[start + 3] & 0x80) !== 0;
  _eraseReset(tnz, ipz);
}

export function _wsfSetReplyMode(tnz: Tnz, data: Buffer, start: number, stop: number): void {
  const pid = data[start + 3];
  if (pid) throw new TnzError('Non-zero PID not implemented');

  const mode = data[start + 4];
  if (mode <= 1) {
    tnz._replyCattrs = Buffer.alloc(0);
  } else if (mode === 2) {
    tnz._replyCattrs = Buffer.from(data.subarray(start + 5, stop));
  } else {
    throw new TnzError(`Bad reply mode: ${mode}`);
  }
  tnz._replyMode = mode;
}

export function _wsfOutbound3270ds(tnz: Tnz, data: Buffer, start: number, stop: number): void {
  const pid = data[start + 3];
  const cmdByte = data[start + 4];

  switch (cmdByte) {
    case CMD.WRITE:
      _processW(tnz, data, start + 4, stop);
      break;
    case CMD.ERASE_WRITE:
      if (pid) throw new TnzError('Non-zero PID not implemented');
      _processEw(tnz, data, start + 4, stop);
      break;
    case CMD.ERASE_WRITE_ALTERNATE:
      if (pid) throw new TnzError('Non-zero PID not implemented');
      _processEwa(tnz, data, start + 4, stop);
      break;
    case CMD.ERASE_ALL_UNPROTECTED:
      if (stop - start !== 5) throw new TnzError(`EAU must be 5 bytes`);
      _processEau(tnz);
      break;
    default:
      throw new TnzError(`Unknown Outbound 3270DS command: 0x${cmdByte.toString(16)}`);
  }
}

export function _eraseReset(tnz: Tnz, ipz: boolean): void {
  tnz.bufferSize = tnz.maxRow * tnz.maxCol;
  tnz.planeDc.fill(0, 0, tnz.bufferSize);
  tnz.planeFa.fill(0, 0, tnz.bufferSize);
  tnz.planeEh.fill(0, 0, tnz.bufferSize);
  tnz.planeCs.fill(0, 0, tnz.bufferSize);
  tnz.planeFg.fill(0, 0, tnz.bufferSize);
  tnz.planeBg.fill(0, 0, tnz.bufferSize);

  (tnz)._resetPartition();

  if (!ipz) {
    tnz.curadd = 0;
  }
}

export function _processW(tnz: Tnz, data: Buffer, start: number, stop: number): void {
  if (stop - start <= 1) return;
  _processOrdersData(tnz, data, start + 2, stop);
  (tnz)._processWcc(data[start + 1]);
}

export function _processEw(tnz: Tnz, data: Buffer, start: number, stop: number): void {
  if (stop - start <= 1) return;
  _eraseReset(tnz, false);
  _processOrdersData(tnz, data, start + 2, stop);
  (tnz)._processWcc(data[start + 1]);
}

export function _processEwa(tnz: Tnz, data: Buffer, start: number, stop: number): void {
  if (stop - start <= 1) return;
  _eraseReset(tnz, true);
  _processOrdersData(tnz, data, start + 2, stop);
  (tnz)._processWcc(data[start + 1]);
}

export function _processEau(tnz: Tnz): void {
  tnz._eraseInput(0, 0);
  tnz._resetMdt();
  tnz.keyHome();
  (tnz)._restoreKeyboard();
}

export function _processRb(tnz: Tnz): void {
  (tnz)._readBuffer();
}

export function _processRm(tnz: Tnz): void {
  tnz.sendAid(0x60, false);
}

export function _processRma(tnz: Tnz): void {
  tnz.sendAid(0x60, false);
}

export function _processOrdersData(tnz: Tnz, data: Buffer, start: number, stop: number): void {
  let p = start;
  while (p < stop) {
    if (ORDER_SET.has(data[p])) {
      p = _processOrder(tnz, data, p, stop);
    } else {
      p = _processCharData(tnz, data, p, stop);
    }
  }
}

const ORDER_SET = new Set<number>([
  ORDER.SF, ORDER.SBA, ORDER.IC, ORDER.PT, ORDER.RA,
  ORDER.EUA, ORDER.GE, ORDER.SA, ORDER.SFE, ORDER.MF,
]);

export function _processOrder(tnz: Tnz, data: Buffer, start: number, stop: number): number {
  const order = data[start];

  switch (order) {
    case ORDER.SF:
      if (start + 1 >= stop) throw new TnzError('SF needs 1 byte');
      tnz.planeFa[tnz.curadd] = bit6(data[start + 1]);
      tnz.planeDc[tnz.curadd] = 0;
      tnz.planeEh[tnz.curadd] = 0;
      tnz.planeCs[tnz.curadd] = 0;
      tnz.planeFg[tnz.curadd] = 0;
      tnz.planeBg[tnz.curadd] = 0;
      tnz.curadd = (tnz.curadd + 1) % tnz.bufferSize;
      return start + 2;

    case ORDER.SBA:
      if (start + 2 >= stop) throw new TnzError('SBA needs 2 bytes');
      tnz.curadd = tnz.addressDecode(data, start + 1);
      return start + 3;

    case ORDER.IC:
      return start + 1;

    case ORDER.PT:
      tnz.curadd = tnz._tab(tnz.curadd);
      return start + 1;

    case ORDER.RA:
      if (start + 3 >= stop) throw new TnzError('RA needs 3 bytes');
      const ea = tnz.addressDecode(data, start + 1);
      const ch = data[start + 3];
      if (ORDER_SET.has(ch) || isProtectedAttr(ch)) {
        throw new TnzError('Invalid character for RA');
      }
      
      let rlen = ea - tnz.curadd;
      if (rlen <= 0) rlen += tnz.bufferSize;
      
      for (let i = 0; i < rlen; i++) {
        const addr = (tnz.curadd + i) % tnz.bufferSize;
        tnz.planeDc[addr] = ch;
        tnz.planeFa[addr] = 0;
        tnz.planeEh[addr] = 0;
        tnz.planeCs[addr] = 0;
        tnz.planeFg[addr] = 0;
        tnz.planeBg[addr] = 0;
      }
      tnz.curadd = ea;
      return start + 4;

    case ORDER.EUA:
      if (start + 2 >= stop) throw new TnzError('EUA needs 2 bytes');
      const euaAddr = tnz.addressDecode(data, start + 1);
      tnz._eraseInput(tnz.curadd, euaAddr);
      tnz.curadd = euaAddr;
      return start + 3;

    case ORDER.SA:
      if (start + 2 >= stop) throw new TnzError('SA needs 2 bytes');
      tnz._processSa(data[start + 1], data[start + 2]);
      return start + 3;

    case ORDER.SFE:
      if (start + 1 >= stop) throw new TnzError('SFE needs 1 byte');
      const numPairs = data[start + 1];
      if (start + 1 + numPairs * 2 >= stop) throw new TnzError('SFE length mismatch');
      
      const sfeAddr = tnz.curadd;
      tnz.planeFa[sfeAddr] = 0;
      tnz.planeDc[sfeAddr] = 0;
      tnz.planeEh[sfeAddr] = 0;
      tnz.planeCs[sfeAddr] = 0;
      tnz.planeFg[sfeAddr] = 0;
      tnz.planeBg[sfeAddr] = 0;
      
      for (let i = 0; i < numPairs; i++) {
        const type = data[start + 2 + i * 2];
        const value = data[start + 3 + i * 2];
        if (type === 0xc0) {
          tnz.planeFa[sfeAddr] = bit6(value);
        } else {
          tnz._processSa(type, value, sfeAddr);
        }
      }
      tnz.curadd = (sfeAddr + 1) % tnz.bufferSize;
      return start + 2 + numPairs * 2;

    case ORDER.MF:
      if (start + 1 >= stop) throw new TnzError('MF needs 1 byte');
      const mfPairs = data[start + 1];
      if (start + 1 + mfPairs * 2 >= stop) throw new TnzError('MF length mismatch');
      const mfAddr = tnz.curadd;
      for (let i = 0; i < mfPairs; i++) {
        const type = data[start + 2 + i * 2];
        const value = data[start + 3 + i * 2];
        if (type === 0xc0) {
          tnz.planeFa[mfAddr] = bit6(value);
        } else {
          tnz._processSa(type, value, mfAddr);
        }
      }
      return start + 2 + mfPairs * 2;

    case ORDER.GE:
      if (start + 1 >= stop) throw new TnzError('GE needs 1 byte');
      const geAddr = tnz.curadd;
      tnz.planeDc[geAddr] = data[start + 1];
      tnz.planeCs[geAddr] = 0xf1;
      tnz.curadd = (geAddr + 1) % tnz.bufferSize;
      return start + 2;

    default:
      throw new TnzError(`Unknown order: 0x${order.toString(16)}`);
  }
}

export function _processCharData(tnz: Tnz, data: Buffer, start: number, stop: number): number {
  let p = start;
  while (p < stop && !ORDER_SET.has(data[p])) {
    const addr = tnz.curadd;
    tnz.planeDc[addr] = data[p];
    tnz.planeCs[addr] = 0; // default character set
    tnz.planeEh[addr] = 0; // default highlighting
    tnz.planeFg[addr] = 0; // default foreground
    tnz.planeBg[addr] = 0; // default background
    tnz.curadd = (addr + 1) % tnz.bufferSize;
    p++;
  }
  return p;
}

export function _queryReply(tnz: Tnz, _req: Buffer, _start: number, _stop: number): void {
  const parts: Buffer[] = [];

  const summaryBuf = Buffer.from([
    0x80,
    0x80,
    QR_TYPE.USABLE_AREA,
    QR_TYPE.CHARACTER_SETS,
    QR_TYPE.HIGHLIGHT,
    QR_TYPE.REPLY_MODES,
    QR_TYPE.DDM,
    QR_TYPE.IMPLICIT_PARTITION,
  ]);
  _addQueryReplyField(parts, summaryBuf);

  const usableAreaBuf = Buffer.alloc(20);
  usableAreaBuf[0] = QR_TYPE.USABLE_AREA;
  usableAreaBuf[1] = 0x01;
  usableAreaBuf[2] = 0x00;
  usableAreaBuf.writeUInt16BE(1, 3);
  usableAreaBuf.writeUInt16BE(1, 5);
  usableAreaBuf.writeUInt16BE(tnz.amaxRow, 7);
  usableAreaBuf.writeUInt16BE(tnz.amaxCol, 9);
  usableAreaBuf.writeUInt16BE(0, 11);
  usableAreaBuf.writeUInt16BE(1, 13);
  usableAreaBuf.writeUInt16BE(tnz.amaxRow, 15);
  usableAreaBuf.writeUInt16BE(tnz.amaxCol, 17);
  _addQueryReplyField(parts, usableAreaBuf.subarray(0, 19));

  const charSetsBuf = Buffer.from([
    QR_TYPE.CHARACTER_SETS, 0x82, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, tnz.cs00 >> 8, tnz.cs00 & 0xff, tnz.cp00 >> 8, tnz.cp00 & 0xff, 0x01, 0x00,
    0x00, 0xf1, tnz.csF1 >> 8, tnz.csF1 & 0xff, tnz.cpF1 >> 8, tnz.cpF1 & 0xff, 0x01, 0x00,
  ]);
  _addQueryReplyField(parts, charSetsBuf);

  const ddmBuf = Buffer.alloc(9);
  ddmBuf[0] = QR_TYPE.DDM;
  ddmBuf[1] = 0x00;
  ddmBuf[2] = 0x00;
  ddmBuf.writeUInt16BE(tnz._limin, 3);
  ddmBuf.writeUInt16BE(tnz._limout, 5);
  ddmBuf[7] = 0x01;
  ddmBuf[8] = 0x01;
  _addQueryReplyField(parts, ddmBuf);

  const replyModesBuf = Buffer.from([
    QR_TYPE.REPLY_MODES, 0x00, 0x01, 0x02,
  ]);
  _addQueryReplyField(parts, replyModesBuf);

  const highlightBuf = Buffer.from([
    QR_TYPE.HIGHLIGHT, 0x04, 0x00, 0xf1, 0xf2, 0xf4, 0xf8,
  ]);
  _addQueryReplyField(parts, highlightBuf);

  const implicitBuf = Buffer.alloc(13);
  implicitBuf[0] = QR_TYPE.IMPLICIT_PARTITION;
  implicitBuf[1] = 0x00;
  implicitBuf[2] = 0x00;
  implicitBuf[3] = 0x0b;
  implicitBuf[4] = 0x01;
  implicitBuf[5] = 0x00;
  implicitBuf[6] = 0x00;
  implicitBuf.writeUInt16BE(tnz.maxRow, 7);
  implicitBuf.writeUInt16BE(tnz.maxCol, 9);
  _addQueryReplyField(parts, implicitBuf.subarray(0, 11));

  const finalPayload = Buffer.concat([Buffer.from([0x88]), ...parts]);
  tnz.send3270Data(finalPayload);
}

function _addQueryReplyField(parts: Buffer[], payload: Buffer): void {
  const lenHeader = Buffer.alloc(2);
  lenHeader.writeUInt16BE(payload.length + 2, 0);
  parts.push(Buffer.concat([lenHeader, payload]));
}

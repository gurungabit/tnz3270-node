import type { Tnz } from './tnz';
import { TnzError } from './base';

export function ucba(buf: Uint8Array, addr: number, bytes: Uint8Array | number[], start = 0, end?: number): void {
  if (end === undefined) end = bytes.length;
  if (addr >= buf.length && buf.length > 0) throw new Error('start too big');
  if (start >= end) return;
  
  const slice = bytes.slice(start, end);
  const bufLen = buf.length;
  const dataLen = slice.length;
  if (addr + dataLen <= bufLen) {
    buf.set(slice, addr);
  } else {
    const chunk1Len = bufLen - addr;
    buf.set(slice.slice(0, chunk1Len), addr);
    buf.set(slice.slice(chunk1Len), 0);
  }
}

export function rcba(buf: Uint8Array, saddr: number, eaddr: number): Uint8Array {
  if (saddr < eaddr) {
    return buf.subarray(saddr, eaddr);
  }
  if (saddr > eaddr) {
    const chunk1 = buf.subarray(saddr);
    const chunk2 = buf.subarray(0, eaddr);
    const result = new Uint8Array(chunk1.length + chunk2.length);
    result.set(chunk1, 0);
    result.set(chunk2, chunk1.length);
    return result;
  }
  const chunk1 = buf.subarray(saddr);
  const chunk2 = buf.subarray(0, eaddr);
  const result = new Uint8Array(chunk1.length + chunk2.length);
  result.set(chunk1, 0);
  result.set(chunk2, chunk1.length);
  return result;
}

export function addressDecode(data: Buffer, start: number): number {
  if (start + 2 > data.length) {
    throw new TnzError('Address decode requires 2 bytes');
  }
  const hi = data[start];
  const lo = data[start + 1];
  return ((hi & 0x3f) << 6) | (lo & 0x3f);
}

export function addressBytes(tnz: Tnz, addr: number): Buffer {
  if (!tnz.addr16bit && tnz.bufferSize <= 4095) {
    const high6 = Math.floor(addr / 64);
    const low6 = addr % 64;
    const bit6 = (v: number) => {
      let nv = v & 0x3f;
      if (nv <= 0x25) nv |= 0x40;
      else if (nv <= 0x3f) nv |= 0xc0;
      return nv;
    };
    return Buffer.from([bit6(high6), bit6(low6)]);
  }

  const baddr = Buffer.alloc(2);
  baddr.writeUInt16BE(addr, 0);
  if (!tnz.addr16bit) {
    baddr[0] &= 0x3f;
  }
  return baddr;
}

export function _checkAddress(tnz: Tnz, address: number): void {
  if (address < 0 || address >= tnz.bufferSize) {
    throw new TnzError(`Invalid address ${address} for buffer size ${tnz.bufferSize}`);
  }
}

export function _erase(tnz: Tnz, saddr: number, eaddr: number): void {
  const bufferSize = tnz.bufferSize;
  const planeDc = tnz.planeDc;
  const planeEh = tnz.planeEh;
  const planeCs = tnz.planeCs;
  const planeFg = tnz.planeFg;
  const planeBg = tnz.planeBg;

  let pos = saddr;
  const stop = eaddr === saddr ? saddr + bufferSize : eaddr;
  let iters = stop > saddr ? stop - saddr : bufferSize - saddr + stop;

  while (iters > 0) {
    planeDc[pos] = 0;
    planeEh[pos] = 0;
    planeCs[pos] = 0;
    planeFg[pos] = 0;
    planeBg[pos] = 0;
    pos = (pos + 1) % bufferSize;
    iters--;
  }
}

export function _eraseInput(tnz: Tnz, saddr: number, eaddr: number): void {
  const bufferSize = tnz.bufferSize;
  const planeFa = tnz.planeFa;
  const planeDc = tnz.planeDc;
  const planeEh = tnz.planeEh;
  const planeCs = tnz.planeCs;
  const planeFg = tnz.planeFg;
  const planeBg = tnz.planeBg;

  let pos = saddr;
  const stop = eaddr === saddr ? saddr + bufferSize : eaddr;
  let iters = stop > saddr ? stop - saddr : bufferSize - saddr + stop;

  let inUnprotectedField = false;
  let [faddr, fattr] = _field(tnz, pos);

  if (faddr >= 0 && faddr !== pos) {
    inUnprotectedField = (fattr & 0x20) === 0;
  }

  while (iters > 0) {
    const fv = planeFa[pos];
    if (fv !== 0) {
      inUnprotectedField = (fv & 0x20) === 0;
    } else if (inUnprotectedField) {
      planeDc[pos] = 0;
      planeEh[pos] = 0;
      planeCs[pos] = 0;
      planeFg[pos] = 0;
      planeBg[pos] = 0;
    }
    pos = (pos + 1) % bufferSize;
    iters--;
  }
}

export function _field(tnz: Tnz, address: number): [number, number] {
  _checkAddress(tnz, address);
  let pos = address;
  const planeFa = tnz.planeFa;
  const bufSize = tnz.bufferSize;

  for (let i = 0; i < bufSize; i++) {
    if (planeFa[pos] !== 0) {
      return [pos, planeFa[pos]];
    }
    pos = (pos - 1 + bufSize) % bufSize;
  }
  return [-1, 0];
}

export function nextField(tnz: Tnz, address: number): [number, number] {
  _checkAddress(tnz, address);
  let pos = (address + 1) % tnz.bufferSize;
  const planeFa = tnz.planeFa;
  const bufSize = tnz.bufferSize;

  for (let i = 0; i < bufSize; i++) {
    if (planeFa[pos] !== 0) {
      return [pos, planeFa[pos]];
    }
    pos = (pos + 1) % bufSize;
  }
  return [-1, 0];
}

export function* _charAddrs(tnz: Tnz, saddr: number, eaddr: number): Generator<number> {
  const bufSize = tnz.bufferSize;
  const planeFa = tnz.planeFa;
  let pos = saddr;

  if (saddr === eaddr) {
    for (let i = 0; i < bufSize; i++) {
      if (planeFa[pos] === 0) yield pos;
      pos = (pos + 1) % bufSize;
    }
    return;
  }

  let len = eaddr > saddr ? eaddr - saddr : bufSize - saddr + eaddr;
  for (let i = 0; i < len; i++) {
    if (planeFa[pos] === 0) yield pos;
    pos = (pos + 1) % bufSize;
  }
}

export function* fields(tnz: Tnz, saddr?: number, eaddr?: number): Generator<[number, number]> {
  const bufSize = tnz.bufferSize;
  const planeFa = tnz.planeFa;

  if (saddr === undefined) {
    for (let pos = 0; pos < bufSize; pos++) {
      if (planeFa[pos] !== 0) yield [pos, planeFa[pos]];
    }
    return;
  }

  if (eaddr === undefined) eaddr = bufSize;
  
  let pos = saddr;
  if (saddr === eaddr) {
    for (let i = 0; i < bufSize; i++) {
      if (planeFa[pos] !== 0) yield [pos, planeFa[pos]];
      pos = (pos + 1) % bufSize;
    }
    return;
  }

  let len = eaddr > saddr ? eaddr - saddr : bufSize - saddr + eaddr;
  for (let i = 0; i < len; i++) {
    if (planeFa[pos] !== 0) yield [pos, planeFa[pos]];
    pos = (pos + 1) % bufSize;
  }
}

export function _tab(tnz: Tnz, saddr: number, _eaddr = 0): number {
  const bufSize = tnz.bufferSize;
  const planeFa = tnz.planeFa;
  let pos = saddr;

  for (let i = 0; i < bufSize; i++) {
    const fv = planeFa[pos];
    if (fv !== 0 && (fv & 0x20) === 0) {
      return (pos + 1) % bufSize;
    }
    pos = (pos + 1) % bufSize;
  }
  return 0;
}

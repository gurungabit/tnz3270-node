import { Tnz } from './tnz';

export function _translateDcToC(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x00 || b === 0x0c || b === 0x0d || b === 0x15 || b === 0x19 || b === 0xff) {
      out[i] = 0x40; // EBCDIC space
    } else {
      out[i] = b;
    }
  }
  return out;
}

export function _translateOrds(str: string): string {
  let result = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x1a) {
      result += '\u2218'; // solid circle
    } else if (cp === 0x1c) {
      result += '\u2611'; // check mark
    } else if (cp === 0x1e) {
      result += '\u2612'; // x mark
    } else {
      result += ch;
    }
  }
  return result;
}

export function* _iterCsAddr(tnz: Tnz, saddr: number, eaddr: number): Generator<number> {
  const planeCs = tnz.planeCs;
  const bufSize = tnz.bufferSize;

  if (saddr === eaddr) {
    let pos = saddr;
    let curVal = planeCs[pos];
    for (let i = 1; i < bufSize; i++) {
      pos = (pos + 1) % bufSize;
      if (planeCs[pos] !== curVal) {
        yield pos;
        curVal = planeCs[pos];
      }
    }
    yield eaddr;
    return;
  }

  let len: number;
  if (eaddr > saddr) {
    len = eaddr - saddr;
  } else {
    len = bufSize - saddr + eaddr;
  }

  let pos = saddr;
  let curVal = planeCs[pos];
  for (let i = 1; i < len; i++) {
    pos = (pos + 1) % bufSize;
    if (planeCs[pos] !== curVal) {
      yield pos;
      curVal = planeCs[pos];
    }
  }
  yield eaddr;
}

export function scrstr(tnz: Tnz, saddr = 0, eaddr = 0, rstrip?: boolean): string {
  if (rstrip === undefined) {
    rstrip = saddr === 0 && eaddr === 0;
  }

  const parts: string[] = [];
  let addr0 = saddr;
  for (const addr1 of _iterCsAddr(tnz, saddr, eaddr)) {
    const raw = Tnz.rcba(tnz.planeDc, addr0, addr1);
    const translated = _translateDcToC(Buffer.from(raw));
    const csIdx = tnz.planeCs[addr0];

    if (csIdx === 0xf1 && tnz._codecF1) {
      parts.push(tnz._codecF1.decode(translated));
    } else {
      parts.push(tnz.codec.decode(translated));
    }
    addr0 = addr1;
  }

  let str = _translateOrds(parts.join(''));

  if (!rstrip) {
    return str;
  }

  const maxCol = tnz.maxCol;
  const rows: string[] = [];
  for (let i = 0; i < tnz.bufferSize; i += maxCol) {
    const end = Math.min(i + maxCol, str.length);
    rows.push(str.slice(i, end).trimEnd());
  }
  rows.push('');
  return rows.join('\n');
}

export function scrhas(tnz: Tnz, text: string, saddr = 0): boolean {
  const fullText = scrstr(tnz, saddr, saddr, false);
  return fullText.includes(text);
}

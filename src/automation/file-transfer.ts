import * as fs from 'node:fs';
import { Tnz, TnzError, TnzTransferError } from '../core/tnz';

export class FileTransfer {
  /** Allow host-initiated IND$FILE GET */
  ddmrecv = false;
  /** Allow host-initiated IND$FILE PUT */
  ddmsend = false;

  private _indsFileBuffer: Buffer | null = null;
  private _indsFileOffset = 0;
  private _indsisf: Buffer | null = null;
  private _indsenc: string | null = null;
  private _indspend: Buffer[] = [];
  
  private _ddmtdat = '';
  private _ddmdata = false;
  private _ddmopen = false;
  private _ddmrecnum = 0;
  private _ddmascii = false;
  private _ddmmsg: string | null = null;
  private _ddmerr: string | null = null;

  public ddmdataStr: string | null = null;
  public ddmdict: Record<string, unknown> = {};

  constructor(private tnz: Tnz) {
    this.tnz.on('ddm', this._handleDdmEvent.bind(this));
  }

  private _handleDdmEvent(data: Buffer): void {
    if (data.length < 5) return;
    const req = data.subarray(2, 5).toString('hex');
    
    try {
      switch (req) {
        case 'd00012':
          this._processDdmOpen(data);
          break;
        case 'd04511':
          this._processDdmSetCursor();
          break;
        case 'd04611':
          this._processDdmGet();
          break;
        case 'd04711':
          this._processDdmInsertReq();
          break;
        case 'd04704':
          this._processDdmDataToInsert(data);
          break;
        case 'd04112':
          this._processDdmClose();
          break;
        default:
          throw new TnzError(`Bad DDM request: ${req}`);
      }
    } catch (err) {
      if (err instanceof Error) {
        this._ddmerr = err.message;
      }
    }
  }

  private _processDdmOpen(data: Buffer): void {
    const ddmLen = data.length;
    if (ddmLen < 35) {
      throw new TnzError(`DDM-Open needs 35 bytes, got ${ddmLen}`);
    }

    const ddmUpload = data[14] === 1;

    let ftBytes: Buffer;
    if (data[26] === 3) {
      ftBytes = data.subarray(28, 35);
    } else if (data[26] === 8) {
      ftBytes = data.subarray(34, 41);
    } else {
      const rec = Buffer.from([0x88, 0x00, 0x0c, 0xd0, 0x00, 0x08, 0x69, 0x04, 0x01, 0x00]);
      this.tnz.send3270Data(rec);
      return;
    }

    const ftStr = ftBytes.toString('latin1');
    const ack = Buffer.from([0x88, 0x00, 0x05, 0xd0, 0x00, 0x09]);

    if (!this._indsFileBuffer && ((!ddmUpload && !this.ddmrecv) || (ddmUpload && !this.ddmsend))) {
      const err = Buffer.from([0x88, 0x00, 0x0c, 0xd0, 0x00, 0x08, 0x69, 0x04, 0x01, 0x00]);
      this.tnz.send3270Data(err);
      return;
    }

    this.tnz.send3270Data(ack);

    this._ddmdata = ftStr === 'FT:DATA';
    this._ddmascii = ftStr !== 'FT:DATA';
    this._ddmopen = true;
    this._ddmrecnum = 0;

    if (ddmUpload && this._indsFileBuffer) {
      this._indsisf = Buffer.alloc(0);
      this._nextGet();
    }
  }

  private _processDdmSetCursor(): void {
    if (this._ddmopen && !this._indsFileBuffer) return;
    if (!this._indsFileBuffer || !this._ddmopen) {
      const err = Buffer.from([0x88, 0x00, 0x0c, 0xd0, 0x45, 0x08, 0x69, 0x04, 0x60, 0x00]);
      this.tnz.send3270Data(err);
    }
  }

  private _processDdmGet(): void {
    if (this._ddmopen && !this._indsFileBuffer) return;
    if (!this._indsFileBuffer || !this._ddmopen) {
      const err = Buffer.from([0x88, 0x00, 0x0c, 0xd0, 0x46, 0x08, 0x69, 0x04, 0x60, 0x00]);
      this.tnz.send3270Data(err);
      return;
    }

    let rec: Buffer;
    if (!this._indsisf || this._indsisf.length === 0) {
      rec = Buffer.from([0x88, 0x00, 0x0c, 0xd0, 0x46, 0x08, 0x69, 0x04, 0x22, 0x00]);
    } else {
      rec = Buffer.concat([Buffer.from([0x88]), this._indsisf]);
    }

    this.tnz.send3270Data(rec);

    if (this._indsisf && this._indsisf.length > 0) {
      this._nextGet();
    }
  }

  private _processDdmInsertReq(): void {
    if (!this._ddmopen) {
      const err = Buffer.from([0x88, 0x00, 0x0c, 0xd0, 0x47, 0x08, 0x69, 0x04, 0x60, 0x00]);
      this.tnz.send3270Data(err);
    }
  }

  private _processDdmDataToInsert(data: Buffer): void {
    const ddmLen = data.length;
    if (ddmLen < 11) throw new TnzError(`DDM-Open needs 11 bytes, got ${ddmLen}`);

    if (!this._ddmopen) {
      const err = Buffer.from([0x88, 0x00, 0x0c, 0xd0, 0x47, 0x08, 0x69, 0x04, 0x60, 0x00]);
      this.tnz.send3270Data(err);
      return;
    }

    let datalen = data.readUInt16BE(8);
    if (datalen <= 5) throw new TnzError('DDM data length is bad');
    datalen -= 5;

    const chunk = data.subarray(10, 10 + datalen);
    if (chunk.length !== datalen) throw new TnzError('DDM data length inconsistent');

    let dataStr = '';
    if (this._ddmascii) {
      dataStr = chunk.toString('latin1');
    } else {
      dataStr = this.tnz.codec.decode(chunk);
    }

    if (!this._ddmdata) {
      this._ddmmsg = dataStr;
    }

    this._ddmrecnum++;

    const ack = Buffer.from([
      0x88, 0x00, 0x0b, 0xd0, 0x47, 0x05, 0x63, 0x06, 0x00, 0x00, 0x00, 0x00,
    ]);
    ack.writeUInt32BE(this._ddmrecnum, 7);
    this.tnz.send3270Data(ack);

    if (this._ddmdata) {
      let processedChunk = chunk;
      if (this._indsenc) {
        if (processedChunk[processedChunk.length - 1] === 0x1a) {
          processedChunk = processedChunk.subarray(0, -1);
        }
      }
      this._indspend.push(processedChunk);
    } else {
      if (this._ddmrecnum === 1) {
        this._ddmtdat = '';
        if (chunk[chunk.length - 1] === 0x1a) {
          dataStr = chunk.subarray(0, -1).toString('latin1');
        }
        dataStr = dataStr.replace(/\r\n/g, '\n');
        this._ddmtdat = dataStr;
      }
    }
  }

  private _processDdmClose(): void {
    const ack = Buffer.from([0x88, 0x00, 0x05, 0xd0, 0x41, 0x09]);
    this.tnz.send3270Data(ack);
    
    this._ddmopen = false;
    
    if (this._indsFileBuffer) {
      this._indsFileBuffer = null;
    }
    
    this.ddmdataStr = this._ddmtdat;
    this._ddmtdat = '';
  }

  private _nextGet(): void {
    this._ddmrecnum++;

    const header = Buffer.from([
      0xd0, 0x46, 0x05, 0x63, 0x06, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x80, 0x61,
    ]);
    header.writeUInt32BE(this._ddmrecnum, 5);

    const maxlen = (this.tnz as any)._limin - header.length - 4; 
    
    if (!this._indsFileBuffer || this._indsFileOffset >= this._indsFileBuffer.length) {
      this._indsisf = Buffer.alloc(0);
      return;
    }

    let chunk = this._indsFileBuffer.subarray(this._indsFileOffset, this._indsFileOffset + maxlen);
    this._indsFileOffset += chunk.length;

    const dataLenHeader = Buffer.alloc(2);
    dataLenHeader.writeUInt16BE(chunk.length + 5, 0);

    const isf = Buffer.concat([header, dataLenHeader, chunk]);
    const lenHeader = Buffer.alloc(2);
    lenHeader.writeUInt16BE(isf.length + 2, 0);
    
    this._indsisf = Buffer.concat([lenHeader, isf]);
  }

  /**
   * Get host file into local file.
   */
  async getFile(parms: string, filename: string): Promise<void> {
    if (this._indsFileBuffer !== null) {
      throw new Error('File transfer already in progress');
    }

    this._ddmmsg = null;
    this._ddmerr = null;
    this._indspend = [];
    this._indsenc = 'latin1';
    
    this._indsFileBuffer = Buffer.alloc(0);
    this.tnz.enter(`IND$FILE GET ${parms}`);

    while (!this._ddmmsg && !this.tnz.seslost) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (this.tnz.seslost) throw new TnzTransferError('Session lost during transfer');
    if (this._ddmerr) throw new TnzTransferError(this._ddmerr);
    
    const finalMsg = this._ddmmsg as string | null;
    if (!finalMsg?.startsWith('TRANS03')) {
      throw new TnzTransferError(finalMsg || 'Unknown transfer error');
    }

    const fullBuffer = Buffer.concat(this._indspend);
    await fs.promises.writeFile(filename, fullBuffer);

    this._indsFileBuffer = null;
    this._indspend = [];
  }

  /**
   * Put host file from local file.
   */
  async putFile(filename: string, parms: string): Promise<void> {
    if (this._indsFileBuffer !== null) {
      throw new Error('File transfer already in progress');
    }

    this._ddmmsg = null;
    this._ddmerr = null;
    this._indsFileOffset = 0;

    this._indsFileBuffer = await fs.promises.readFile(filename);
    this.tnz.enter(`IND$FILE PUT ${parms}`);

    while (!this._ddmmsg && !this.tnz.seslost) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (this.tnz.seslost) throw new TnzTransferError('Session lost during transfer');
    if (this._ddmerr) throw new TnzTransferError(this._ddmerr);
    
    const finalMsg = this._ddmmsg as string | null;
    if (!finalMsg?.startsWith('TRANS03')) {
      throw new TnzTransferError(finalMsg || 'Unknown transfer error');
    }

    this._indsFileBuffer = null;
  }
}

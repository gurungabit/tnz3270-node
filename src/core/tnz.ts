/**
 * TN3270 terminal class.
 *
 * Core class for telnet-3270 connection, protocol negotiation,
 * screen buffers, and keyboard input. One instance per terminal session.
 *
 * Reference: Python TNZ tnz.py (4,967 lines)
 *
 * @module core/tnz
 */

import * as net from 'node:net';
import * as tls from 'node:tls';

import { AID, CMD, ORDER, QR_TYPE, SF_ID, TELNET } from '../types';
import { TnzError, TnzTerminalError, bit6, ReadState } from './base';
import * as kb from './keyboard';
import * as screen from './screen';
import * as bufUtil from './buffer';

import type { CodecEntry, TnzOptions } from '../types';
export { TnzError, TnzTerminalError, TnzTransferError, bit6, ReadState } from './base';
import { getCodec } from '../utils/codepage';
import {
  escapeIac,
  findIacSequences,
  unescapeIac,
} from './telnet';

// ---------------------------------------------------------------------------
// Tnz class
// ---------------------------------------------------------------------------

/** Options for Tnz.connect(). */
interface ConnectOptions {
  /** Use TLS/SSL for the connection (default: false) */
  secure?: boolean;
  /** Verify the server certificate (default: true) */
  verifyCert?: boolean;
}

/**
 * TN3270 terminal — one instance per connection.
 *
 * Handles telnet negotiation, 3270 data stream parsing, screen buffers,
 * and keyboard input. Used directly or wrapped by Ati for automation.
 *
 * Week 2 scope: constructor, connect, telnet negotiation, send methods,
 * wait, address helpers, buffer planes. 3270 command processing is stubbed
 * and will be implemented in Week 3.
 */
import { EventEmitter } from 'node:events';

export class Tnz extends EventEmitter {
  // -- Public state --

  /** Whether to negotiate TN3270E protocol */
  useTn3270e = false;
  /** Logical unit name for TN3270E */
  luName: string | null = null;
  /** Number of colors supported (default 768) */
  colors = 768;

  /** Terminal type string sent during negotiation */
  terminalType = 'IBM-DYNAMIC';
  /** Default screen rows */
  dmaxRow = 24;
  /** Default screen columns */
  dmaxCol = 80;
  /** Alternate screen rows */
  amaxRow = 24;
  /** Alternate screen columns */
  amaxCol = 80;
  /** Current screen rows */
  maxRow = 24;
  /** Current screen columns */
  maxCol = 80;
  /** Total buffer size (maxRow * maxCol) */
  bufferSize = 1920; // 24 * 80

  /** Cursor address (0-based into buffer) */
  curadd = 0;
  /** Current buffer address for data stream processing */
  bufadd = 0;
  /** Whether buffer addresses are 16-bit (vs 12-bit/14-bit) */
  addr16bit = false;

  /** Current AID (Attention Identifier) */
  aid: number = AID.NONE;
  /** PWAIT/TWAIT input inhibit */
  pwait = false;
  /** System lock input inhibit */
  systemLockWait = true;
  /** Current 3270 read state */
  readState = ReadState.NORMAL;
  /** Input operation mode */
  inop = 0x06; // right initialization (RM)
  /** Input partition ID */
  inpid = 0;

  /** Whether the terminal claims color capability */
  capableColor = false;

  /** Character buffer updated flag */
  updated = false;
  /** Session/connection lost (false=connected, true=normal close, Error=error) */
  seslost: boolean | Error = false;

  /** Last command string (for file transfer) */
  lastcmd: string | null = null;

  // -- Buffer planes (6 parallel arrays) --

  /** Data characters (EBCDIC) */
  planeDc: Uint8Array;
  /** Field attributes */
  planeFa: Uint8Array;
  /** Extended highlighting */
  planeEh: Uint8Array;
  /** Character set */
  planeCs: Uint8Array;
  /** Foreground color */
  planeFg: Uint8Array;
  /** Background color */
  planeBg: Uint8Array;

  // -- Network I/O counters --

  /** Total bytes sent */
  bytesSent = 0;
  /** Total bytes received */
  bytesReceived = 0;
  /** Local binary mode active */
  binaryLocal = false;
  /** Remote binary mode active */
  binaryRemote = false;

  // -- Telnet option negotiation tracking --

  /** Options we have sent DO for */
  localDo = new Set<number>();
  /** Options we have sent WILL for */
  localWill = new Set<number>();
  /** Options we have sent WONT for */
  localWont = new Set<number>();
  /** Options we have sent DONT for */
  localDont = new Set<number>();
  /** Options the remote has sent DO for */
  remoteDo = new Set<number>();
  /** Options the remote has sent WILL for */
  remoteWill = new Set<number>();
  /** Options the remote has sent WONT for */
  remoteWont = new Set<number>();
  /** Options the remote has sent DONT for */
  remoteDont = new Set<number>();

  // -- DDM limits --

  /** DDM inbound limit */
  _limin = 32639;
  /** DDM outbound limit */
  _limout = 32767;

  // -- Instance name --

  /** Name of this Tnz instance */
  name: string;

  // -- Encoding --

  tn3270eNegotiated = false;
  /** GE (Graphic Escape) support: 0=none, 1=supported for char set F1 */
  alt = 0;
  /** Character set ID for index 0x00 */
  cs00 = 697;
  /** Code page for index 0x00 */
  cp00 = 37;
  /** Character set ID for index 0xF1 */
  csF1 = 0;
  /** Code page for index 0xF1 */
  cpF1 = 0;

  // -- Private state --

  private _socket: net.Socket | tls.TLSSocket | null = null;
  private _secure = false;
  private _certVerified = false;
  private _hostVerified = false;
  private _startTlsHostname: string | null = null;
  private _startTlsCompleted = false;
  private _verifyCert = true;
  private _eor = false;
  /** @internal */ _tn3270e = false;
  private _workBuffer = Buffer.alloc(0);
  private _pendingRecord = Buffer.alloc(0);
  private _sendBuf: Buffer[] = [];
  private _waiting = false;
  private _waitRv: boolean | null = null;
  private _eventResolvers = new Set<() => void>();
  /** @internal reply mode — used in Week 3 command processing */
  _replyMode = 0; // Field mode
  /** @internal reply character attrs — used in Week 3 command processing */
  _replyCattrs = Buffer.alloc(0);
  private _extendedColorMode = false;
  /** @internal extended highlighting proc state — used in Week 3 */
  _procEh = 0;
  /** @internal character set proc state — used in Week 3 */
  _procCs = 0;
  /** @internal foreground color proc state — used in Week 3 */
  _procFg = 0;
  /** @internal background color proc state — used in Week 3 */
  _procBg = 0;
  private _encoding = 'cp037';
  private _codec: CodecEntry;
  /** @internal */ _codecF1: CodecEntry | null = null;
  
  /** Optional callback fired when the screen is updated by the host. */
  onScreenUpdate?: () => void;

  // -- Read lines (stub for later) --
  readlines: unknown = null;
  readlinesPa2 = true;

  constructor(name?: string, options?: TnzOptions) {
    super();
    this.name = name ?? `tnz-${Date.now()}`;

    // Apply options
    if (options) {
      if (options.useTn3270e !== undefined) {
        this.useTn3270e = options.useTn3270e;
      }
      if (options.luName !== undefined) this.luName = options.luName;
      if (options.terminalType !== undefined) {
        this.terminalType = options.terminalType;
      }
      if (options.amaxRow !== undefined) this.amaxRow = options.amaxRow;
      if (options.amaxCol !== undefined) this.amaxCol = options.amaxCol;
      if (options.encoding !== undefined) this._encoding = options.encoding;
      if (options.onScreenUpdate !== undefined) {
        this.onScreenUpdate = options.onScreenUpdate;
      }
    }

    // Initialize codec
    this._codec = getCodec(this._encoding);
    this.cp00 = this._codec.codePageNumber;

    // Initialize buffer planes
    this.planeDc = new Uint8Array(this.bufferSize);
    this.planeFa = new Uint8Array(this.bufferSize);
    this.planeEh = new Uint8Array(this.bufferSize);
    this.planeCs = new Uint8Array(this.bufferSize);
    this.planeFg = new Uint8Array(this.bufferSize);
    this.planeBg = new Uint8Array(this.bufferSize);
  }

  // -- Encoding property --

  /** Get the current EBCDIC encoding name. */
  get encoding(): string {
    return this._encoding;
  }

  /** Set the EBCDIC encoding (e.g. 'cp037', 'cp1047'). */
  set encoding(value: string) {
    this._codec = getCodec(value);
    this._encoding = value;
    this.cp00 = this._codec.codePageNumber;
  }

  /** Get the primary codec. */
  get codec(): CodecEntry {
    return this._codec;
  }

  /**
   * Register a secondary encoding for Graphic Escape (GE) character set.
   * Used for APL characters (cp310) on char set index 0xF1.
   */
  setGeEncoding(encoding: string): void {
    this._codecF1 = getCodec(encoding);
    this.cpF1 = this._codecF1.codePageNumber;
    if (this.cpF1 === 310) {
      this.alt = 1; // Support GE for char set ID F1
      this.csF1 = 963;
    } else {
      this.csF1 = 697;
    }
  }

  // -- Connection state properties --

  /** Whether the connection is secure (TLS). */
  get secure(): boolean {
    return this._secure;
  }

  /** Whether the server certificate was verified. */
  get certVerified(): boolean {
    return this._certVerified;
  }

  /** Whether the server hostname was verified. */
  get hostVerified(): boolean {
    return this._hostVerified;
  }

  /** Whether STARTTLS upgrade completed. */
  get startTlsCompleted(): boolean {
    return this._startTlsCompleted;
  }

  /** Whether TN3270E protocol is in use. */
  get tn3270e(): boolean {
    return this._tn3270e;
  }

  /** Whether EOR mode is active. */
  get eorMode(): boolean {
    return this._eor;
  }

  /** Whether screen uses extended color mode. */
  get extendedColorMode(): boolean {
    return this._extendedColorMode;
  }

  /** Whether DDM transfer is in progress. */
  ddmInProgress(): boolean {
    return false; // stub — Phase 3
  }

  // =========================================================================
  // Connection
  // =========================================================================

  /**
   * Connect to a TN3270 host.
   *
   * @param host - Hostname or IP (default: '127.0.0.1')
   * @param port - Port number (default: 23 for plain, 992 for TLS)
   * @param options - Connection options (secure, verifyCert)
   * @throws {TnzError} if already connected
   *
   * Reference: Python TNZ tnz.py lines 371-451
   */
  async connect(
    host?: string,
    port?: number,
    options?: ConnectOptions,
  ): Promise<void> {
    if (this._socket) {
      throw new TnzError('Already connected');
    }

    const secure = options?.secure ?? false;
    const verifyCert = options?.verifyCert ?? true;
    this._verifyCert = verifyCert;
    const actualHost = host ?? '127.0.0.1';
    const actualPort = port ?? (secure ? 992 : 23);

    // Save hostname for potential STARTTLS later
    if (!secure && host) {
      this._startTlsHostname = actualHost;
    }

    return new Promise<void>((resolve, reject) => {
      let socket: net.Socket;

      const onConnect = (): void => {
        this.seslost = false;
        if (secure && socket instanceof tls.TLSSocket) {
          this._secure = true;
          if (verifyCert) {
            this._certVerified = !socket.authorizationError;
            this._hostVerified = !socket.authorizationError;
          }
        }
        resolve();
      };

      const onError = (err: Error): void => {
        this.seslost = err;
        this._setEvent();
        // Only reject if we haven't resolved yet
        reject(err);
      };

      if (secure) {
        socket = tls.connect(
          {
            host: actualHost,
            port: actualPort,
            rejectUnauthorized: verifyCert,
            servername: actualHost,
          },
          onConnect,
        );
      } else {
        socket = net.createConnection(
          { host: actualHost, port: actualPort },
          onConnect,
        );
      }

      this._socket = socket;
      socket.on('data', (data: Buffer) => this._dataReceived(data));
      socket.on('error', onError);
      socket.on('close', () => {
        if (!this.seslost) this.seslost = true;
        this._socket = null;
        this._setEvent();
      });
      socket.on('end', () => {
        // EOF — server closed its end
      });
    });
  }

  /**
   * Upgrade the current plaintext connection to TLS (STARTTLS).
   *
   * Called when the server sends IAC SB START_TLS FOLLOWS.
   *
   * Reference: Python TNZ tnz.py lines 4518-4565
   */
  private async _startTls(): Promise<void> {
    const oldSocket = this._socket;
    if (!oldSocket) {
      throw new TnzError('No socket to upgrade');
    }

    // Remove listeners from plain socket (TLS will wrap it)
    oldSocket.removeAllListeners('data');
    oldSocket.removeAllListeners('error');
    oldSocket.removeAllListeners('close');
    oldSocket.removeAllListeners('end');
    this._socket = null;

    return new Promise<void>((resolve, reject) => {
      const tlsSocket = tls.connect({
        socket: oldSocket,
        rejectUnauthorized: this._verifyCert,
        servername: this._startTlsHostname ?? undefined,
      });

      tlsSocket.once('secureConnect', () => {
        this._socket = tlsSocket;
        this._secure = true;
        this._startTlsCompleted = true;
        if (this._verifyCert) {
          this._certVerified = !tlsSocket.authorizationError;
          this._hostVerified = !tlsSocket.authorizationError;
        }

        // Re-attach event handlers
        tlsSocket.on('data', (data: Buffer) => this._dataReceived(data));
        tlsSocket.on('error', (err: Error) => {
          this.seslost = err;
          this._setEvent();
        });
        tlsSocket.on('close', () => {
          if (!this.seslost) this.seslost = true;
          this._socket = null;
          this._setEvent();
        });

        // Flush any buffered data
        this.send();
        resolve();
      });

      tlsSocket.once('error', (err: Error) => {
        this.seslost = err;
        this._setEvent();
        reject(err);
      });
    });
  }

  /**
   * Close the connection immediately (abort).
   *
   * Reference: Python TNZ tnz.py lines 363-369
   */
  close(): void {
    const socket = this._socket;
    if (socket) {
      this._socket = null;
      socket.destroy();
    }
  }

  /**
   * Shut down the connection gracefully.
   *
   * Reference: Python TNZ tnz.py lines 1853-1858
   */
  shutdown(): void {
    this.close();
  }

  // =========================================================================
  // Wait
  // =========================================================================

  /**
   * Signal that an event occurred (data received, session lost, etc.).
   * Wakes up any pending wait() call.
   */
  private _setEvent(): void {
    for (const resolve of this._eventResolvers) {
      resolve();
    }
    this._eventResolvers.clear();
  }

  /**
   * Wait for an event (data received, timeout, or session lost).
   *
   * @param timeout - Timeout in seconds (undefined = wait forever)
   * @returns true if session lost, false if timeout, null otherwise
   * @throws {TnzError} if already waiting
   *
   * Reference: Python TNZ tnz.py lines 1922-1980
   */
  async wait(timeout?: number): Promise<boolean | null> {
    if (this.seslost) {
      return true;
    }

    if (this._waiting) {
      throw new TnzError('Already waiting');
    }

    this._waiting = true;
    this._waitRv = null;

    try {
      await new Promise<void>((resolve) => {
        this._eventResolvers.add(resolve);

        if (timeout !== undefined) {
          const timer = setTimeout(() => {
            this._eventResolvers.delete(resolve);
            if (this._waitRv === null) {
              this._waitRv = false;
            }
            resolve();
          }, timeout * 1000);

          // Store original resolve to clear timer on event
          const originalResolve = resolve;
          this._eventResolvers.delete(resolve);
          const wrappedResolve = (): void => {
            clearTimeout(timer);
            originalResolve();
          };
          this._eventResolvers.add(wrappedResolve);
        }
      });

      if (this.seslost) return true;
      return this._waitRv;
    } finally {
      this._waitRv = null;
      this._waiting = false;
    }
  }

  // =========================================================================
  // Send methods
  // =========================================================================

  /**
   * Send data to the host (IAC-escaped) and flush the send buffer.
   *
   * If data is provided, it is IAC-escaped and appended to the buffer.
   * Then all buffered data is written to the socket.
   *
   * Reference: Python TNZ tnz.py lines 1560-1585
   */
  send(data?: Buffer): void {
    if (data && data.length > 0) {
      this._sendBuf.push(escapeIac(data));
    }

    const socket = this._socket;
    if (!socket) return;
    if (socket.closed) return;

    if (this._sendBuf.length === 0) return;

    const combined = Buffer.concat(this._sendBuf);
    socket.write(combined);
    this.bytesSent += combined.length;
    this._sendBuf.length = 0;
  }

  /**
   * Send a 3270-DATA record to the host.
   * Adds TN3270E header if in TN3270E mode, IAC-escapes, appends IAC EOR.
   *
   * Reference: Python TNZ tnz.py lines 1587-1600
   */
  send3270Data(value: Buffer): void {
    const escaped = escapeIac(value);
    if (this._tn3270e) {
      // 3270-DATA TN3270E header: 5 zero bytes
      this._sendBuf.push(Buffer.alloc(5));
    }
    this._sendBuf.push(escaped);
    this._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.EOR]));
    this.send();
  }

  /**
   * Send a record to the host with IAC escaping and EOR.
   * (No TN3270E header — used for TN3270E RESPONSE records.)
   *
   * Reference: Python TNZ tnz.py lines 1772-1781
   */
  sendRec(value: Buffer): void {
    const escaped = escapeIac(value);
    this._sendBuf.push(escaped);
    this._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.EOR]));
    this.send();
  }

  /**
   * Send IAC WILL to the host.
   *
   * Reference: Python TNZ tnz.py lines 1806-1817
   */
  sendWill(opt: number, buffer = false): void {
    this.localWill.add(opt);
    this.localWont.delete(opt);

    this._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.WILL, opt]));
    if (!buffer) this.send();
  }

  /**
   * Send IAC WONT to the host.
   *
   * Reference: Python TNZ tnz.py lines 1819-1830
   */
  sendWont(opt: number, buffer = false): void {
    this.localWont.add(opt);
    this.localWill.delete(opt);

    this._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.WONT, opt]));
    if (!buffer) this.send();
  }

  /**
   * Send IAC DO to the host.
   *
   * Reference: Python TNZ tnz.py lines 1734-1751
   */
  sendDo(opt: number, buffer = false): void {
    if (opt === TELNET.OPT_BINARY) {
      this.binaryRemote = true;
    } else if (opt === TELNET.OPT_EOR) {
      this._eor = true;
    }

    this.localDo.add(opt);
    this.localDont.delete(opt);

    this._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.DO, opt]));
    if (!buffer) this.send();
  }

  /**
   * Send IAC DONT to the host.
   *
   * Reference: Python TNZ tnz.py lines 1753-1770
   */
  sendDont(opt: number, buffer = false): void {
    if (opt === TELNET.OPT_BINARY) {
      this.binaryRemote = false;
    } else if (opt === TELNET.OPT_EOR) {
      this._eor = false;
    }

    this.localDont.add(opt);
    this.localDo.delete(opt);

    this._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.DONT, opt]));
    if (!buffer) this.send();
  }

  /**
   * Send subnegotiation data (bookended with IAC SB ... IAC SE).
   *
   * Reference: Python TNZ tnz.py lines 1783-1794
   */
  sendSub(value: Buffer, buffer = false): void {
    const escaped = escapeIac(value);
    this._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.SB]));
    this._sendBuf.push(escaped);
    this._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.SE]));
    if (!buffer) this.send();
  }

  /**
   * Send the terminal type subnegotiation.
   *
   * Reference: Python TNZ tnz.py lines 1796-1804
   */
  sendTerminalType(buffer = false): void {
    const data = Buffer.concat([
      Buffer.from([TELNET.OPT_TERMINAL_TYPE, TELNET.TERMINAL_TYPE_IS]),
      Buffer.from(this.terminalType, 'ascii'),
    ]);
    this.sendSub(data, buffer);
  }

  /**
   * Send a single-byte telnet command (e.g., NOP, BRK, IP).
   *
   * @param code - Command code (241-249)
   * @throws {TnzError} if code is not in valid range
   *
   * Reference: Python TNZ tnz.py lines 1700-1732
   */
  sendCommand(code: number): void {
    if (code < 241 || code > 249) {
      throw new TnzError(`Telnet command ${code} not valid`);
    }
    this._sendBuf.push(Buffer.from([TELNET.IAC, code]));
    this.send();
  }

  // =========================================================================
  // Address helpers
  // =========================================================================

  /**
   * Decode a 2-byte encoded buffer address to an integer.
   *
   * Handles 12-bit (6+6), 14-bit, and 16-bit addressing modes.
   *
   * Reference: Python TNZ tnz.py lines 289-315
   */
  address(addressBytes: Buffer): number {
    if (addressBytes.length !== 2) {
      throw new TnzError('address_bytes must be exactly 2 bytes');
    }

    const byte0 = addressBytes[0];
    const byte1 = addressBytes[1];

    // 12-bit mode: bit 0 of byte0 is set (0x40 mask)
    if (!this.addr16bit && byte0 & 0x40) {
      const high6 = byte0 & 0x3f;
      const low6 = byte1 & 0x3f;
      return high6 * 64 + low6;
    }

    // Reserved mode check
    if (!this.addr16bit && byte0 & 0x80) {
      throw new TnzError('reserved address mode');
    }

    // 14-bit or 16-bit mode
    let addr = (byte0 << 8) | byte1;

    // Weird case: 16-bit addr > buffer_size, try as 12-bit
    if (this.addr16bit && addr > this.bufferSize) {
      this.addr16bit = false;
      addr = this.address(addressBytes);
      this.addr16bit = true;
    }

    return addr;
  }


  // =========================================================================
  // Telnet negotiation and sending
  // =========================================================================

  /**
   * Handle pending record data between IAC commands.
   *
   * Reference: Python TNZ tnz.py lines 2088-2098
   */
  private _dataTelnet(buff: Buffer, start: number, stop: number): void {
    if (start >= stop) return;

    if (!this._eor) {
      // Unexpected data in non-EOR mode
      return;
    }

    this._pendingRecord = Buffer.concat([
      this._pendingRecord,
      buff.subarray(start, stop),
    ]);
  }

  /**
   * Process received data from the socket.
   *
   * Parses telnet IAC sequences, handles EOR records, subnegotiation,
   * and dispatches to _process() and _proc3270ds().
   *
   * @param buff - Raw bytes received from the socket
   * @returns Number of bytes consumed
   *
   * Reference: Python TNZ tnz.py lines 2020-2086
   */
  _dataReceived(buff: Buffer): number {
    // Prepend any leftover bytes from previous call
    if (this._workBuffer.length > 0) {
      buff = Buffer.from(Buffer.concat([this._workBuffer, buff]));
    }

    let byteStart = 0;
    let subcStart: number | null = null;

    try {
      const matches = findIacSequences(buff);

      for (const mat of matches) {
        const cmdByte = mat.command;

        // IAC IAC — escaped data byte 0xFF, skip
        if (cmdByte === 0xff) continue;

        if (subcStart !== null) {
          // Inside subnegotiation — waiting for IAC SE
          if (cmdByte === TELNET.SE) {
            // Process subneg: includes IAC SB prefix, excludes IAC SE
            this._process(buff.subarray(subcStart, mat.start));
            byteStart = mat.end;
            subcStart = null;
          }
          // Ignore other commands inside subnegotiation
        } else if (cmdByte === TELNET.EOR && this._eor) {
          // End of record
          this._waitRv = true;
          this._setEvent();

          // Collect record data: pending + current chunk
          const recRaw = Buffer.from(
            Buffer.concat([
              this._pendingRecord,
              Buffer.from(buff.subarray(byteStart, mat.start)),
            ]),
          );
          const rec = unescapeIac(recRaw);
          this._pendingRecord = Buffer.alloc(0);
          this.bytesReceived += rec.length;
          byteStart = mat.end;

          try {
            this._proc3270ds(rec);
          } catch (err) {
            if (err instanceof TnzError) {
              this.seslost = err;
              return byteStart;
            }
            throw err;
          }
        } else if (cmdByte === TELNET.SB) {
          // Start of subnegotiation
          subcStart = mat.start; // includes IAC SB
          this._dataTelnet(buff, byteStart, subcStart);
          byteStart = subcStart;
        } else {
          // Other IAC command (DO, DONT, WILL, WONT, etc.)
          this._dataTelnet(buff, byteStart, mat.start);
          byteStart = mat.end;

          // Build the full command buffer for _process
          const cmdLen = mat.end - mat.start;
          this._process(buff.subarray(mat.start, mat.start + cmdLen));
        }
      }

      // Non-EOR mode: process any remaining data
      if (!this._eor && byteStart < buff.length) {
        this._dataTelnet(buff, byteStart, buff.length);
        byteStart = buff.length;
      }
    } finally {
      // Save unprocessed bytes for next call
      this._workBuffer = Buffer.from(buff.subarray(byteStart));
    }

    return byteStart;
  }

  // =========================================================================
  // Telnet option negotiation
  // =========================================================================

  /**
   * Process a telnet command or subnegotiation.
   *
   * The data buffer starts with IAC and contains the full command.
   * For subnegotiations, it includes IAC SB ... (without trailing IAC SE).
   *
   * Reference: Python TNZ tnz.py lines 2154-2344
   */
  _process(data: Buffer): void {
    if (data.length < 2) return;

    const iacByte = data[0];
    const cmdByte = data[1];

    if (iacByte !== TELNET.IAC) return;

    // ----- IAC DO -----
    if (cmdByte === TELNET.DO && data.length >= 3) {
      const opt = data[2];

      if (opt === TELNET.OPT_TN3270E) {
        if (this.useTn3270e) {
          this.sendWill(opt, true);
        } else {
          this.sendWont(opt, true);
        }
      } else if (opt === TELNET.OPT_BINARY) {
        if (!this.localWill.has(opt)) {
          this.sendWill(opt, true);
        }
      } else if (opt === TELNET.OPT_TERMINAL_TYPE) {
        if (!this.localWill.has(opt)) {
          this.sendWill(opt, true);
        }
      } else if (opt === TELNET.OPT_EOR) {
        if (!this.localWill.has(opt)) {
          this.sendWill(opt, true);
        }
        if (!this.localDo.has(opt)) {
          this.sendDo(opt, true);
        }
      } else if (opt === TELNET.OPT_START_TLS) {
        if (!this.localWill.has(opt)) {
          this.sendWill(opt, true);
        }
        // Send START_TLS FOLLOWS subnegotiation
        this.sendSub(
          Buffer.from([TELNET.OPT_START_TLS, TELNET.START_TLS_FOLLOWS]),
          true,
        );
      } else {
        // Unknown option (e.g. Timing mark) — refuse
        this.sendWont(opt, true);
      }

      this.remoteDo.add(opt);
      this.remoteDont.delete(opt);

    // ----- IAC DONT -----
    } else if (cmdByte === TELNET.DONT && data.length >= 3) {
      const opt = data[2];

      this.remoteDont.add(opt);
      this.remoteDo.delete(opt);

      // Don't send WONT for BINARY or EOR
      if (opt !== TELNET.OPT_BINARY && opt !== TELNET.OPT_EOR) {
        if (!this.localWont.has(opt)) {
          this.sendWont(opt, true);
        }
      }

    // ----- IAC WILL -----
    } else if (cmdByte === TELNET.WILL && data.length >= 3) {
      const opt = data[2];

      // TRANSMIT-BINARY: grant permission
      if (opt === TELNET.OPT_BINARY && !this.binaryRemote) {
        this.sendDo(opt, true);
      }

      this.remoteWill.add(opt);
      this.remoteWont.delete(opt);

    // ----- IAC WONT -----
    } else if (cmdByte === TELNET.WONT && data.length >= 3) {
      const opt = data[2];

      this.remoteWont.add(opt);
      this.remoteWill.delete(opt);

    // ----- IAC EOR -----
    } else if (cmdByte === TELNET.EOR) {
      // Handled in _dataReceived
      // (this case is for when EOR appears without eor mode)

    // ----- IAC SB TN3270E SEND DEVICE-TYPE -----
    } else if (
      data.length === 5 &&
      data[1] === TELNET.SB &&
      data[2] === TELNET.OPT_TN3270E &&
      data[3] === 0x08 && // SEND
      data[4] === TELNET.TN3270E_DEVICE_TYPE // 0x02
    ) {
      // Reply: TN3270E DEVICE-TYPE REQUEST <terminal-type>
      const rsp: number[] = [
        TELNET.OPT_TN3270E,
        TELNET.TN3270E_DEVICE_TYPE,
        TELNET.TN3270E_REQUEST,
      ];
      const ttBytes = Buffer.from(this.terminalType, 'ascii');
      const rspBuf = Buffer.concat([Buffer.from(rsp), ttBytes]);

      if (this.luName) {
        // Add CONNECT <lu_name>
        const luBytes = Buffer.from(this.luName, 'ascii');
        const connectBuf = Buffer.concat([
          rspBuf,
          Buffer.from([0x01]), // CONNECT
          luBytes,
        ]);
        this.sendSub(connectBuf);
      } else {
        this.sendSub(rspBuf);
      }

    // ----- IAC SB TN3270E DEVICE-TYPE IS -----
    } else if (
      data.length >= 5 &&
      data[1] === TELNET.SB &&
      data[2] === TELNET.OPT_TN3270E &&
      data[3] === TELNET.TN3270E_DEVICE_TYPE &&
      data[4] === TELNET.TN3270E_IS
    ) {
      // Request FUNCTIONS: RESPONSES (0x02)
      const funb = Buffer.from([TELNET.TN3270E_RESPONSES]);
      this.sendSub(
        Buffer.from([
          TELNET.OPT_TN3270E,
          TELNET.TN3270E_FUNCTIONS,
          TELNET.TN3270E_REQUEST,
          ...funb,
        ]),
      );

      // Enter TN3270E mode
      this.binaryLocal = true;
      this.binaryRemote = true;
      this._eor = true;
      this._tn3270e = true;

    // ----- IAC SB TN3270E FUNCTIONS IS -----
    } else if (
      data.length >= 5 &&
      data[1] === TELNET.SB &&
      data[2] === TELNET.OPT_TN3270E &&
      data[3] === TELNET.TN3270E_FUNCTIONS &&
      data[4] === TELNET.TN3270E_IS
    ) {
      // Functions confirmed — log only

    // ----- IAC SB TERMINAL-TYPE SEND -----
    } else if (
      data.length === 4 &&
      data[1] === TELNET.SB &&
      data[2] === TELNET.OPT_TERMINAL_TYPE &&
      data[3] === TELNET.TERMINAL_TYPE_SEND
    ) {
      this.sendTerminalType(true);

    // ----- IAC SB START_TLS FOLLOWS -----
    } else if (
      data.length === 4 &&
      data[1] === TELNET.SB &&
      data[2] === TELNET.OPT_START_TLS &&
      data[3] === TELNET.START_TLS_FOLLOWS
    ) {
      // Initiate TLS upgrade (async — fire and forget)
      this._startTls().catch((err: unknown) => {
        const error =
          err instanceof Error ? err : new Error(String(err));
        this.seslost = error;
        this._setEvent();
      });

    // ----- IAC command (NOP through GA, 241-249) -----
    } else if (
      iacByte === TELNET.IAC &&
      cmdByte >= 241 &&
      cmdByte <= 249
    ) {
      // Log only — no action needed

    // ----- Unknown -----
    } else {
      // Unknown telnet sequence — log as warning
    }

    // Flush any buffered responses
    this.send();
  }

  // =========================================================================
  // 3270 data stream processing
  // =========================================================================

  /**
   * Process a complete 3270 data stream record.
   *
   * Handles TN3270E headers (if in TN3270E mode) and dispatches
   * to command-specific processors.
   *
   * Week 2: TN3270E header parsing + dispatch framework.
   * Week 3: actual command processing (Write, Erase/Write, etc.)
   *
   * Reference: Python TNZ tnz.py lines 2103-2152
   */
  _proc3270ds(data: Buffer): void {
    if (data.length === 0) return;

    let responseFlag = 0;
    let seqNumber = 0;

    if (this._tn3270e) {
      if (data.length < 5) {
        throw new TnzError('TN3270E record too short for header');
      }

      const header = data.subarray(0, 5);
      data = data.subarray(5);

      const dataType = header[0];
      // const requestFlag = header[1];
      responseFlag = header[2];
      seqNumber = (header[3] << 8) | header[4];

      if (dataType === 0) {
        // 3270-DATA — continue processing
      } else if (dataType === 1) {
        throw new TnzError('DATA-TYPE SCS-DATA not implemented');
      } else if (dataType === 2) {
        throw new TnzError('DATA-TYPE RESPONSE not implemented');
      } else if (dataType === 3) {
        throw new TnzError('DATA-TYPE BIND-IMAGE not implemented');
      } else if (dataType === 4) {
        throw new TnzError('DATA-TYPE UNBIND not implemented');
      } else if (dataType === 5) {
        throw new TnzError('DATA-TYPE NVT-DATA not implemented');
      } else if (dataType === 6) {
        throw new TnzError('DATA-TYPE REQUEST not implemented');
      } else if (dataType === 7) {
        throw new TnzError('DATA-TYPE SSCP-LU-DATA not implemented');
      } else {
        throw new TnzError(`DATA-TYPE ${dataType} not implemented`);
      }
    }

    if (data.length === 0) return;

    // Dispatch to command processor
    const command = data[0];
    this._processCommand(data, command);

    // Send TN3270E response if requested
    if (responseFlag === 2) {
      const rsp = Buffer.from([
        0x02, // DATA-TYPE=RESPONSE
        0x00, // REQUEST-FLAG=0
        0x00, // success
        (seqNumber >> 8) & 0xff,
        seqNumber & 0xff,
        0x00, // Device End (successful)
      ]);
      this.sendRec(rsp);
    }
  }

  /**
   * Dispatch a 3270 command to the appropriate processor.
   *
   * Reference: Python TNZ tnz.py lines 2391-2519
   */
  private _processCommand(data: Buffer, command: number): void {
    const start = 0;
    const stop = data.length;

    switch (command) {
      case CMD.WRITE: // 0xF1
      case 0x01: // SCS alias
        this._processW(data, start, stop);
        break;
      case CMD.ERASE_WRITE: // 0xF5
      case 0x05: // SCS alias
        this._processEw(data, start, stop);
        break;
      case CMD.ERASE_WRITE_ALTERNATE: // 0x7E
      case 0x0d: // SCS alias
        this._processEwa(data, start, stop);
        break;
      case CMD.READ_BUFFER: // 0xF2
      case 0x02: // SCS alias
        if (stop - start !== 1) {
          throw new TnzError(`RB must be 1 byte, got ${stop - start}`);
        }
        this.readState = ReadState.NORMAL;
        this._readBuffer();
        break;
      case CMD.READ_MODIFIED: // 0xF6
      case 0x06: // SCS alias
        if (stop - start !== 1) {
          throw new TnzError(`RM must be 1 byte, got ${stop - start}`);
        }
        this.sendAid(this.aid);
        break;
      case CMD.READ_MODIFIED_ALL: // 0x6E
        if (stop - start !== 1) {
          throw new TnzError(`RMA must be 1 byte, got ${stop - start}`);
        }
        this.readState = ReadState.NORMAL;
        this.sendAid(this.aid, false);
        break;
      case CMD.ERASE_ALL_UNPROTECTED: // 0x6F
      case 0x0f: // SCS alias
        if (stop - start !== 1) {
          throw new TnzError(`EAU must be 1 byte, got ${stop - start}`);
        }
        this._processEau();
        break;
      case CMD.WRITE_STRUCTURED_FIELD: // 0xF3
      case 0x11: // SCS alias
        this._processWsf(data, start, stop);
        break;
      default:
        throw new TnzError(
          `Unknown 3270 command: 0x${command.toString(16)}`,
        );
    }

    if (this.onScreenUpdate) {
      this.onScreenUpdate();
    }
  }

  // =========================================================================
  // Buffer helpers (Delegated)
  // =========================================================================

  static ucba(buf: Uint8Array, addr: number, bytes: Uint8Array | number[], start = 0, end?: number): void { bufUtil.ucba(buf, addr, bytes, start, end); }
  static rcba(buf: Uint8Array, saddr: number, eaddr: number): Uint8Array { return bufUtil.rcba(buf, saddr, eaddr); }
  
  addressBytes(addr: number): Buffer { return bufUtil.addressBytes(this, addr); }

  /** @internal */ _checkAddress(address: number): void { bufUtil._checkAddress(this, address); }
  /** @internal */ _erase(saddr: number, eaddr: number): void { bufUtil._erase(this, saddr, eaddr); }
  /** @internal */ _eraseInput(saddr: number, eaddr: number): void { bufUtil._eraseInput(this, saddr, eaddr); }
  /** @internal */ _field(address: number): [number, number] { return bufUtil._field(this, address); }
  nextField(address: number): [number, number] { return bufUtil.nextField(this, address); }
  _charAddrs(saddr: number, eaddr: number): Generator<number> { return bufUtil._charAddrs(this, saddr, eaddr); }
  fields(saddr?: number, eaddr?: number): Generator<[number, number]> { return bufUtil.fields(this, saddr, eaddr); }
  /** @internal */ _tab(saddr: number, _eaddr = 0): number { return bufUtil._tab(this, saddr, _eaddr); }

  /** @internal */ addressDecode(data: Buffer, start: number): number {
    return bufUtil.addressDecode(data, start);
  }

  /** @internal */ _processSa(cat: number, cav: number, addr?: number): void {
    if (cat === 0x00) {
      // Reset all character attributes
      if (addr !== undefined) {
        this.planeEh[addr] = 0;
        this.planeCs[addr] = 0;
        this.planeFg[addr] = 0;
        this.planeBg[addr] = 0;
      } else {
        this._procEh = 0;
        this._procCs = 0;
        this._procFg = 0;
        this._procBg = 0;
      }
    } else if (cat === 0x41) {
      if (addr !== undefined) this.planeEh[addr] = cav;
      else this._procEh = cav;
    } else if (cat === 0x42) {
      if (!this._extendedColorMode) this._extendedColorMode = true;
      if (addr !== undefined) this.planeFg[addr] = cav;
      else this._procFg = cav;
    } else if (cat === 0x43) {
      if (addr !== undefined) this.planeCs[addr] = cav;
      else this._procCs = cav;
    } else if (cat === 0x45) {
      if (!this._extendedColorMode) this._extendedColorMode = true;
      if (addr !== undefined) this.planeBg[addr] = cav;
      else this._procBg = cav;
    } else {
      throw new TnzError(`Bad character attribute type: 0x${cat.toString(16)}`);
    }
  }

  // =========================================================================
  // State reset helpers
  // =========================================================================

  /**
   * Reset buffer planes and optionally resize to alternate screen.
   *
   * Reference: Python TNZ tnz.py lines 3829-3861
   */
  eraseReset(useAlternate = false): void {
    this._extendedColorMode = false;

    if (useAlternate) {
      this.maxRow = this.amaxRow;
      this.maxCol = this.amaxCol;
    } else {
      this.maxRow = this.dmaxRow;
      this.maxCol = this.dmaxCol;
    }

    const bufSize = this.maxRow * this.maxCol;
    this.bufferSize = bufSize;
    this.planeDc = new Uint8Array(bufSize);
    this.planeFa = new Uint8Array(bufSize);
    this.planeEh = new Uint8Array(bufSize);
    this.planeCs = new Uint8Array(bufSize);
    this.planeFg = new Uint8Array(bufSize);
    this.planeBg = new Uint8Array(bufSize);
    this.addr16bit = bufSize >= 16384;
    this.curadd = 0;
  }

  /**
   * Reset the MDT (Modified Data Tag) for all fields.
   *
   * Reference: Python TNZ tnz.py lines 3624-3632
   */
  /** @internal */ _resetMdt(): void {
    const planeFa = this.planeFa;
    for (let i = 0; i < this.bufferSize; i++) {
      const fattr = planeFa[i];
      if (fattr) {
        const nattr = bit6(fattr & 0xfe); // turn off MDT (bit 0)
        if (fattr !== nattr) {
          planeFa[i] = nattr;
        }
      }
    }
  }

  /**
   * Reset partition state.
   *
   * Reference: Python TNZ tnz.py lines 3634-3638
   */
  /** @internal */ _resetPartition(): void {
    this._replyMode = 0; // Field mode
    this._replyCattrs = Buffer.alloc(0);
  }

  /**
   * Restore keyboard after host processing.
   *
   * Reference: Python TNZ tnz.py lines 3640-3653
   */
  /** @internal */ _restoreKeyboard(): void {
    this.aid = AID.NONE;
    this.readState = ReadState.NORMAL;
    this.systemLockWait = false;
    this.inop = 0x06; // RM
    this.pwait = false;
  }

  /**
   * Set field attributes from SFE/MF attribute pairs.
   *
   * @returns new index past the consumed attribute bytes
   *
   * Reference: Python TNZ tnz.py lines 4474-4518
   */
  /** @internal */ _setAttributes(
    addr: number,
    data: Buffer,
    idx: number,
  ): number {
    const count = data[idx];
    let pos = idx + 1;

    for (let i = 0; i < count; i++) {
      const attrType = data[pos];
      const attrValue = data[pos + 1];
      pos += 2;

      if (attrType === 0xc0) {
        // 3270 field attribute
        this.planeFa[addr] = bit6(attrValue);
      } else if (attrType === 0x41) {
        // Extended highlighting
        this.planeEh[addr] = attrValue;
      } else if (attrType === 0x42) {
        // Foreground color
        if (!this._extendedColorMode) {
          this._extendedColorMode = true;
        }
        this.planeFg[addr] = attrValue;
      } else if (attrType === 0x43) {
        // Character set
        this.planeCs[addr] = attrValue;
      } else if (attrType === 0x45) {
        // Background color
        if (!this._extendedColorMode) {
          this._extendedColorMode = true;
        }
        this.planeBg[addr] = attrValue;
      } else {
        throw new TnzError(`Bad field attribute type: ${attrType}`);
      }
    }

    return pos;
  }

  // =========================================================================
  // WCC processing
  // =========================================================================

  /**
   * Process a WCC (Write Control Character).
   *
   * When forMdt=true, only the MDT reset bit is checked (called before
   * orders processing). When forMdt=false, the full WCC is processed
   * (called after orders processing).
   *
   * Reference: Python TNZ tnz.py lines 3442-3463
   */
  /** @internal */ _processWcc(wcc: number, forMdt = false): void {
    if (forMdt) {
      if (wcc & 0x01) {
        // Bit 7: reset modified data tags
        this._resetMdt();
      }
    } else {
      if (wcc & 0x40) {
        // Bit 1: reset partition
        this._resetPartition();
      }
      // Bit 4 (0x08): start printer — not implemented
      // Bit 5 (0x04): sound alarm — not implemented in headless
      if (wcc & 0x02) {
        // Bit 6: keyboard restore
        this._restoreKeyboard();
      }
    }
  }

  // =========================================================================
  // Order processing
  // =========================================================================

  /** Order byte values that trigger order processing */
  private static readonly ORDER_BYTES = new Set<number>([
    ORDER.PT,  // 0x05
    ORDER.GE,  // 0x08
    ORDER.SBA, // 0x11
    ORDER.EUA, // 0x12
    ORDER.IC,  // 0x13
    ORDER.SF,  // 0x1D
    ORDER.SA,  // 0x28
    ORDER.SFE, // 0x29
    ORDER.MF,  // 0x2C
    ORDER.RA,  // 0x3C
  ]);

  /**
   * Find the next order byte in the data stream.
   * Returns -1 if no order found.
   */
  private static _findOrder(
    data: Buffer,
    start: number,
    end: number,
  ): number {
    for (let i = start; i < end; i++) {
      if (Tnz.ORDER_BYTES.has(data[i])) return i;
    }
    return -1;
  }

  /**
   * Process orders and data in a 3270 write data stream.
   *
   * Reference: Python TNZ tnz.py lines 3399-3422
   */
  private _processOrdersData(
    data: Buffer,
    start: number,
    end: number,
  ): void {
    this.bufadd = this.curadd;
    this._procEh = 0;
    this._procCs = 0;
    this._procFg = 0;
    this._procBg = 0;
    let ptErase = false;

    while (start < end) {
      const ordIdx = Tnz._findOrder(data, start, end);

      if (ordIdx < 0) {
        // No more orders — rest is character data
        this._processCharData(data, start, end);
        return;
      }

      if (start < ordIdx) {
        // Character data before the order
        this._processCharData(data, start, ordIdx);
        ptErase = true;
      }

      const result = this._processOrder(data, ordIdx, end, ptErase);
      start = result.nextIdx;
      ptErase = result.ptErase;
    }
  }

  /**
   * Dispatch a single order.
   *
   * Reference: Python TNZ tnz.py lines 3082-3097
   */
  private _processOrder(
    data: Buffer,
    start: number,
    stop: number,
    ptErase: boolean,
  ): { nextIdx: number; ptErase: boolean } {
    const orderByte = data[start];
    const bufSize = this.bufferSize;

    switch (orderByte) {
      // ----- PT (Program Tab) 0x05 -----
      case ORDER.PT: {
        const oldadd = this.bufadd;
        if (!this.planeFa[oldadd] && ptErase) {
          const [addr0] = this.nextField(oldadd);
          if (addr0 > 0) {
            ptErase = false;
          }
          const eraseEnd = addr0 >= 0 ? addr0 : 0;
          this._erase(oldadd, eraseEnd);
        }
        this.bufadd = this._tab(oldadd, 0);
        return { nextIdx: start + 1, ptErase };
      }

      // ----- GE (Graphic Escape) 0x08 -----
      case ORDER.GE: {
        if (stop - start < 2) {
          throw new TnzError(`GE requires 2 bytes, got ${stop - start}`);
        }
        ptErase = false;
        const geByte = data[start + 1];
        const addr1 = this.bufadd;
        this.planeDc[addr1] = geByte;
        this.planeFa[addr1] = 0;
        this.planeEh[addr1] = this._procEh;
        this.planeCs[addr1] = 0xf1;
        this.planeFg[addr1] = this._procFg;
        this.planeBg[addr1] = this._procBg;
        this.bufadd = (addr1 + 1) % bufSize;
        return { nextIdx: start + 2, ptErase };
      }

      // ----- SBA (Set Buffer Address) 0x11 -----
      case ORDER.SBA: {
        if (stop - start < 3) {
          throw new TnzError(`SBA requires 3 bytes, got ${stop - start}`);
        }
        ptErase = false;
        const newAddr = this.address(data.subarray(start + 1, start + 3));
        this._checkAddress(newAddr);
        this.bufadd = newAddr;
        return { nextIdx: start + 3, ptErase };
      }

      // ----- EUA (Erase Unprotected to Address) 0x12 -----
      case ORDER.EUA: {
        if (stop - start < 3) {
          throw new TnzError(
            `EUA requires 3 bytes, got ${stop - start}`,
          );
        }
        ptErase = false;
        const euaAddr = this.address(data.subarray(start + 1, start + 3));
        this._checkAddress(euaAddr);
        this._eraseInput(this.bufadd, euaAddr);
        this.bufadd = euaAddr;
        return { nextIdx: start + 3, ptErase };
      }

      // ----- IC (Insert Cursor) 0x13 -----
      case ORDER.IC: {
        ptErase = false;
        this.curadd = this.bufadd;
        return { nextIdx: start + 1, ptErase };
      }

      // ----- SF (Start Field) 0x1D -----
      case ORDER.SF: {
        if (stop - start < 2) {
          throw new TnzError(`SF requires 2 bytes, got ${stop - start}`);
        }
        ptErase = false;
        const fattr = data[start + 1];
        const sfAddr = this.bufadd;
        this.planeDc[sfAddr] = 0;
        this.planeFa[sfAddr] = bit6(fattr);
        this.planeEh[sfAddr] = 0;
        this.planeCs[sfAddr] = 0;
        this.planeFg[sfAddr] = 0;
        this.planeBg[sfAddr] = 0;
        this.bufadd = (sfAddr + 1) % bufSize;
        return { nextIdx: start + 2, ptErase };
      }

      // ----- SA (Set Attribute) 0x28 -----
      case ORDER.SA: {
        if (stop - start < 3) {
          throw new TnzError(`SA requires 3 bytes, got ${stop - start}`);
        }
        ptErase = false;
        this._processSa(data[start + 1], data[start + 2]);
        return { nextIdx: start + 3, ptErase };
      }

      // ----- SFE (Start Field Extended) 0x29 -----
      case ORDER.SFE: {
        ptErase = false;
        const sfeAddr = this.bufadd;
        this.planeDc[sfeAddr] = 0;
        this.planeFa[sfeAddr] = bit6(0); // default = 0x40
        this.planeEh[sfeAddr] = 0;
        this.planeCs[sfeAddr] = 0;
        this.planeFg[sfeAddr] = 0;
        this.planeBg[sfeAddr] = 0;

        const sfeEnd = this._setAttributes(sfeAddr, data, start + 1);
        this.bufadd = (sfeAddr + 1) % bufSize;
        return { nextIdx: sfeEnd, ptErase };
      }

      // ----- MF (Modify Field) 0x2C -----
      case ORDER.MF: {
        ptErase = false;
        const mfAddr = this.bufadd;
        if (!this.planeFa[mfAddr]) {
          throw new TnzTerminalError(`Not a field: ${mfAddr}`);
        }
        const mfEnd = this._setAttributes(mfAddr, data, start + 1);
        this.bufadd = (mfAddr + 1) % bufSize;
        return { nextIdx: mfEnd, ptErase };
      }

      // ----- RA (Repeat to Address) 0x3C -----
      case ORDER.RA: {
        if (stop - start < 4) {
          throw new TnzError(`RA requires 4 bytes, got ${stop - start}`);
        }
        ptErase = false;
        const stopAddr = this.address(data.subarray(start + 1, start + 3));
        let csAttr = this._procCs;
        let returnIdx = start + 4;
        let dataByte = data[start + 3];

        if (dataByte === ORDER.GE) {
          // GE inside RA
          csAttr = 0xf1;
          dataByte = data[returnIdx];
          returnIdx++;
        }

        this._checkAddress(stopAddr);

        const raStart = this.bufadd;
        let rlen: number;
        if (raStart < stopAddr) {
          rlen = stopAddr - raStart;
        } else if (stopAddr < raStart) {
          rlen = stopAddr + bufSize - raStart;
        } else {
          rlen = bufSize;
        }

        const fillDc = new Uint8Array(rlen).fill(dataByte);
        const fillZero = new Uint8Array(rlen);
        const fillEh = new Uint8Array(rlen).fill(this._procEh);
        const fillCs = new Uint8Array(rlen).fill(csAttr);
        const fillFg = new Uint8Array(rlen).fill(this._procFg);
        const fillBg = new Uint8Array(rlen).fill(this._procBg);

        const ucba = Tnz.ucba;
        ucba(this.planeDc, raStart, fillDc);
        ucba(this.planeFa, raStart, fillZero);
        ucba(this.planeEh, raStart, fillEh);
        ucba(this.planeCs, raStart, fillCs);
        ucba(this.planeFg, raStart, fillFg);
        ucba(this.planeBg, raStart, fillBg);

        this.bufadd = stopAddr;
        return { nextIdx: returnIdx, ptErase };
      }

      default:
        throw new TnzError(`Unknown order: 0x${orderByte.toString(16)}`);
    }
  }

  /**
   * Process host character data — write EBCDIC bytes into buffer planes.
   *
   * Reference: Python TNZ tnz.py lines 2521-2580
   */
  private _processCharData(
    data: Buffer,
    begIdx: number,
    endIdx: number,
  ): void {
    const dataLen = endIdx - begIdx;
    if (dataLen <= 0) return;

    const saddr = this.bufadd;
    const ucba = Tnz.ucba;

    ucba(this.planeDc, saddr, data, begIdx, endIdx);
    ucba(this.planeFa, saddr, new Uint8Array(dataLen));
    ucba(this.planeEh, saddr, new Uint8Array(dataLen).fill(this._procEh));
    ucba(this.planeCs, saddr, new Uint8Array(dataLen).fill(this._procCs));
    ucba(this.planeFg, saddr, new Uint8Array(dataLen).fill(this._procFg));
    ucba(this.planeBg, saddr, new Uint8Array(dataLen).fill(this._procBg));

    this.bufadd = (this.bufadd + dataLen) % this.bufferSize;
  }

  // =========================================================================
  // Write command implementations
  // =========================================================================

  /**
   * Process W (Write) command.
   *
   * Reference: Python TNZ tnz.py lines 3424-3441
   */
  private _processW(
    data: Buffer,
    start: number,
    stop: number,
  ): void {
    if (stop - start <= 1) return; // no WCC

    this._processWcc(data[start + 1], true); // MDT reset pass
    this._processOrdersData(data, start + 2, stop);
    this._processWcc(data[start + 1]); // full WCC pass
    this.updated = true;
  }

  /**
   * Process EW (Erase/Write) command.
   *
   * Reference: Python TNZ tnz.py lines 3049-3063
   */
  private _processEw(
    data: Buffer,
    start: number,
    stop: number,
  ): void {
    if (stop - start <= 1) return; // no WCC

    this.lastcmd = '';
    this.eraseReset(false);
    this._processOrdersData(data, start + 2, stop);
    this._processWcc(data[start + 1]);
    this.updated = true;
  }

  /**
   * Process EWA (Erase/Write Alternate) command.
   *
   * Reference: Python TNZ tnz.py lines 3065-3080
   */
  private _processEwa(
    data: Buffer,
    start: number,
    stop: number,
  ): void {
    if (stop - start <= 1) return; // no WCC

    this.lastcmd = '';
    this.eraseReset(true);
    this._processOrdersData(data, start + 2, stop);
    this._processWcc(data[start + 1]);
    this.updated = true;
  }

  /**
   * Process EAU (Erase All Unprotected) command.
   *
   * Reference: Python TNZ tnz.py lines 3037-3047
   */
  private _processEau(): void {
    this._eraseInput(0, 0);
    this._resetMdt();
    this.keyHome();
    this._restoreKeyboard();
  }

  // =========================================================================
  // Read command implementations
  // =========================================================================

  /**
   * Send AID response to the host.
   *
   * If `short` is true, only the AID byte is sent (short read).
   * Otherwise, AID + cursor address + modified field data.
   *
   * Reference: Python TNZ tnz.py send_aid()
   */
  sendAid(aid: number, short?: boolean): void {
    if (short === undefined) {
      // PAx or CLEAR are short reads by default
      short = aid >= 0x6b && aid <= 0x6f;
    }

    if (short) {
      // Short read: just AID (no cursor address for PAx/CLEAR according to protocol,
      // but my previous code added baddr for some reason. Wait, python `rec = bytes([aid])` and if short, sends just `rec`.
      // Let's check python code:
      // rec = bytes([aid]) ... if short: self.send_3270_data(rec) return
      this.send3270Data(Buffer.from([aid]));
      return;
    }

    // Full read: AID + cursor + modified fields
    const baddr = this.addressBytes(this.curadd);
    const parts: Buffer[] = [Buffer.from([aid, baddr[0], baddr[1]])];

    // Scan for modified fields
    for (const [faddr, fattr] of this.fields()) {
      if (!(fattr & 0x01)) continue; // not modified

      // Find the start of field data (position after FA)
      const dataStart = (faddr + 1) % this.bufferSize;

      // Find end of field (next FA or wrap)
      const [nextFaddr] = this.nextField(dataStart);
      const dataEnd = nextFaddr >= 0 ? nextFaddr : dataStart;

      // SBA + address
      const fieldAddrBytes = this.addressBytes(dataStart);
      parts.push(
        Buffer.from([
          ORDER.SBA,
          fieldAddrBytes[0],
          fieldAddrBytes[1],
        ]),
      );

      // Field data characters (with GE for charset F1)
      this._appendCharBytes(parts, dataStart, dataEnd);
    }

    this.send3270Data(Buffer.concat(parts));
  }

  /**
   * Process RB (Read Buffer) — send entire buffer contents.
   *
   * Linear scan through the buffer. Each position is either a field
   * attribute (emitted as SF/SFE) or character data.
   *
   * Reference: Python TNZ tnz.py lines 4331-4434
   */
  /** @internal */ _readBuffer(): void {
    const baddr = this.addressBytes(this.curadd);
    const parts: Buffer[] = [Buffer.from([this.aid, baddr[0], baddr[1]])];

    const replyMode = this._replyMode;
    const replyCattrs = this._replyCattrs;
    let ehAttr = 0;
    let fgAttr = 0;
    let bgAttr = 0;

    for (let addr = 0; addr < this.bufferSize; addr++) {
      const fattr = this.planeFa[addr];

      if (fattr) {
        // Field attribute position — emit SF or SFE
        if (replyMode) {
          const sfe: number[] = [ORDER.SFE, 0];

          const eh = this.planeEh[addr];
          if (eh) { sfe[1]++; sfe.push(0x41, eh); }

          const fg = this.planeFg[addr];
          if (fg) { sfe[1]++; sfe.push(0x42, fg); }

          const cs = this.planeCs[addr];
          if (cs) { sfe[1]++; sfe.push(0x43, cs); }

          const bg = this.planeBg[addr];
          if (bg) { sfe[1]++; sfe.push(0x45, bg); }

          if (sfe[1] > 0) {
            sfe[1]++;
            sfe.push(0xc0, fattr);
            parts.push(Buffer.from(sfe));
          } else {
            parts.push(Buffer.from([ORDER.SF, fattr]));
          }
        } else {
          parts.push(Buffer.from([ORDER.SF, fattr]));
        }

        // Reset character-mode tracking after a field boundary
        ehAttr = 0;
        fgAttr = 0;
        bgAttr = 0;
      } else {
        // Character data position
        if (replyMode === 2) {
          // Character mode — emit SA orders for attribute changes
          if (replyCattrs.includes(0x41)) {
            const eh1 = this.planeEh[addr];
            if (eh1 !== ehAttr) {
              parts.push(Buffer.from([ORDER.SA, 0x41, eh1]));
              ehAttr = eh1;
            }
          }
          if (replyCattrs.includes(0x42)) {
            const fg1 = this.planeFg[addr];
            if (fg1 !== fgAttr) {
              parts.push(Buffer.from([ORDER.SA, 0x42, fg1]));
              fgAttr = fg1;
            }
          }
          if (replyCattrs.includes(0x45)) {
            const bg1 = this.planeBg[addr];
            if (bg1 !== bgAttr) {
              parts.push(Buffer.from([ORDER.SA, 0x45, bg1]));
              bgAttr = bg1;
            }
          }
        }

        // Emit character (with GE prefix if charset 0xF1)
        if (this.planeCs[addr] === 0xf1) {
          parts.push(Buffer.from([ORDER.GE, this.planeDc[addr]]));
        } else {
          parts.push(Buffer.from([this.planeDc[addr]]));
        }
      }
    }

    this.send3270Data(Buffer.concat(parts));
  }

  /**
   * Append character data bytes to a parts list, inserting GE for
   * characters from character set 0xF1.
   *
   * Uses linear indexing; both saddr and eaddr must be in [0, bufferSize].
   * When saddr < eaddr, emits characters in that range.
   * When saddr === eaddr, emits nothing.
   *
   * Reference: Python TNZ tnz.py lines 3693-3715
   */
  /** @internal */ _appendCharBytes(
    parts: Buffer[],
    saddr: number,
    eaddr: number,
  ): void {
    if (saddr >= eaddr) return;

    for (let pos = saddr; pos < eaddr; pos++) {
      if (this.planeCs[pos] === 0xf1) {
        parts.push(Buffer.from([ORDER.GE, this.planeDc[pos]]));
      } else {
        parts.push(Buffer.from([this.planeDc[pos]]));
      }
    }
  }

  // =========================================================================
  // Write Structured Field (WSF)
  // =========================================================================

  /**
   * Process WSF (Write Structured Field) command.
   *
   * Parses the structured field chain and dispatches each SF.
   *
   * Reference: Python TNZ tnz.py lines 2423-2452
   */
  private _processWsf(data: Buffer, start: number, stop: number): void {
    if (stop - start < 4) {
      throw new TnzError(`WSF needs 4 bytes, got ${stop - start}`);
    }

    let i = start + 1;
    while (i < stop) {
      let sfLen = (data[i] << 8) | data[i + 1];
      if (sfLen === 0) sfLen = stop - i;

      if (sfLen < 3) {
        throw new TnzError(`Bad structured field length: ${sfLen}`);
      }

      if (i + sfLen > stop) {
        throw new TnzError('WSF len and data inconsistent');
      }

      const sfId = data[i + 2];
      this._processWsfById(sfId, data, i, i + sfLen);
      i += sfLen;
    }
  }

  /**
   * Dispatch a single structured field by its ID.
   *
   * Reference: Python TNZ tnz.py _process_wsf_*
   */
  private _processWsfById(
    sfId: number,
    data: Buffer,
    start: number,
    stop: number,
  ): void {
    switch (sfId) {
      case SF_ID.READ_PARTITION: // 0x01
        this._wsfReadPartition(data, start, stop);
        break;
      case 0x03: // Erase/Reset
        this._wsfEraseReset(data, start, stop);
        break;
      case 0x09: // Set Reply Mode
        this._wsfSetReplyMode(data, start, stop);
        break;
      case 0x40: // Outbound 3270DS
        this._wsfOutbound3270ds(data, start, stop);
        break;
      case SF_ID.DDM: // 0xD0
        this.emit('ddm', data.subarray(start, stop));
        break;
      default:
        throw new TnzError(`Bad Structured Field ID: ${sfId}`);
    }
  }

  /**
   * Process Read Partition structured field.
   *
   * Reference: Python TNZ tnz.py lines 3465-3511
   */
  private _wsfReadPartition(
    data: Buffer,
    start: number,
    _stop: number,
  ): void {
    const pid = data[start + 3];
    const rpType = data[start + 4];

    if ((rpType === 0x02 || rpType === 0x03) && pid !== 0xff) {
      throw new TnzTerminalError(`pid=${pid}, type=${rpType}`);
    }

    this.readState = ReadState.RREAD;

    if (rpType === 0x02) {
      // Query
      this.inop = rpType;
      this._queryReply();
    } else if (rpType === 0x03) {
      // Query List
      this.inop = rpType;
      this._queryReply();
    } else if (rpType === 0x6e) {
      // Read Modified All (RMA)
      this.inpid = pid;
      this.inop = rpType;
      this.sendAid(AID.READ_PARTITION, false);
    } else if (rpType === 0xf2) {
      // Read Buffer (RB)
      this.inpid = pid;
      this.inop = rpType;
      this.aid = AID.READ_PARTITION;
      this._readBuffer();
    } else if (rpType === 0xf6) {
      // Read Modified (RM)
      this.inpid = pid;
      this.inop = rpType;
      this.sendAid(AID.READ_PARTITION);
    } else {
      throw new TnzTerminalError(
        `Unknown Read Partition type: 0x${rpType.toString(16)}`,
      );
    }
  }

  /**
   * Process Erase/Reset structured field.
   *
   * Reference: Python TNZ tnz.py lines 3513-3528
   */
  private _wsfEraseReset(
    data: Buffer,
    start: number,
    stop: number,
  ): void {
    this._extendedColorMode = false;
    if (stop - start < 4) {
      throw new TnzError(
        `Erase/Reset needs 4 bytes, got ${stop - start}`,
      );
    }
    this.eraseReset(Boolean(data[start + 3] & 0x80));
    this.updated = true;
  }

  /**
   * Process Set Reply Mode structured field.
   *
   * Reference: Python TNZ tnz.py lines 3530-3550
   */
  private _wsfSetReplyMode(
    data: Buffer,
    start: number,
    stop: number,
  ): void {
    const pid = data[start + 3];
    if (pid) {
      throw new TnzError('Non-zero PID not implemented');
    }

    const mode = data[start + 4];
    if (mode <= 1) {
      // Field or Extended Field mode
      this._replyCattrs = Buffer.alloc(0);
    } else if (mode === 2) {
      // Character mode
      this._replyCattrs = Buffer.from(data.subarray(start + 5, stop));
    } else {
      throw new TnzError(`Bad reply mode: ${mode}`);
    }
    this._replyMode = mode;
  }

  /**
   * Process Outbound 3270DS structured field.
   *
   * Dispatches embedded 3270 commands (Write, EW, EWA, EAU).
   *
   * Reference: Python TNZ tnz.py lines 3552-3564
   */
  private _wsfOutbound3270ds(
    data: Buffer,
    start: number,
    stop: number,
  ): void {
    const pid = data[start + 3];
    const cmdByte = data[start + 4];

    switch (cmdByte) {
      case CMD.WRITE: // 0xF1
        this._processW(data, start + 4, stop);
        break;
      case CMD.ERASE_WRITE: // 0xF5
        if (pid) throw new TnzError('Non-zero PID not implemented');
        this._processEw(data, start + 4, stop);
        break;
      case CMD.ERASE_WRITE_ALTERNATE: // 0x7E
        if (pid) throw new TnzError('Non-zero PID not implemented');
        this._processEwa(data, start + 4, stop);
        break;
      case CMD.ERASE_ALL_UNPROTECTED: // 0x6F
        if (stop - start !== 5) {
          throw new TnzError(`EAU must be 5 bytes, got ${stop - start}`);
        }
        this._processEau();
        break;
      default:
        throw new TnzError(
          `Unknown Outbound 3270DS command: 0x${cmdByte.toString(16)}`,
        );
    }
  }

// =========================================================================
  // Query Reply
  // =========================================================================

  /**
   * Build and send the Query Reply data stream.
   *
   * Responds to Read Partition Query / Query List with terminal
   * capabilities: Usable Area, Character Sets, Color, Highlight,
   * Reply Modes, DDM, Implicit Partitions.
   *
   * Reference: Python TNZ tnz.py lines 4092-4245
   */
  private _queryReply(): void {
    const parts: Buffer[] = [];

    // AID = Structured Field
    parts.push(Buffer.from([AID.STRUCTURED_FIELD]));

    // ---- Summary Query Reply (0x80) ----
    const summaryQcodes: number[] = [
      0x80, // Summary
      QR_TYPE.USABLE_AREA,       // 0x81
      QR_TYPE.CHARACTER_SETS,    // 0x85
    ];
    if (this.capableColor) {
      summaryQcodes.push(QR_TYPE.COLOR); // 0x86
    }
    summaryQcodes.push(
      QR_TYPE.HIGHLIGHT,          // 0x87
      QR_TYPE.REPLY_MODES,        // 0x88
      QR_TYPE.DDM,                // 0x95
      QR_TYPE.IMPLICIT_PARTITION, // 0xA6
    );

    const summaryBody = Buffer.from([
      QR_TYPE.USABLE_AREA, // 0x81 = Query Reply ID
      ...summaryQcodes,
    ]);
    this._addQueryReplyField(parts, summaryBody);

    // ---- Usable Area Query Reply (0x81) ----
    const usableArea = Buffer.alloc(14);
    usableArea[0] = QR_TYPE.USABLE_AREA; // 0x81
    usableArea[1] = 0x01; // Flags: 12/14-bit addressing
    usableArea[2] = 0x00; // Flags
    usableArea.writeUInt16BE(this.amaxCol, 3); // Width
    usableArea.writeUInt16BE(this.amaxRow, 5); // Height
    usableArea[7] = 0x00; // Units: inches
    usableArea.writeUInt16BE(1, 8);   // Xr numerator
    usableArea.writeUInt16BE(96, 10); // Xr denominator
    usableArea.writeUInt16BE(1, 12);  // Yr numerator
    // Need 2 more bytes for Yr denominator + AW + AH
    const usableAreaFull = Buffer.alloc(19);
    usableArea.copy(usableAreaFull);
    usableAreaFull.writeUInt16BE(96, 14); // Yr denominator
    usableAreaFull[16] = 0x06; // AW (X units in default cell)
    usableAreaFull[17] = 0x0c; // AH (Y units in default cell)
    usableAreaFull[18] = 0x00; // padding
    this._addQueryReplyField(
      parts,
      usableAreaFull.subarray(0, 18),
    );

    // ---- Implicit Partition Query Reply (0xA6) ----
    const implPart = Buffer.alloc(15);
    implPart[0] = QR_TYPE.IMPLICIT_PARTITION; // 0xA6
    implPart[1] = 0x00; // Flags
    implPart[2] = 0x00; // Flags
    implPart[3] = 0x0b; // Length of self-defining parameter
    implPart[4] = 0x01; // Implicit Partition Sizes
    implPart[5] = 0x00; // Flags
    implPart.writeUInt16BE(this.dmaxCol, 6);  // WD
    implPart.writeUInt16BE(this.dmaxRow, 8);  // HD
    implPart.writeUInt16BE(this.amaxCol, 10); // WA
    implPart.writeUInt16BE(this.amaxRow, 12); // HA
    this._addQueryReplyField(parts, implPart.subarray(0, 14));

    // ---- Character Sets Query Reply (0x85) ----
    const csFlags1 = this.alt ? 0x82 : 0x02;
    const csHeader = Buffer.from([
      QR_TYPE.CHARACTER_SETS, // 0x85
      csFlags1, // Flags (1)
      0x00,     // Flags (2)
      0x06,     // SDW
      0x0c,     // SDH
      0x00, 0x00, 0x00, 0x00, // FORM
      0x07,     // DL (descriptor length)
    ]);

    // Descriptor 1 (primary)
    const csDesc1 = Buffer.alloc(7);
    csDesc1[0] = 0x00; // SET
    csDesc1[1] = 0x00; // Flags
    csDesc1[2] = 0x00; // LCID
    csDesc1.writeUInt16BE(this.cs00, 3);
    csDesc1.writeUInt16BE(this.cp00, 5);

    let csBuf: Buffer;
    if (this.alt) {
      // Descriptor 2 (GE/APL)
      const csDesc2 = Buffer.alloc(7);
      csDesc2[0] = 0x01; // SET
      csDesc2[1] = 0x00; // Flags
      csDesc2[2] = 0xf1; // LCID
      csDesc2.writeUInt16BE(this.csF1, 3);
      csDesc2.writeUInt16BE(this.cpF1, 5);
      csBuf = Buffer.concat([csHeader, csDesc1, csDesc2]);
    } else {
      csBuf = Buffer.concat([csHeader, csDesc1]);
    }
    this._addQueryReplyField(parts, csBuf);

    // ---- Highlight Query Reply (0x87) ----
    const hlBuf = Buffer.from([
      QR_TYPE.HIGHLIGHT, // 0x87
      0x05, // 5 pairs
      0x00, 0xf0, // default -> normal
      0xf1, 0xf1, // blink -> blink
      0xf2, 0xf2, // reverse -> reverse
      0xf4, 0xf4, // underscore -> underscore
      0xf8, 0xf8, // intensify -> intensify
    ]);
    this._addQueryReplyField(parts, hlBuf);

    // ---- Reply Modes Query Reply (0x88) ----
    const rmBuf = Buffer.from([
      QR_TYPE.REPLY_MODES, // 0x88
      0x00, // Field mode
      0x01, // Extended Field mode
      0x02, // Character mode
    ]);
    this._addQueryReplyField(parts, rmBuf);

    // ---- DDM Query Reply (0x95) ----
    const ddmBuf = Buffer.alloc(10);
    ddmBuf[0] = QR_TYPE.DDM; // 0x95
    ddmBuf[1] = 0x00; // Flags
    ddmBuf[2] = 0x00; // Flags
    ddmBuf.writeUInt16BE(this._limin, 3);
    ddmBuf.writeUInt16BE(this._limout, 5);
    ddmBuf[7] = 0x01; // NSS
    ddmBuf[8] = 0x01; // DDMSS
    this._addQueryReplyField(parts, ddmBuf.subarray(0, 9));

    // ---- Color Query Reply (0x86) ----
    if (this.capableColor) {
      const colorBuf = Buffer.from([
        QR_TYPE.COLOR, // 0x86
        0x00, // Flags
        0x08, // NP (8 pairs)
        0x00, 0xf4, // Default -> Green
        0xf1, 0xf1, // Blue -> Blue
        0xf2, 0xf2, // Red -> Red
        0xf3, 0xf3, // Pink -> Pink
        0xf4, 0xf4, // Green -> Green
        0xf5, 0xf5, // Turquoise -> Turquoise
        0xf6, 0xf6, // Yellow -> Yellow
        0xf7, 0xf7, // White -> White
      ]);
      this._addQueryReplyField(parts, colorBuf);
    }

    this.send3270Data(Buffer.concat(parts));
  }

  /**
   * Helper: wrap a Query Reply body with length prefix + 0x81 marker.
   */
  private _addQueryReplyField(
    parts: Buffer[],
    body: Buffer,
  ): void {
    const len = body.length + 3; // 2 for length + 1 for 0x81 marker
    const header = Buffer.alloc(3);
    header.writeUInt16BE(len, 0);
    header[2] = 0x81; // Query Reply ID
    parts.push(header);
    parts.push(body);
  }

  // =========================================================================
  // Keyboard methods (Delegated)
  // =========================================================================

  keyHome(): void { kb.keyHome(this); }
  isProtected(address: number): boolean { return kb.isProtected(this, address); }
  isProtectedAttr(fattr: number): boolean { return kb.isProtectedAttr(fattr); }
  isUnprotected(): boolean { return kb.isUnprotected(this); }
  keyAid(aid: number): void { kb.keyAid(this, aid); }
  enter(text?: string): void { kb.enter(this, text); }
  
  pf1(): void { this.keyAid(AID.PF1); }
  pf2(): void { this.keyAid(AID.PF2); }
  pf3(): void { this.keyAid(AID.PF3); }
  pf4(): void { this.keyAid(AID.PF4); }
  pf5(): void { this.keyAid(AID.PF5); }
  pf6(): void { this.keyAid(AID.PF6); }
  pf7(): void { this.keyAid(AID.PF7); }
  pf8(): void { this.keyAid(AID.PF8); }
  pf9(): void { this.keyAid(AID.PF9); }
  pf10(): void { this.keyAid(AID.PF10); }
  pf11(): void { this.keyAid(AID.PF11); }
  pf12(): void { this.keyAid(AID.PF12); }
  pf13(): void { this.keyAid(AID.PF13); }
  pf14(): void { this.keyAid(AID.PF14); }
  pf15(): void { this.keyAid(AID.PF15); }
  pf16(): void { this.keyAid(AID.PF16); }
  pf17(): void { this.keyAid(AID.PF17); }
  pf18(): void { this.keyAid(AID.PF18); }
  pf19(): void { this.keyAid(AID.PF19); }
  pf20(): void { this.keyAid(AID.PF20); }
  pf21(): void { this.keyAid(AID.PF21); }
  pf22(): void { this.keyAid(AID.PF22); }
  pf23(): void { this.keyAid(AID.PF23); }
  pf24(): void { this.keyAid(AID.PF24); }

  pa1(): void { this.keyAid(AID.PA1); }
  pa2(): void { this.keyAid(AID.PA2); }
  pa3(): void { this.keyAid(AID.PA3); }
  clear(): void { this.keyAid(AID.CLEAR); }

  keyCurDown(): void { kb.keyCurDown(this); }
  keyCurUp(): void { kb.keyCurUp(this); }
  keyCurLeft(): void { kb.keyCurLeft(this); }
  keyCurRight(): void { kb.keyCurRight(this); }
  setCursorPosition(row: number, col: number): void { kb.setCursorPosition(this, row, col); }
  setDataAt(text: string, row?: number, col?: number): number { return kb.setDataAt(this, text, row, col); }

  keyTab(): void { kb.keyTab(this); }
  keyBacktab(): void { kb.keyBacktab(this); }
  keyNewline(): void { kb.keyNewline(this); }
  keyEnd(): void { kb.keyEnd(this); }
  keyData(text: string): number { return kb.keyData(this, text); }
  keyInsData(text: string): number { return kb.keyInsData(this, text); }
  keyDelete(): boolean { return kb.keyDelete(this); }
  keyBackspace(): boolean { return kb.keyBackspace(this); }
  keyEraseEof(): boolean { return kb.keyEraseEof(this); }
  keyEraseInput(): void { kb.keyEraseInput(this); }
  attn(): void { kb.attn(this); }

  // =========================================================================
  // Screen reading helpers (Delegated)
  // =========================================================================

  scrstr(saddr = 0, eaddr = 0, rstrip?: boolean): string {
    return screen.scrstr(this, saddr, eaddr, rstrip);
  }

  scrhas(text: string, saddr = 0): boolean {
    return screen.scrhas(this, text, saddr);
  }
}

/**
 * ATI (Automated Task Interpreter) automation layer.
 *
 * Manages multiple TN3270 sessions and provides a high-level API
 * for sending keystrokes, waiting for screen conditions, and
 * extracting screen data.
 *
 *
 * @module automation/ati
 */

import { Tnz } from '../core/tnz';
import type { TnzOptions } from '../types';
import { FileTransfer } from './file-transfer';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/** ATI automation error. */
export class AtiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtiError';
  }
}

// ---------------------------------------------------------------------------
// Sentinel constants
// ---------------------------------------------------------------------------

/** Sentinel for case-insensitive search. */
export const CASI = Symbol('CASI');

/** Sentinel for end-of-line extraction. */
export const EOL = Symbol('EOL');

/** Sentinel for first-occurrence search. */
export const FIRST = Symbol('FIRST');

/** Sentinel for last-occurrence search. */
export const LAST = Symbol('LAST');

// ---------------------------------------------------------------------------
// Mnemonic key strings
// ---------------------------------------------------------------------------

export const enter = '[enter]';
export const clear = '[clear]';
export const pa1 = '[pa1]';
export const pa2 = '[pa2]';
export const pa3 = '[pa3]';
export const pf1 = '[pf1]';
export const pf2 = '[pf2]';
export const pf3 = '[pf3]';
export const pf4 = '[pf4]';
export const pf5 = '[pf5]';
export const pf6 = '[pf6]';
export const pf7 = '[pf7]';
export const pf8 = '[pf8]';
export const pf9 = '[pf9]';
export const pf10 = '[pf10]';
export const pf11 = '[pf11]';
export const pf12 = '[pf12]';
export const pf13 = '[pf13]';
export const pf14 = '[pf14]';
export const pf15 = '[pf15]';
export const pf16 = '[pf16]';
export const pf17 = '[pf17]';
export const pf18 = '[pf18]';
export const pf19 = '[pf19]';
export const pf20 = '[pf20]';
export const pf21 = '[pf21]';
export const pf22 = '[pf22]';
export const pf23 = '[pf23]';
export const pf24 = '[pf24]';
export const tab = '[tab]';
export const backtab = '[backtab]';
export const home = '[home]';
export const newline = '[newline]';
export const curdown = '[curdown]';
export const curleft = '[curleft]';
export const curright = '[curright]';
export const curup = '[curup]';
export const del = '[delete]';
export const eraseeof = '[eraseeof]';
export const insert = '[insert]';
export const reset = '[reset]';
export const attn = '[attn]';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Options for connecting a new session. */
export interface SessionOptions {
  /** Hostname to connect to. */
  host: string;
  /** Port number (default 23). */
  port?: number;
  /** Use TLS/SSL (default false). */
  secure?: boolean;
  /** Verify server certificate (default true). */
  verifyCert?: boolean;
  /** Alternate screen rows. */
  amaxRow?: number;
  /** Alternate screen columns. */
  amaxCol?: number;
  /** EBCDIC encoding (e.g. 'cp037'). */
  encoding?: string;
  /** Use TN3270E mode. */
  useTn3270e?: boolean;
  /** LU name for TN3270E. */
  luName?: string;
  /** Terminal type string. */
  terminalType?: string;
}

/** A WHEN block registration. */
interface WhenEntry {
  /** Condition function. */
  condition: () => boolean;
  /** Action function. */
  action: () => void;
  /** Priority (lower = higher priority, default 1). */
  priority: number;
  /** Whether actively monitoring. */
  active: boolean;
  /** Label name. */
  name: string;
}

// ---------------------------------------------------------------------------
// AID key dispatch table
// ---------------------------------------------------------------------------

/** Map of mnemonic strings to Tnz method names for AID keys. */
const AID_KEYS: Record<string, string> = {
  '[enter]': 'enter',
  '[clear]': 'clear',
  '[pa1]': 'pa1',
  '[pa2]': 'pa2',
  '[pa3]': 'pa3',
  '[pf1]': 'pf1',
  '[pf2]': 'pf2',
  '[pf3]': 'pf3',
  '[pf4]': 'pf4',
  '[pf5]': 'pf5',
  '[pf6]': 'pf6',
  '[pf7]': 'pf7',
  '[pf8]': 'pf8',
  '[pf9]': 'pf9',
  '[pf10]': 'pf10',
  '[pf11]': 'pf11',
  '[pf12]': 'pf12',
  '[pf13]': 'pf13',
  '[pf14]': 'pf14',
  '[pf15]': 'pf15',
  '[pf16]': 'pf16',
  '[pf17]': 'pf17',
  '[pf18]': 'pf18',
  '[pf19]': 'pf19',
  '[pf20]': 'pf20',
  '[pf21]': 'pf21',
  '[pf22]': 'pf22',
  '[pf23]': 'pf23',
  '[pf24]': 'pf24',
  '[attn]': 'attn',
};

/** Map of mnemonic strings to Tnz method names for movement/editing. */
const MOVE_KEYS: Record<string, string> = {
  '[tab]': 'keyTab',
  '[backtab]': 'keyBacktab',
  '[home]': 'keyHome',
  '[newline]': 'keyNewline',
  '[curdown]': 'keyCurDown',
  '[curleft]': 'keyCurLeft',
  '[curright]': 'keyCurRight',
  '[curup]': 'keyCurUp',
  '[delete]': 'keyDelete',
  '[eraseeof]': 'keyEraseEof',
};

// ---------------------------------------------------------------------------
// Ati class
// ---------------------------------------------------------------------------

/**
 * Automation layer for managing TN3270 sessions.
 *
 * Provides session management, send/wait/when primitives, and
 * screen reading helpers (scrhas, extract).
 *
 */
export class Ati {
  // -- Session registry --

  /** Map of uppercase session names to Tnz instances. */
  private _sessions = new Map<string, Tnz>();
  
  /** Map of uppercase session names to FileTransfer instances. */
  private _fileTransfers = new Map<string, FileTransfer>();

  /** Current session name (uppercase). */
  private _currentSession = 'NONE';

  // -- Internal variables --

  /** Last return code. */
  rc = 0;

  /** Hit row (1-based) from last scrhas/extract. */
  hitRow = 1;

  /** Hit column (1-based) from last scrhas/extract. */
  hitCol = 1;

  /** Hit string from last scrhas. */
  hitStr = '';

  /** Last string sent by send(). */
  sendStr = '';

  /** Name of lost session (empty = none). */
  seslost = '';

  /** Default wait timeout in seconds. */
  maxWait = 120;

  /** Centiseconds between wait re-checks (1-99, i.e. 10ms-990ms). */
  waitSleep = 5;

  /** Seconds to wait for keyboard unlock in send(). */
  keyUnlock = 60;

  /** Whether ONERROR causes wait timeout to throw. */
  onError = false;

  // -- WHEN blocks --

  /** Registered WHEN entries. */
  private _whens: WhenEntry[] = [];

  /** Whether currently executing a WHEN block. */
  private _inWhen = false;

  /** Whether a WHEN fired during this cycle. */
  private _ranWhen = false;

  // -- User variables --

  /** User-defined variables (uppercase keys). */
  private _vars = new Map<string, string>();

  // =========================================================================
  // Session management
  // =========================================================================

  /** Get current session name. */
  get session(): string {
    return this._currentSession;
  }

  /** Set current session (switch or connect). */
  set session(name: string) {
    const unam = name.toUpperCase().trim();
    if (!unam) throw new AtiError('no session name');

    if (this._sessions.has(unam)) {
      // Switch to existing session
      this._currentSession = unam;
      this.rc = 1;
    } else {
      // New session — must be connected via connectSession()
      throw new AtiError(
        `Session ${unam} not found. Use connectSession() to create.`,
      );
    }
  }

  /** Get space-separated list of session names. */
  get sessions(): string {
    return [...this._sessions.keys()].join(' ');
  }

  /**
   * Connect a new session.
   *
   * @param name - Session name (will be uppercased)
   * @param options - Connection options
   * @returns The connected Tnz instance
   */
  async connectSession(
    name: string,
    options: SessionOptions,
  ): Promise<Tnz> {
    const unam = name.toUpperCase().trim();
    if (!unam) throw new AtiError('no session name');
    if (this._sessions.has(unam)) {
      throw new AtiError(`${unam} already established`);
    }

    const tnzOpts: TnzOptions = {};
    if (options.amaxRow !== undefined) tnzOpts.amaxRow = options.amaxRow;
    if (options.amaxCol !== undefined) tnzOpts.amaxCol = options.amaxCol;
    if (options.encoding !== undefined) tnzOpts.encoding = options.encoding;
    if (options.useTn3270e !== undefined) {
      tnzOpts.useTn3270e = options.useTn3270e;
    }
    if (options.luName !== undefined) tnzOpts.luName = options.luName;
    if (options.terminalType !== undefined) {
      tnzOpts.terminalType = options.terminalType;
    }

    const tns = new Tnz(unam, tnzOpts);
    await tns.connect(options.host, options.port ?? 23, {
      secure: options.secure,
      verifyCert: options.verifyCert,
    });

    this._sessions.set(unam, tns);
    this._fileTransfers.set(unam, new FileTransfer(tns));
    this._currentSession = unam;
    this.rc = 0;
    return tns;
  }

  /**
   * Register an already-created Tnz instance as a session.
   *
   * Useful for testing or when the Tnz instance is created externally.
   */
  registerSession(name: string, tnz: Tnz): void {
    const unam = name.toUpperCase().trim();
    if (!unam) throw new AtiError('no session name');
    if (this._sessions.has(unam)) {
      throw new AtiError(`${unam} already established`);
    }
    this._sessions.set(unam, tnz);
    this._fileTransfers.set(unam, new FileTransfer(tnz));
    this._currentSession = unam;
  }

  /**
   * Get the Tnz instance for a session.
   *
   * @param name - Session name (defaults to current session)
   * @returns The Tnz instance, or undefined if not found
   */
  getTnz(name?: string): Tnz | undefined {
    const key = name?.toUpperCase().trim() ?? this._currentSession;
    return this._sessions.get(key);
  }

  /**
   * Drop (disconnect) the current session.
   *
   */
  dropSession(): void {
    const session = this._currentSession;
    if (session === 'NONE' || !this._sessions.has(session)) {
      return;
    }

    const tns = this._sessions.get(session)!;
    this._sessions.delete(session);
    this._fileTransfers.delete(session);

    // Pick next session
    if (this._sessions.size > 0) {
      this._currentSession = this._sessions.keys().next().value!;
    } else {
      this._currentSession = 'NONE';
    }

    tns.shutdown();
  }

  /**
   * Rename the current session.
   *
   */
  renameSession(newName: string): void {
    const unam = newName.toUpperCase().trim();
    if (!unam) throw new AtiError('no session name');

    const session = this._currentSession;
    if (session === 'NONE' || !this._sessions.has(session)) {
      throw new AtiError('no active session');
    }
    if (session === unam) return;
    if (this._sessions.has(unam)) {
      throw new AtiError(`${unam} already established`);
    }

    const tns = this._sessions.get(session)!;
    const ft = this._fileTransfers.get(session)!;
    this._sessions.delete(session);
    this._fileTransfers.delete(session);
    
    this._sessions.set(unam, tns);
    this._fileTransfers.set(unam, ft);
    this._currentSession = unam;
  }

  // =========================================================================
  // Screen reading
  // =========================================================================

  /**
   * Get current screen row count.
   */
  get maxRow(): number {
    const tns = this.getTnz();
    return tns ? tns.maxRow : 0;
  }

  /**
   * Get current screen column count.
   */
  get maxCol(): number {
    const tns = this.getTnz();
    return tns ? tns.maxCol : 0;
  }

  /**
   * Get cursor row (1-based).
   */
  get curRow(): number {
    const tns = this.getTnz();
    if (!tns) return 0;
    return Math.floor(tns.curadd / tns.maxCol) + 1;
  }

  /**
   * Get cursor column (1-based).
   */
  get curCol(): number {
    const tns = this.getTnz();
    if (!tns) return 0;
    return (tns.curadd % tns.maxCol) + 1;
  }

  /**
   * Whether keyboard is locked.
   */
  get keyLock(): boolean {
    const tns = this.getTnz();
    if (!tns) return false;
    return tns.pwait || tns.systemLockWait;
  }

  /**
   * Check if the current session screen contains a string.
   *
   * Simple overload: `scrhas(text)` — searches entire screen.
   *
   * @param text - Text to search for
   * @param caseInsensitive - Whether to search case-insensitively
   * @returns true if found
   *
   */
  scrhas(text: string, caseInsensitive = false): boolean {
    const tns = this.getTnz();
    if (!tns) {
      this.rc = 12;
      return false;
    }

    const scrStr = tns.scrstr(0, 0, false);
    const found = caseInsensitive
      ? scrStr.toLowerCase().includes(text.toLowerCase())
      : scrStr.includes(text);

    if (found) {
      const idx = caseInsensitive
        ? scrStr.toLowerCase().indexOf(text.toLowerCase())
        : scrStr.indexOf(text);
      const hitRow = Math.floor(idx / tns.maxCol) + 1;
      const hitCol = (idx % tns.maxCol) + 1;
      this.hitRow = hitRow;
      this.hitCol = hitCol;
      this.hitStr = text;
      this.rc = 0;
      return true;
    }

    this.rc = 1;
    return false;
  }

  /**
   * Extract text from the current session screen.
   *
   * @param length - Number of characters to extract, or EOL symbol
   * @param row - Start row (1-based, default 1)
   * @param col - Start column (1-based, default 1)
   * @returns Extracted text
   *
   */
  extract(
    length: number | typeof EOL,
    row = 1,
    col = 1,
  ): string {
    const tns = this.getTnz();
    if (!tns) {
      this.rc = 12;
      return '';
    }

    const maxCol = tns.maxCol;
    const maxRow = tns.maxRow;
    const scrSize = maxCol * maxRow;

    // Handle negative row/col (relative to screen edge)
    let r = row;
    let c = col;
    if (r <= 0) r = maxRow + r + 1;
    if (c <= 0) c = maxCol + c + 1;

    const start = (r - 1) * maxCol + (c - 1);
    if (start < 0 || start >= scrSize) {
      this.rc = 8;
      return '';
    }

    const scrStr = tns.scrstr(0, 0, false);

    let end: number;
    if (length === EOL) {
      // Extract to end of current row
      const rowEnd = Math.floor(start / maxCol) * maxCol + maxCol;
      end = rowEnd;
    } else {
      if (length < 1) {
        this.rc = 3;
        return '';
      }
      end = start + length;
      if (end > scrSize) {
        this.rc = 9;
        end = scrSize;
      } else {
        this.rc = 0;
      }
    }

    const hitY = Math.floor(start / maxCol);
    const hitX = start % maxCol;
    this.hitRow = hitY + 1;
    this.hitCol = hitX + 1;

    return scrStr.slice(start, end);
  }

  // =========================================================================
  // Send
  // =========================================================================

  /**
   * Send keystrokes and/or AID keys to the current session.
   *
   * The value string can contain plain text and mnemonic keys
   * like `[enter]`, `[pf3]`, `[tab]`, `[home]`, etc.
   *
   * AID keys (`[enter]`, `[clear]`, `[pa1-3]`, `[pf1-24]`, `[attn]`)
   * terminate the send — anything after is ignored.
   *
   * Movement/editing keys (`[tab]`, `[backtab]`, `[home]`, `[newline]`,
   * `[curdown]`, `[curleft]`, `[curright]`, `[curup]`, `[delete]`,
   * `[eraseeof]`) do NOT terminate the send.
   *
   * `[insert]` switches to insert mode; `[reset]` switches back.
   *
   * @param value - String with text and/or mnemonic keys
   * @param pos - Optional cursor position [row, col] (1-based)
   * @returns Return code (0=success, 4=partial, 12=session lost)
   *
   */
  async send(value: string, pos?: [number, number]): Promise<number> {
    const tns = this.getTnz();
    if (!tns || this._currentSession === 'NONE') {
      this.rc = 12;
      return 12;
    }

    if (tns.seslost) {
      this.rc = 12;
      return 12;
    }

    // Wait for keyboard to unlock (unless bypassing with reset)
    if (!value.startsWith(reset)) {
      const startTime = Date.now();
      const endTime = startTime + this.keyUnlock * 1000;
      
      while (this.keyLock) {
        if (Date.now() >= endTime) {
          // Keyboard lock timeout
          this.rc = 14;
          return 14;
        }
        if (tns.seslost) {
          this.rc = 12;
          return 12;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // Position cursor if requested
    if (pos) {
      tns.setCursorPosition(pos[0], pos[1]);
    }

    let useInsert = false;
    let sendStr = '';
    let rest = value;
    let sent = false;

    while (rest.length > 0) {
      const bracketIdx = rest.indexOf('[');
      if (bracketIdx < 0) {
        // All plain text
        const cnt = useInsert
          ? tns.keyInsData(rest)
          : tns.keyData(rest);
        sendStr += rest.slice(0, cnt);
        break;
      }

      // Type plain text before the bracket
      if (bracketIdx > 0) {
        const plain = rest.slice(0, bracketIdx);
        if (useInsert) {
          tns.keyInsData(plain);
        } else {
          tns.keyData(plain);
        }
        sendStr += plain;
        rest = rest.slice(bracketIdx);
      }

      // Handle `[[` escape (literal `[`)
      if (rest.startsWith('[[')) {
        if (useInsert) {
          tns.keyInsData('[');
        } else {
          tns.keyData('[');
        }
        sendStr += '[[';
        rest = rest.slice(2);
        continue;
      }

      // Try to match a mnemonic key
      let matched = false;

      // Check AID keys (these terminate send)
      for (const [mnemonic, method] of Object.entries(AID_KEYS)) {
        if (rest.startsWith(mnemonic)) {
          (tns as unknown as Record<string, () => void>)[method]();
          sendStr += mnemonic;
          rest = rest.slice(mnemonic.length);
          sent = true;
          matched = true;
          break;
        }
      }
      if (sent) break;

      // Check movement/editing keys (these do NOT terminate)
      for (const [mnemonic, method] of Object.entries(MOVE_KEYS)) {
        if (rest.startsWith(mnemonic)) {
          (tns as unknown as Record<string, () => void>)[method]();
          sendStr += mnemonic;
          rest = rest.slice(mnemonic.length);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Special: [insert] and [reset]
      if (rest.startsWith(insert)) {
        useInsert = true;
        sendStr += insert;
        rest = rest.slice(insert.length);
        continue;
      }

      if (rest.startsWith(reset)) {
        useInsert = false;
        sendStr += reset;
        rest = rest.slice(reset.length);
        continue;
      }

      // Unknown mnemonic
      throw new AtiError('unknown mnemonic: ' + rest.slice(0, 20));
    }

    this.sendStr = sendStr;

    const atiRc = sendStr === value ? 0 : 4;
    this.rc = atiRc;
    return atiRc;
  }

  // =========================================================================
  // File Transfer (IND$FILE)
  // =========================================================================

  /**
   * Put host file from local file.
   *
   * @param filename - Local file path to upload
   * @param parms - IND$FILE parameters (e.g. 'DATASET.NAME ASCII CRLF')
   */
  async putFile(filename: string, parms: string): Promise<void> {
    const ft = this._fileTransfers.get(this._currentSession);
    if (!ft) throw new AtiError('No active session for file transfer');
    await ft.putFile(filename, parms);
  }

  /**
   * Get host file into local file.
   *
   * @param parms - IND$FILE parameters (e.g. 'DATASET.NAME ASCII CRLF')
   * @param filename - Local file path to save to
   */
  async getFile(parms: string, filename: string): Promise<void> {
    const ft = this._fileTransfers.get(this._currentSession);
    if (!ft) throw new AtiError('No active session for file transfer');
    await ft.getFile(parms, filename);
  }

  // =========================================================================
  // Wait
  // =========================================================================

  /**
   * Wait for a condition or timeout.
   *
   * @param timeout - Timeout in seconds (default: maxWait)
   * @param condition - Condition function (optional)
   * @returns 0=timeout, 1=condition met, 12=session lost
   *
   */
  async wait(
    timeout?: number,
    condition?: () => boolean,
  ): Promise<number> {
    const tout = timeout ?? this.maxWait;
    const startTime = Date.now();
    const endTime = startTime + tout * 1000;

    while (true) {
      // Check condition
      if (condition) {
        if (condition()) {
          this.rc = 1;
          return 1;
        }
      }

      // Run WHENs
      const whenRan = this._runWhens();

      // Re-check condition after WHENs
      if (whenRan && condition) {
        if (condition()) {
          this.rc = 1;
          return 1;
        }
      }

      // Check session health
      const tns = this.getTnz();
      if (tns && tns.seslost) {
        this.seslost = this._currentSession;
        this.rc = 12;
        return 12;
      }

      // Check timeout
      const remaining = endTime - Date.now();
      if (remaining <= 0) {
        if (this.onError && condition) {
          throw new AtiError('WAIT TIMEOUT occurred');
        }
        this.rc = 0;
        return 0;
      }

      // Sleep for waitSleep (centiseconds) or remaining time, whichever is less
      const sleepMs = Math.min(
        this.waitSleep * 10,
        remaining,
      );
      await new Promise<void>((resolve) =>
        setTimeout(resolve, sleepMs),
      );
    }
  }

  // =========================================================================
  // WHEN blocks
  // =========================================================================

  /**
   * Register a WHEN block.
   *
   * @param name - Label for this WHEN block
   * @param condition - Condition function
   * @param action - Action to execute when condition is true
   * @param priority - Priority (lower = higher, default 1)
   *
   */
  whenOn(
    name: string,
    condition: () => boolean,
    action: () => void,
    priority = 1,
  ): void {
    const unam = name.toUpperCase().trim();

    // Check if already registered
    const existing = this._whens.find((w) => w.name === unam);
    if (existing) {
      existing.condition = condition;
      existing.action = action;
      existing.priority = priority;
      existing.active = true;
      return;
    }

    this._whens.push({
      name: unam,
      condition,
      action,
      priority,
      active: true,
    });

    // Run immediately on registration (unless inside a WHEN)
    if (!this._inWhen) {
      try {
        this._inWhen = true;
        if (condition()) {
          action();
        }
      } finally {
        this._inWhen = false;
      }
    }
  }

  /**
   * Turn off a WHEN block.
   *
   * @param name - Label of the WHEN block to deactivate
   */
  whenOff(name: string): void {
    const unam = name.toUpperCase().trim();
    const entry = this._whens.find((w) => w.name === unam);
    if (entry) {
      entry.active = false;
    }
  }

  /**
   * Run all active WHEN blocks in priority order.
   *
   * @returns true if any WHEN body actually ran
   */
  private _runWhens(): boolean {
    if (this._inWhen) return false;

    // Sort by priority (lower = higher priority)
    const sorted = this._whens
      .filter((w) => w.active)
      .sort((a, b) => a.priority - b.priority);

    this._ranWhen = false;
    try {
      this._inWhen = true;
      for (const when of sorted) {
        if (when.condition()) {
          when.action();
          this._ranWhen = true;
        }
      }
    } finally {
      this._inWhen = false;
    }

    return this._ranWhen;
  }

  // =========================================================================
  // Variables
  // =========================================================================

  /**
   * Get the value of a variable.
   * Returns the variable value, or the uppercased name if not set.
   *
   */
  value(name: string): string {
    const unam = name.toUpperCase().trim();

    // Check special internal variables first
    switch (unam) {
      case 'SESSION':
        return this._currentSession;
      case 'SESSIONS':
        return this.sessions;
      case 'MAXROW':
        return String(this.maxRow);
      case 'MAXCOL':
        return String(this.maxCol);
      case 'CURROW':
        return String(this.curRow);
      case 'CURCOL':
        return String(this.curCol);
      case 'HITROW':
        return String(this.hitRow);
      case 'HITCOL':
        return String(this.hitCol);
      case 'HITSTR':
        return this.hitStr;
      case 'KEYLOCK':
        return this.keyLock ? '1' : '0';
      case 'SENDSTR':
        return this.sendStr;
      case 'SESLOST':
        return this.seslost;
      case 'RC':
        return String(this.rc);
      case 'MAXWAIT':
        return String(this.maxWait);
      case 'WAITSLEEP':
        return String(this.waitSleep);
      case 'KEYUNLOCK':
        return String(this.keyUnlock);
      case 'ONERROR':
        return this.onError ? '1' : '0';
      default:
        break;
    }

    // Check user variables
    const val = this._vars.get(unam);
    if (val !== undefined) return val;

    // ATI convention: unset variable = its own uppercased name
    return unam;
  }

  /**
   * Set a variable value.
   *
   * @param name - Variable name
   * @param val - Value to set
   *
   */
  set(name: string, val: string | number | boolean): void {
    const unam = name.toUpperCase().trim();
    const valStr =
      val === true ? '1' : val === false ? '0' : String(val);

    // Handle special internal variables
    switch (unam) {
      case 'SESSION':
        this.session = valStr;
        return;
      case 'MAXWAIT':
        this.maxWait = Ati._parseSeconds(valStr);
        return;
      case 'WAITSLEEP':
        // Centiseconds (1-99, i.e. 10ms-990ms)
        this.waitSleep = Math.max(1, Math.min(99, Math.round(Number(valStr))));
        return;
      case 'KEYUNLOCK':
        this.keyUnlock = Math.max(1, Number(valStr));
        return;
      case 'ONERROR':
        this.onError = valStr !== '0' && valStr !== '';
        return;
      case 'RC':
        this.rc = Number(valStr);
        return;
      default:
        break;
    }

    // Read-only checks
    const readOnly = new Set([
      'SESSIONS', 'MAXCOL', 'MAXROW', 'CURCOL', 'CURROW',
      'HITCOL', 'HITROW', 'HITSTR', 'KEYLOCK', 'SENDSTR',
      'SESLOST',
    ]);
    if (readOnly.has(unam)) {
      throw new AtiError(`${unam} is read-only`);
    }

    // Store as user variable
    this._vars.set(unam, valStr);
  }

  /**
   * Drop (delete) a user variable.
   *
   */
  drop(name: string): void {
    const unam = name.toUpperCase().trim();

    if (unam === 'SESSION') {
      this.dropSession();
      return;
    }

    this._vars.delete(unam);
  }

  // =========================================================================
  // Utility
  // =========================================================================

  /**
   * Parse a time string like "[[hh:]mm:]ss" to seconds.
   */
  static _parseSeconds(value: string | number): number {
    if (typeof value === 'number') return value;
    const parts = value.split(':').map(Number);
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return Number(value);
  }

  /**
   * Parse a numeric value from a string (ATI-style).
   * Extracts leading digits, returns 0 for empty/non-numeric.
   *
   */
  static num(value: string | number): number {
    if (typeof value === 'number') return value;
    const match = value.match(/^-?\d+/);
    return match ? Number(match[0]) : 0;
  }
}

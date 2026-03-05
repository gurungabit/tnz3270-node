import { Ati } from '../src/automation/ati';
import type { Tnz } from '../src/core/tnz';

/**
 * High-level wrapper around Ati for UI automation.
 * Provides simple methods instead of ati.send('[enter]') / ati.wait(...) patterns.
 */
export class Session {
  private ati: Ati;
  private defaultTimeout: number;

  constructor(tnz: Tnz, sessionName = 'WEB', defaultTimeout = 10) {
    this.ati = new Ati();
    this.ati.registerSession(sessionName, tnz);
    this.defaultTimeout = defaultTimeout;
  }

  // --- Keys ---

  async enter(text?: string): Promise<void> {
    if (text) await this.ati.send(`${text}[enter]`);
    else await this.ati.send('[enter]');
  }

  async clear(): Promise<void> { await this.ati.send('[clear]'); }
  async tab(): Promise<void> { await this.ati.send('[tab]'); }
  async backtab(): Promise<void> { await this.ati.send('[backtab]'); }
  async attn(): Promise<void> { await this.ati.send('[attn]'); }
  async home(): Promise<void> { await this.ati.send('[home]'); }
  async eraseeof(): Promise<void> { await this.ati.send('[eraseeof]'); }
  async newline(): Promise<void> { await this.ati.send('[newline]'); }
  async reset(): Promise<void> { await this.ati.send('[reset]'); }

  async pf(n: number): Promise<void> { await this.ati.send(`[pf${n}]`); }
  async pf1(): Promise<void> { await this.pf(1); }
  async pf2(): Promise<void> { await this.pf(2); }
  async pf3(): Promise<void> { await this.pf(3); }
  async pf4(): Promise<void> { await this.pf(4); }
  async pf5(): Promise<void> { await this.pf(5); }
  async pf6(): Promise<void> { await this.pf(6); }
  async pf7(): Promise<void> { await this.pf(7); }
  async pf8(): Promise<void> { await this.pf(8); }
  async pf9(): Promise<void> { await this.pf(9); }
  async pf10(): Promise<void> { await this.pf(10); }
  async pf11(): Promise<void> { await this.pf(11); }
  async pf12(): Promise<void> { await this.pf(12); }
  async pf13(): Promise<void> { await this.pf(13); }
  async pf14(): Promise<void> { await this.pf(14); }
  async pf15(): Promise<void> { await this.pf(15); }
  async pf16(): Promise<void> { await this.pf(16); }
  async pf17(): Promise<void> { await this.pf(17); }
  async pf18(): Promise<void> { await this.pf(18); }
  async pf19(): Promise<void> { await this.pf(19); }
  async pf20(): Promise<void> { await this.pf(20); }
  async pf21(): Promise<void> { await this.pf(21); }
  async pf22(): Promise<void> { await this.pf(22); }
  async pf23(): Promise<void> { await this.pf(23); }
  async pf24(): Promise<void> { await this.pf(24); }

  async pa(n: number): Promise<void> { await this.ati.send(`[pa${n}]`); }
  async pa1(): Promise<void> { await this.pa(1); }
  async pa2(): Promise<void> { await this.pa(2); }
  async pa3(): Promise<void> { await this.pa(3); }

  // --- Text input ---

  async type(text: string): Promise<void> {
    await this.ati.send(text);
  }

  async typeAt(row: number, col: number, text: string): Promise<void> {
    await this.ati.send(text, [row, col]);
  }

  // --- Waits ---

  /** Wait for text to appear on screen. Throws on timeout. */
  async waitForText(text: string, timeout?: number): Promise<void> {
    const rc = await this.ati.wait(timeout ?? this.defaultTimeout, () => this.ati.scrhas(text));
    if (rc === 0) throw new Error(`Timeout waiting for "${text}"`);
  }

  /** Wait for text to disappear from screen. Throws on timeout. */
  async waitForTextGone(text: string, timeout?: number): Promise<void> {
    const rc = await this.ati.wait(timeout ?? this.defaultTimeout, () => !this.ati.scrhas(text));
    if (rc === 0) throw new Error(`Timeout waiting for "${text}" to disappear`);
  }

  /** Wait for keyboard to unlock. Throws on timeout. */
  async waitForKeyboard(timeout?: number): Promise<void> {
    const rc = await this.ati.wait(timeout ?? this.defaultTimeout, () => !this.ati.keyLock);
    if (rc === 0) throw new Error('Timeout waiting for keyboard unlock');
  }

  /** Wait with a custom condition. Returns true if condition met, false on timeout. */
  async waitFor(condition: () => boolean, timeout?: number): Promise<boolean> {
    const rc = await this.ati.wait(timeout ?? this.defaultTimeout, condition);
    return rc !== 0;
  }

  // --- Screen reading ---

  /** Check if text exists on screen. */
  hasText(text: string): boolean {
    return this.ati.scrhas(text);
  }

  /** Get text at a specific position. */
  getTextAt(row: number, col: number, length: number): string {
    if (row < 1 || row > this.rows || col < 1 || col > this.cols || length < 1) return '';
    return this.ati.extract(length, row, col);
  }

  /** Get text from position to end of row. */
  getTextToEol(row: number, col: number): string {
    if (row < 1 || row > this.rows || col < 1 || col > this.cols) return '';
    return this.ati.extract(this.cols - col + 1, row, col);
  }

  /** Get an entire row's text (1-based). */
  getRow(row: number): string {
    if (row < 1 || row > this.rows) return '';
    return this.ati.extract(this.cols, row, 1);
  }

  /** Get the full screen text. */
  get screenText(): string {
    return this.ati.getTnz()?.scrstr() ?? '';
  }

  /** Get screen text with passwords masked. */
  get screenTextMasked(): string {
    return this.ati.getTnz()?.scrstrMasked() ?? '';
  }

  /** Check if keyboard is locked. */
  get isLocked(): boolean {
    return this.ati.keyLock;
  }

  /** Current cursor row (1-based). */
  get cursorRow(): number {
    return this.ati.curRow;
  }

  /** Current cursor column (1-based). */
  get cursorCol(): number {
    return this.ati.curCol;
  }

  /** Screen rows. */
  get rows(): number {
    return this.ati.maxRow;
  }

  /** Screen columns. */
  get cols(): number {
    return this.ati.maxCol;
  }
}

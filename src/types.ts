/**
 * Core types, constants, and interfaces for TN3270 terminal emulation.
 *
 *
 * @module types
 */

// ---------------------------------------------------------------------------
// 3270 AID (Attention Identifier) codes
// Sent from terminal to host to identify the key pressed.
// Reference: tnz.py line 192, and 3270 Data Stream Architecture Reference
// ---------------------------------------------------------------------------

export const AID = {
  NONE: 0x60,
  ENTER: 0x7d,
  PF1: 0xf1,
  PF2: 0xf2,
  PF3: 0xf3,
  PF4: 0xf4,
  PF5: 0xf5,
  PF6: 0xf6,
  PF7: 0xf7,
  PF8: 0xf8,
  PF9: 0xf9,
  PF10: 0x7a,
  PF11: 0x7b,
  PF12: 0x7c,
  PF13: 0xc1,
  PF14: 0xc2,
  PF15: 0xc3,
  PF16: 0xc4,
  PF17: 0xc5,
  PF18: 0xc6,
  PF19: 0xc7,
  PF20: 0xc8,
  PF21: 0xc9,
  PF22: 0x4a,
  PF23: 0x4b,
  PF24: 0x4c,
  PA1: 0x6c,
  PA2: 0x6e,
  PA3: 0x6b,
  CLEAR: 0x6d,
  CLEAR_PARTITION: 0x6a,
  SYSREQ: 0xf0,
  STRUCTURED_FIELD: 0x88,
  READ_PARTITION: 0x61,
  TRIGGER: 0x7e,
} as const;

export type AidCode = (typeof AID)[keyof typeof AID];

// ---------------------------------------------------------------------------
// 3270 Command codes
// Sent from host to terminal.
// ---------------------------------------------------------------------------

export const CMD = {
  WRITE: 0xf1,
  ERASE_WRITE: 0xf5,
  ERASE_WRITE_ALTERNATE: 0x7e,
  READ_BUFFER: 0xf2,
  READ_MODIFIED: 0xf6,
  READ_MODIFIED_ALL: 0x6e,
  ERASE_ALL_UNPROTECTED: 0x6f,
  WRITE_STRUCTURED_FIELD: 0xf3,
} as const;

export type CommandCode = (typeof CMD)[keyof typeof CMD];

// ---------------------------------------------------------------------------
// 3270 Order codes
// Embedded in data stream to control buffer positioning and field creation.
// ---------------------------------------------------------------------------

export const ORDER = {
  /** Start Field */
  SF: 0x1d,
  /** Set Buffer Address */
  SBA: 0x11,
  /** Insert Cursor */
  IC: 0x13,
  /** Program Tab */
  PT: 0x05,
  /** Repeat to Address */
  RA: 0x3c,
  /** Erase Unprotected to Address */
  EUA: 0x12,
  /** Set Attribute */
  SA: 0x28,
  /** Start Field Extended */
  SFE: 0x29,
  /** Modify Field */
  MF: 0x2c,
  /** Graphic Escape */
  GE: 0x08,
} as const;

export type OrderCode = (typeof ORDER)[keyof typeof ORDER];

// ---------------------------------------------------------------------------
// Telnet protocol constants
// Reference: RFC 854, RFC 855, RFC 1576 (TN3270), RFC 2355 (TN3270E)
// ---------------------------------------------------------------------------

export const TELNET = {
  // Telnet commands
  IAC: 0xff,
  DONT: 0xfe,
  DO: 0xfd,
  WONT: 0xfc,
  WILL: 0xfb,
  SB: 0xfa,
  GA: 0xf9,
  EL: 0xf8,
  EC: 0xf7,
  AYT: 0xf6,
  AO: 0xf5,
  IP: 0xf4,
  BREAK: 0xf3,
  NOP: 0xf1,
  SE: 0xf0,
  EOR: 0xef,

  // Telnet options
  OPT_BINARY: 0x00,
  OPT_TERMINAL_TYPE: 0x18,
  OPT_EOR: 0x19,
  OPT_TN3270E: 0x28,
  OPT_START_TLS: 0x2e,

  // Terminal-type subnegotiation
  TERMINAL_TYPE_IS: 0x00,
  TERMINAL_TYPE_SEND: 0x01,

  // TN3270E subnegotiation
  TN3270E_SEND: 0x09,
  TN3270E_DEVICE_TYPE: 0x02,
  TN3270E_IS: 0x04,
  TN3270E_REQUEST: 0x07,
  TN3270E_FUNCTIONS: 0x03,
  TN3270E_RESPONSES: 0x02,

  // START_TLS subnegotiation
  START_TLS_FOLLOWS: 0x01,
} as const;

// ---------------------------------------------------------------------------
// 3270 Extended Attribute types
// Used in SA (Set Attribute), SFE (Start Field Extended), MF (Modify Field)
// ---------------------------------------------------------------------------

export const ATTR_TYPE = {
  ALL: 0x00,
  FIELD_ATTRIBUTE: 0xc0,
  EXTENDED_HIGHLIGHTING: 0x41,
  FOREGROUND_COLOR: 0x42,
  BACKGROUND_COLOR: 0x43,
  CHARACTER_SET: 0x43,
} as const;

// ---------------------------------------------------------------------------
// Extended Highlighting values
// ---------------------------------------------------------------------------

export const ExtendedHighlight = {
  DEFAULT: 0x00,
  NORMAL: 0xf0,
  BLINK: 0xf1,
  REVERSE_VIDEO: 0xf2,
  UNDERSCORE: 0xf4,
  INTENSIFY: 0xf8,
} as const;

export type ExtendedHighlightValue =
  (typeof ExtendedHighlight)[keyof typeof ExtendedHighlight];

// ---------------------------------------------------------------------------
// 3270 Color values
// ---------------------------------------------------------------------------

export const Color = {
  DEFAULT: 0x00,
  NEUTRAL_BLACK: 0xf0,
  BLUE: 0xf1,
  RED: 0xf2,
  PINK: 0xf3,
  GREEN: 0xf4,
  TURQUOISE: 0xf5,
  YELLOW: 0xf6,
  NEUTRAL_WHITE: 0xf7,
} as const;

export type ColorValue = (typeof Color)[keyof typeof Color];

// ---------------------------------------------------------------------------
// Field attribute bit flags
// Reference: 3270 Data Stream Architecture, Chapter 4
// ---------------------------------------------------------------------------

export const FA = {
  /** Protected field */
  PROTECTED: 0x20,
  /** Numeric-only field */
  NUMERIC: 0x10,
  /** Modified Data Tag */
  MDT: 0x01,

  // Display/intensity combinations (bits 3-4)
  DISPLAY_NOT_PEN: 0x00,
  DISPLAY_PEN: 0x04,
  INTENSIFIED_PEN: 0x08,
  NON_DISPLAY: 0x0c,
} as const;

// ---------------------------------------------------------------------------
// Structured Field identifiers
// Reference: tnz.py query reply and WSF processing
// ---------------------------------------------------------------------------

export const SF_ID = {
  READ_PARTITION: 0x01,
  QUERY_REPLY: 0x81,
  DDM: 0xd0,
} as const;

// Query Reply types
export const QR_TYPE = {
  USABLE_AREA: 0x81,
  HIGHLIGHT: 0x87,
  COLOR: 0x86,
  REPLY_MODES: 0x88,
  IMPLICIT_PARTITION: 0xa6,
  CHARACTER_SETS: 0x85,
  DDM: 0x95,
  RPQ_NAMES: 0xa1,
} as const;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Options for creating a Tnz connection. */
export interface TnzOptions {
  /** Use TLS/SSL for the connection (default: false) */
  secure?: boolean;
  /** Verify the server certificate (default: true) */
  verifyCert?: boolean;
  /** EBCDIC encoding to use (default: 'cp037') */
  encoding?: string;
  /** Terminal type string sent during negotiation */
  terminalType?: string;
  /** Enable TN3270E protocol negotiation */
  useTn3270e?: boolean;
  /** Logical unit name for TN3270E */
  luName?: string;
  /** Alternate screen rows */
  amaxRow?: number;
  /** Alternate screen columns */
  amaxCol?: number;
  /** Maximum TLS security level */
  secLevel?: number;
  /** Minimum TLS version */
  sslMinimumTls?: string;
  /** SSL verification mode */
  sslVerify?: string;
  /** Optional callback fired when the screen is updated by the host. */
  onScreenUpdate?: () => void;
}

/** Snapshot of connection security state. */
export interface ConnectionState {
  /** Whether the connection uses TLS */
  secure: boolean;
  /** Whether the server certificate was verified as trusted */
  certVerified: boolean;
  /** Whether the server hostname was verified */
  hostVerified: boolean;
  /** Whether 3270 data stream mode is active (vs NVT) */
  tn3270: boolean;
  /** Whether TN3270E protocol is in use */
  tn3270e: boolean;
  /** Whether STARTTLS upgrade completed */
  startTlsCompleted: boolean;
}

/** Describes a field on the 3270 screen. */
export interface FieldAttribute {
  /** Buffer address of the field attribute byte */
  address: number;
  /** Raw attribute byte value */
  attribute: number;
  /** Whether the field is protected from input */
  isProtected: boolean;
  /** Whether the field accepts only numeric input */
  isNumeric: boolean;
  /** Whether the field has been modified */
  isModified: boolean;
  /** Whether the field is visible */
  isDisplay: boolean;
  /** Whether the field is intensified (bright) */
  isIntensified: boolean;
}

/** Session presentation space size (rows x columns). */
export interface ScreenSize {
  rows: number;
  cols: number;
}

/**
 * Codec entry for EBCDIC encoding/decoding.
 * Maps an EBCDIC code page to encode/decode functions.
 */
export interface CodecEntry {
  /** Code page name (e.g. 'cp037') */
  name: string;
  /** Numeric code page ID extracted from name */
  codePageNumber: number;
  /** Encode Unicode string to EBCDIC bytes */
  encode: (str: string) => Buffer;
  /** Decode EBCDIC bytes to Unicode string */
  decode: (buf: Buffer) => string;
}

/**
 * DDM (Distributed Data Management) file transfer options.
 * Used by IND$FILE GET/PUT operations.
 */
export interface FileTransferOptions {
  /** Transfer mode */
  mode?: 'ascii' | 'binary';
  /** Record format */
  recfm?: 'F' | 'V' | 'U';
  /** Logical record length */
  lrecl?: number;
  /** Block size */
  blksize?: number;
  /** Append to existing file on download */
  append?: boolean;
  /** Space allocation for upload */
  space?: {
    primary: number;
    secondary: number;
    unit: 'tracks' | 'cylinders' | 'avblock';
  };
}

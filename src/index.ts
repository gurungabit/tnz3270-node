/**
 * tnz-node: TypeScript library for IBM mainframe TN3270 terminal automation.
 *
 *
 * @module tnz-node
 */

export type {
  TnzOptions,
  ConnectionState,
  FieldAttribute,
  ScreenSize,
  CodecEntry,
  FileTransferOptions,
  AidCode,
  CommandCode,
  OrderCode,
  ExtendedHighlightValue,
  ColorValue,
} from './types';

export {
  AID,
  CMD,
  ORDER,
  TELNET,
  Color,
  ExtendedHighlight,
  FA,
  SF_ID,
  QR_TYPE,
  ATTR_TYPE,
} from './types';

export { sessionPsSize, sessionPs14bit } from './utils/session-utils';

export {
  getCodec,
  isEncodingSupported,
  registerCodePage,
  translateDataToDisplay,
  getSpecialDisplayChar,
} from './utils/codepage';

// Core
export { Tnz, TnzError, TnzTerminalError, TnzTransferError, ReadState, bit6 } from './core/tnz';

// Automation
export {
  Ati,
  AtiError,
  CASI,
  EOL,
  FIRST,
  LAST,
  enter,
  clear,
  pa1,
  pa2,
  pa3,
  pf1,
  pf2,
  pf3,
  pf4,
  pf5,
  pf6,
  pf7,
  pf8,
  pf9,
  pf10,
  pf11,
  pf12,
  pf13,
  pf14,
  pf15,
  pf16,
  pf17,
  pf18,
  pf19,
  pf20,
  pf21,
  pf22,
  pf23,
  pf24,
  tab,
  backtab,
  home,
  newline,
  curdown,
  curleft,
  curright,
  curup,
  del,
  eraseeof,
  insert,
  reset,
  attn,
} from './automation/ati';

export type { IacMatch } from './core/telnet';
export {
  findIacSequences,
  escapeIac,
  unescapeIac,
  buildWill,
  buildWont,
  buildDo,
  buildDont,
  buildSub,
  buildEor,
  buildCommand,
  optionName,
} from './core/telnet';

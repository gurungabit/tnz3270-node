import * as net from 'node:net';
import * as tls from 'node:tls';
import { Tnz, TnzError, TnzTerminalError } from './tnz';
import { TELNET } from '../types';
import { escapeIac, findIacSequences } from './telnet';
import * as kb from './keyboard';

export async function connect(
  tnz: Tnz,
  host: string,
  port = 23,
  options: { secure?: boolean; verifyCert?: boolean } = {},
): Promise<void> {
  const { secure = false, verifyCert = true } = options;

  (tnz as any)._secure = secure;
  (tnz as any)._verifyCert = verifyCert;

  if ((tnz as any)._socket) {
    throw new TnzError('Already connected');
  }

  return new Promise((resolve, reject) => {
    let connected = false;

    const onConnect = () => {
      connected = true;
      resolve();
    };

    if (secure) {
      const tlsOptions: tls.ConnectionOptions = {
        host,
        port,
        rejectUnauthorized: verifyCert,
      };
      (tnz as any)._socket = tls.connect(tlsOptions, onConnect);
    } else {
      (tnz as any)._socket = net.connect({ host, port }, onConnect);
    }

    (tnz as any)._socket.on('data', (data: Buffer) => _dataReceived(tnz, data));

    (tnz as any)._socket.on('error', (err: Error) => {
      if (!connected) reject(err);
      tnz.seslost = true;
    });

    (tnz as any)._socket.on('close', () => {
      tnz.seslost = true;
      tnz.emit('close');
    });
  });
}

export function disconnect(tnz: Tnz): void {
  shutdown(tnz);
}

export function shutdown(tnz: Tnz): void {
  if ((tnz as any)._socket) {
    (tnz as any)._socket.destroy();
    (tnz as any)._socket = null;
  }
  tnz.seslost = true;
  (tnz as any)._startTlsHostname = null;
  (tnz as any)._startTlsCompleted = false;
  (tnz as any)._workBuffer = Buffer.alloc(0);
}

export function send(tnz: Tnz): void {
  if (!(tnz as any)._socket) {
    throw new TnzError('Not connected');
  }

  if ((tnz as any)._sendBuf.length === 0) return;

  const data = Buffer.concat((tnz as any)._sendBuf);
  (tnz as any)._sendBuf = [];
  (tnz as any)._socket.write(data);
}

export function sendWill(tnz: Tnz, opt: number, buffer = false): void {
  if (opt === TELNET.OPT_BINARY) {
    tnz.binaryLocal = true;
  }
  tnz.localWill.add(opt);
  tnz.localWont.delete(opt);
  (tnz as any)._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.WILL, opt]));
  if (!buffer) send(tnz);
}

export function sendWont(tnz: Tnz, opt: number, buffer = false): void {
  if (opt === TELNET.OPT_BINARY) {
    tnz.binaryLocal = false;
  }
  tnz.localWont.add(opt);
  tnz.localWill.delete(opt);
  (tnz as any)._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.WONT, opt]));
  if (!buffer) send(tnz);
}

export function sendDo(tnz: Tnz, opt: number, buffer = false): void {
  if (opt === TELNET.OPT_BINARY) {
    tnz.binaryRemote = true;
  } else if (opt === TELNET.OPT_EOR) {
    (tnz as any)._eor = true;
  }
  tnz.localDo.add(opt);
  tnz.localDont.delete(opt);
  (tnz as any)._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.DO, opt]));
  if (!buffer) send(tnz);
}

export function sendDont(tnz: Tnz, opt: number, buffer = false): void {
  if (opt === TELNET.OPT_BINARY) {
    tnz.binaryRemote = false;
  } else if (opt === TELNET.OPT_EOR) {
    (tnz as any)._eor = false;
  }
  tnz.localDont.add(opt);
  tnz.localDo.delete(opt);
  (tnz as any)._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.DONT, opt]));
  if (!buffer) send(tnz);
}

export function send3270Data(tnz: Tnz, data: Buffer): void {
  const isf = escapeIac(data);
  (tnz as any)._sendBuf.push(isf);
  (tnz as any)._sendBuf.push(Buffer.from([TELNET.IAC, TELNET.EOR]));
  send(tnz);
}

export function sendCommand(tnz: Tnz, cmd: number): void {
  (tnz as any)._sendBuf.push(Buffer.from([TELNET.IAC, cmd]));
  send(tnz);
}

export function _dataReceived(tnz: Tnz, data: Buffer): void {
  (tnz as any)._workBuffer = Buffer.concat([(tnz as any)._workBuffer, data]);

  while ((tnz as any)._workBuffer.length > 0) {
    const sequences = findIacSequences((tnz as any)._workBuffer);
    
    if (sequences.length === 0) {
      (tnz as any)._pendingRecord = Buffer.concat([(tnz as any)._pendingRecord, (tnz as any)._workBuffer]);
      (tnz as any)._workBuffer = Buffer.alloc(0);
      return;
    }

    const firstSeq = sequences[0];
    
    if (firstSeq.start > 0) {
      const dataBefore = (tnz as any)._workBuffer.subarray(0, firstSeq.start);
      (tnz as any)._pendingRecord = Buffer.concat([(tnz as any)._pendingRecord, dataBefore]);
    }

    _processIac(tnz, (tnz as any)._workBuffer.subarray(firstSeq.start, firstSeq.end));

    (tnz as any)._workBuffer = (tnz as any)._workBuffer.subarray(firstSeq.end);
  }
}

export function _processIac(tnz: Tnz, cmd: Buffer): void {
  if (cmd.length < 2) return;
  const op = cmd[1];

  switch (op) {
    case TELNET.WILL:
      _processWill(tnz, cmd[2]);
      break;
    case TELNET.WONT:
      _processWont(tnz, cmd[2]);
      break;
    case TELNET.DO:
      _processDo(tnz, cmd[2]);
      break;
    case TELNET.DONT:
      _processDont(tnz, cmd[2]);
      break;
    case TELNET.SB:
      _processSb(tnz, cmd.subarray(2));
      break;
    case TELNET.EOR:
      if ((tnz as any)._pendingRecord.length > 0) {
        (tnz as any)._proc3270ds((tnz as any)._pendingRecord);
        (tnz as any)._pendingRecord = Buffer.alloc(0);
      }
      break;
    case TELNET.IAC:
      (tnz as any)._pendingRecord = Buffer.concat([(tnz as any)._pendingRecord, Buffer.from([TELNET.IAC])]);
      break;
  }
}

export function _processWill(tnz: Tnz, opt: number): void {
  if (tnz.remoteWill.has(opt)) return;

  if (opt === TELNET.OPT_TN3270E) {
    tnz.remoteWill.add(opt);
    tnz.remoteWont.delete(opt);
    sendDo(tnz, opt);
  } else if (opt === TELNET.OPT_BINARY) {
    tnz.remoteWill.add(opt);
    tnz.remoteWont.delete(opt);
    tnz.binaryRemote = true;
    sendDo(tnz, opt);
  } else if (opt === TELNET.OPT_EOR) {
    tnz.remoteWill.add(opt);
    tnz.remoteWont.delete(opt);
    (tnz as any)._eor = true;
    sendDo(tnz, opt);
  } else if (opt === TELNET.OPT_TERMINAL_TYPE) {
    tnz.remoteWill.add(opt);
    tnz.remoteWont.delete(opt);
    sendDo(tnz, opt);
  } else {
    tnz.remoteWont.add(opt);
    sendDont(tnz, opt);
  }
}

export function _processWont(tnz: Tnz, opt: number): void {
  if (tnz.remoteWont.has(opt)) return;
  
  tnz.remoteWont.add(opt);
  tnz.remoteWill.delete(opt);

  if (opt === TELNET.OPT_BINARY) {
    tnz.binaryRemote = false;
  } else if (opt === TELNET.OPT_EOR) {
    (tnz as any)._eor = false;
  }
  sendDont(tnz, opt);
}

export function _processDo(tnz: Tnz, opt: number): void {
  if (tnz.remoteDo.has(opt)) return;

  if (opt === TELNET.OPT_TN3270E) {
    tnz.remoteDo.add(opt);
    tnz.remoteDont.delete(opt);
    sendWill(tnz, opt);
  } else if (opt === TELNET.OPT_BINARY) {
    tnz.remoteDo.add(opt);
    tnz.remoteDont.delete(opt);
    tnz.binaryLocal = true;
    sendWill(tnz, opt);
  } else if (opt === TELNET.OPT_EOR) {
    tnz.remoteDo.add(opt);
    tnz.remoteDont.delete(opt);
    (tnz as any)._eor = true;
    sendWill(tnz, opt);
  } else if (opt === TELNET.OPT_TERMINAL_TYPE) {
    tnz.remoteDo.add(opt);
    tnz.remoteDont.delete(opt);
    sendWill(tnz, opt);
  } else {
    tnz.remoteDont.add(opt);
    sendWont(tnz, opt);
  }
}

export function _processDont(tnz: Tnz, opt: number): void {
  if (tnz.remoteDont.has(opt)) return;

  tnz.remoteDont.add(opt);
  tnz.remoteDo.delete(opt);

  if (opt === TELNET.OPT_BINARY) {
    tnz.binaryLocal = false;
  } else if (opt === TELNET.OPT_EOR) {
    (tnz as any)._eor = false;
  }
  sendWont(tnz, opt);
}

export function _processSb(tnz: Tnz, data: Buffer): void {
  const opt = data[0];

  if (opt === TELNET.OPT_TERMINAL_TYPE && data[1] === TELNET.TERMINAL_TYPE_SEND) {
    const termType = Buffer.from(tnz.terminalType, 'ascii');
    const sb = Buffer.concat([
      Buffer.from([TELNET.IAC, TELNET.SB, TELNET.OPT_TERMINAL_TYPE, TELNET.TERMINAL_TYPE_IS]),
      termType,
      Buffer.from([TELNET.IAC, TELNET.SE])
    ]);
    (tnz as any)._sendBuf.push(sb);
    send(tnz);
  } else if (opt === TELNET.OPT_TN3270E) {
    _processTn3270e(tnz, data.subarray(1));
  }
}

export function _processTn3270e(tnz: Tnz, data: Buffer): void {
  const tn3270eOp = data[0];

  if (tn3270eOp === TELNET.TN3270E_SEND) {
    const reqType = data[1];
    if (reqType === TELNET.TN3270E_DEVICE_TYPE) {
      let sb = Buffer.from([TELNET.IAC, TELNET.SB, TELNET.OPT_TN3270E, TELNET.TN3270E_DEVICE_TYPE, TELNET.TN3270E_REQUEST]);
      sb = Buffer.concat([sb, Buffer.from(tnz.terminalType, 'ascii')]);
      
      if (tnz.luName) {
        sb = Buffer.concat([sb, Buffer.from([1]), Buffer.from(tnz.luName, 'ascii')]);
      }
      
      sb = Buffer.concat([sb, Buffer.from([TELNET.IAC, TELNET.SE])]);
      (tnz as any)._sendBuf.push(sb);
      send(tnz);
    }
  } else if (tn3270eOp === TELNET.TN3270E_DEVICE_TYPE) {
    const isIsOrReject = data[1];
    if (isIsOrReject === TELNET.TN3270E_IS) {
      tnz._tn3270e = true;
      const sb = Buffer.from([
        TELNET.IAC, TELNET.SB, TELNET.OPT_TN3270E, TELNET.TN3270E_FUNCTIONS, TELNET.TN3270E_REQUEST,
        TELNET.TN3270E_RESPONSES,
        0x04,
        TELNET.IAC, TELNET.SE
      ]);
      (tnz as any)._sendBuf.push(sb);
      send(tnz);
    } else {
      tnz._tn3270e = false;
    }
  } else if (tn3270eOp === TELNET.TN3270E_FUNCTIONS) {
    const isRequestOrIs = data[1];
    if (isRequestOrIs === TELNET.TN3270E_IS) {
      tnz.tn3270eNegotiated = true;
    }
  }
}

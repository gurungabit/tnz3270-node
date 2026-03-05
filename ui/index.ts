import { Tnz } from '../src/core/tnz';
import { Session } from './session';
// @ts-ignore
import indexHtml from './index.html';

// Color map
const colorMap: Record<number, string> = {
  0xf1: '34', 0xf2: '31', 0xf3: '35', 0xf4: '32',
  0xf5: '36', 0xf6: '33', 0xf7: '37', 0xf8: '90',
  0xf9: '94', 0xfa: '33', 0xfb: '95', 0xfc: '92',
  0xfd: '96', 0xfe: '37', 0xff: '97',
};

const MIN_FIELD_UNDERLINE = 6;

function renderAnsiScreen(tnz: Tnz): string {
  let out = '\x1B[H';
  const fullText = tnz.scrstr(0, 0, false);
  const bufSize = tnz.bufferSize;

  // Pre-compute underline mask: for each unprotected field, underline
  // from field start to lastNonSpace+1 (minimum MIN_FIELD_UNDERLINE chars)
  const underline = new Uint8Array(bufSize);
  for (const [faddr, fattr] of tnz.fields()) {
    const isProtected = (fattr & 0x20) !== 0;
    const isHidden = (fattr & 0x0c) === 0x0c;
    if (isProtected || isHidden) continue;

    const dataStart = (faddr + 1) % bufSize;
    const [nextFa] = tnz.nextField(dataStart);
    const dataEnd = nextFa >= 0 ? nextFa : dataStart;

    // Compute field length
    const fieldLen = dataEnd >= dataStart
      ? dataEnd - dataStart
      : bufSize - dataStart + dataEnd;
    if (fieldLen === 0) continue;

    // Find last non-space position in field
    let lastContent = -1;
    for (let j = 0; j < fieldLen; j++) {
      const pos = (dataStart + j) % bufSize;
      if (fullText[pos] !== ' ') lastContent = j;
    }

    const underlineEnd = Math.min(
      Math.max(lastContent + 2, MIN_FIELD_UNDERLINE),
      fieldLen
    );
    for (let j = 0; j < underlineEnd; j++) {
      underline[(dataStart + j) % bufSize] = 1;
    }
  }

  for (let i = 0; i < bufSize; i++) {
    if (i > 0 && i % tnz.maxCol === 0) out += '\x1B[0m\r\n';

    const isFa = tnz.planeFa[i] !== 0;
    const [_, fattr] = tnz._field(i);
    const isHidden = (fattr & 0x0c) === 0x0c;
    const isIntensified = (fattr & 0x08) === 0x08 && !isHidden;

    let char = isFa ? ' ' : fullText[i];
    if (isHidden) {
      // Show asterisks for non-empty hidden field positions (e.g. password)
      const dc = tnz.planeDc[i];
      char = (!isFa && dc !== 0 && dc !== 0x40) ? '*' : ' ';
    }

    const fg = tnz.planeFg[i];
    const eh = tnz.planeEh[i];

    let codes = [];
    if (isIntensified) codes.push('1');
    if (fg && colorMap[fg]) {
      codes.push(colorMap[fg]);
    } else {
      // Base color model: derive from field attributes
      const isProtectedField = (fattr & 0x20) !== 0;
      if (isProtectedField) {
        codes.push(isIntensified ? '97' : '94'); // white or bright blue
      } else {
        codes.push(isIntensified ? '97' : '36'); // white or cyan
      }
    }

    if (eh === 0xf1) codes.push('5');
    if (eh === 0xf2) codes.push('7');
    if (underline[i]) codes.push('4');
    else if (eh === 0xf4 && char !== ' ') codes.push('4');

    const format = `\x1B[0;${codes.join(';')}m`;
    out += `${format}${char}`;
  }
  out += '\x1B[0m';

  const curRow = Math.floor(tnz.curadd / tnz.maxCol) + 1;
  const curCol = (tnz.curadd % tnz.maxCol) + 1;
  out += `\x1B[${curRow};${curCol}H`;

  return out;
}

const connections = new Map<string, Tnz>();

/** Whitelist of Tnz methods callable via the WebSocket 'key' action. */
const ALLOWED_KEYS = new Set([
  'enter', 'clear', 'attn',
  'keyCurUp', 'keyCurDown', 'keyCurLeft', 'keyCurRight',
  'keyTab', 'keyBacktab', 'keyHome', 'keyEnd',
  'keyBackspace', 'keyDelete',
  'pf1', 'pf2', 'pf3', 'pf4', 'pf5', 'pf6',
  'pf7', 'pf8', 'pf9', 'pf10', 'pf11', 'pf12',
  'pf13', 'pf14', 'pf15', 'pf16', 'pf17', 'pf18',
  'pf19', 'pf20', 'pf21', 'pf22', 'pf23', 'pf24',
  'pa1', 'pa2', 'pa3',
]);

/** Safe WebSocket send — silently drops if socket is closed. */
function wsSend(ws: { send(data: string): void; readyState: number }, data: string): void {
  try {
    if (ws.readyState === 1) ws.send(data);
  } catch {
    // socket already closed — ignore
  }
}

Bun.serve<number>({
  port: 3000,
  development: {
    hmr: true,
    console: true,
  },
  routes: {
    '/': indexHtml,
  },
  websocket: {
    open(ws) {
      console.log('WS Client connected');
    },
    async message(ws, message) {
      try {
        const payload = JSON.parse(String(message));
        const sessionId = ws.remoteAddress + ':' + ws.data;
        let tnz = connections.get(sessionId);

        const updateScreen = () => {
          if (!tnz) return;
          wsSend(ws, JSON.stringify({ type: 'screen', data: renderAnsiScreen(tnz) }));
          wsSend(ws, JSON.stringify({
            type: 'status',
            locked: tnz.pwait || tnz.systemLockWait,
            cursor: tnz.curadd,
            rows: tnz.maxRow,
            cols: tnz.maxCol
          }));
        };

        if (payload.action === 'connect') {
          if (tnz) tnz.shutdown();
          
          tnz = new Tnz('WEB', {
            terminalType: 'IBM-3278-4-E',
            useTn3270e: true,
            amaxRow: 43,
            onScreenUpdate: updateScreen
          });
          
          tnz.on('close', () => {
            wsSend(ws, JSON.stringify({ type: 'disconnected' }));
            connections.delete(sessionId);
          });

          connections.set(sessionId, tnz);
          await tnz.connect(payload.host, payload.port || 3270, { secure: payload.secure, verifyCert: payload.verifyCert });
          wsSend(ws, JSON.stringify({ type: 'connected' }));
          updateScreen();
          return;
        }

        if (payload.action === 'disconnect') {
          if (tnz) {
            try { tnz.shutdown(); } catch {}
            connections.delete(sessionId);
          }
          wsSend(ws, JSON.stringify({ type: 'disconnected' }));
          return;
        }

        if (!tnz) return;

        if (payload.action === 'setCursor') {
          if (tnz.pwait || tnz.systemLockWait) return;
          try {
            tnz.setCursorPosition(payload.row, payload.col);
            updateScreen();
          } catch (e) {
            // ignore out of bounds
          }
          return;
        }

        if (payload.action === 'runLogin') {
          if (!tnz) {
            wsSend(ws, JSON.stringify({ type: 'error', message: 'Not connected' }));
            return;
          }

          const log = (msg: string) => wsSend(ws, JSON.stringify({ type: 'loginLog', message: msg }));
          const s = new Session(tnz);
          tnz.onScreenUpdate = updateScreen;

          (async () => {
            try {
              log('Waiting for initial screen...');
              await s.waitFor(() => s.hasText('Hercules Version') || s.hasText('Logon ===>'), 5);
              updateScreen();

              if (s.hasText('Hercules Version')) {
                log('Clearing Hercules splash...');
                await s.enter();
                await s.waitForTextGone('Hercules Version', 30);
                updateScreen();
              }

              log('Waiting for Logon prompt...');
              await s.waitForText('Logon ===>', 30);
              updateScreen();

              log('Logging in as HERC01...');
              await s.clear();
              await s.waitForKeyboard(2);
              await s.enter('L HERC01');

              await s.waitForText('PASSWORD');
              updateScreen();

              log('Entering password...');
              await s.enter('CUL8TR');

              await s.waitForText('Welcome to the TSO system');
              updateScreen();

              log('Clearing welcome prompts...');
              await s.enter();
              await s.waitForText('***', 5);
              await s.enter();

              await s.waitForText('Option ===>');
              updateScreen();
              log('Login complete - at ISPF Main Menu');

              log('Logging out...');
              await s.enter('X');
              await s.waitForText('READY');
              updateScreen();

              await s.enter('LOGOFF');
              await s.waitForText('Logon ===>');
              updateScreen();

              log('SUCCESS: Login/logout cycle complete');
              wsSend(ws, JSON.stringify({ type: 'loginDone', success: true }));
            } catch (err) {
              log('FAILED: ' + String(err));
              updateScreen();
              wsSend(ws, JSON.stringify({ type: 'loginDone', success: false, error: String(err) }));
            }
          })();
          return;
        }

        if (payload.action === 'key') {
          if (payload.val === 'reset') {
             tnz.systemLockWait = false;
             tnz.pwait = false;
             updateScreen();
             return;
          }
          if (tnz.pwait || tnz.systemLockWait) return;
          
          if (ALLOWED_KEYS.has(payload.val)) {
            const method = tnz[payload.val as keyof Tnz];
            if (typeof method === 'function') {
              (method as () => void).call(tnz);
            }
            updateScreen();
          }
        } else if (payload.action === 'type') {
          if (tnz.pwait || tnz.systemLockWait) return;
          tnz.keyData(payload.text);
          updateScreen();
        }
      } catch (e) {
        wsSend(ws, JSON.stringify({ type: 'error', message: String(e) }));
      }
    },
    close(ws) {
      console.log('WS Client disconnected');
      const sessionId = ws.remoteAddress + ':' + ws.data;
      const tnz = connections.get(sessionId);
      if (tnz) {
        tnz.shutdown();
        connections.delete(sessionId);
      }
    }
  },
  fetch(req, server) {
    if (server.upgrade(req, { data: Date.now() })) {
      return; // upgraded
    }
    return new Response('Not found', { status: 404 });
  }
});
console.log('Server running on http://localhost:3000');

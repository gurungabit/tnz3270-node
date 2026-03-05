import { Tnz } from '../src/core/tnz';
import { Ati } from '../src/automation/ati';
// @ts-ignore
import indexHtml from './index.html';

// Color map
const colorMap: Record<number, string> = {
  0xf1: '34', 0xf2: '31', 0xf3: '35', 0xf4: '32',
  0xf5: '36', 0xf6: '33', 0xf7: '37', 0xf8: '90',
  0xf9: '94', 0xfa: '33', 0xfb: '95', 0xfc: '92',
  0xfd: '96', 0xfe: '37', 0xff: '97',
};

function renderAnsiScreen(tnz: Tnz): string {
  let out = '\x1B[H';
  const fullText = tnz.scrstr(0, 0, false);
  
  for (let i = 0; i < tnz.bufferSize; i++) {
    if (i > 0 && i % tnz.maxCol === 0) out += '\x1B[0m\r\n';

    const isFa = tnz.planeFa[i] !== 0;
    const [_, fattr] = tnz._field(i);
    const isHidden = (fattr & 0x0c) === 0x0c;
    const isIntensified = (fattr & 0x08) === 0x08 && !isHidden;
    
    let char = isFa ? ' ' : fullText[i];
    if (isHidden) char = ' ';
    
    const fg = tnz.planeFg[i];
    const eh = tnz.planeEh[i];
    
    let codes = [];
    if (isIntensified) codes.push('1');
    if (fg && colorMap[fg]) codes.push(colorMap[fg]);
    else if (isIntensified) codes.push('97');
    else codes.push('32');
    
    const isProtected = (fattr & 0x20) !== 0;
    if (eh === 0xf1) codes.push('5');
    if (eh === 0xf2) codes.push('7');
    if (eh === 0xf4 && (char !== ' ' || !isProtected)) codes.push('4');
    
    const format = codes.length > 0 ? `\x1B[${codes.join(';')}m` : '\x1B[0m';
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
          const ati = new Ati();
          ati.registerSession('WEB', tnz);

          // Restore the onScreenUpdate so the UI keeps refreshing
          const origUpdate = updateScreen;
          tnz.onScreenUpdate = origUpdate;

          (async () => {
            try {
              log('Waiting for initial screen...');
              await ati.wait(5, () => ati.scrhas('Hercules Version') || ati.scrhas('Logon ===>'));
              origUpdate();

              if (ati.scrhas('Hercules Version')) {
                log('Clearing Hercules splash...');
                await ati.send('[enter]');
                await ati.wait(30, () => !ati.scrhas('Hercules Version'));
                origUpdate();
              }

              log('Waiting for Logon prompt...');
              let rc = await ati.wait(30, () => ati.scrhas('Logon ===>'));
              if (rc === 0) throw new Error('Timeout waiting for Logon prompt');
              origUpdate();

              log('Logging in as HERC01...');
              await ati.send('[clear]');
              await ati.wait(2, () => !ati.keyLock);
              await ati.send('L HERC01[enter]');

              rc = await ati.wait(10, () => ati.scrhas('PASSWORD'));
              if (rc === 0) throw new Error('Timeout waiting for password prompt');
              origUpdate();

              log('Entering password...');
              await ati.send('CUL8TR[enter]');

              rc = await ati.wait(10, () => ati.scrhas('Welcome to the TSO system'));
              if (rc === 0) throw new Error('Timeout waiting for Welcome banner');
              origUpdate();

              log('Clearing welcome prompts...');
              await ati.send('[enter]');
              await ati.wait(5, () => ati.scrhas('***'));
              await ati.send('[enter]');

              rc = await ati.wait(10, () => ati.scrhas('Option ===>'));
              if (rc === 0) throw new Error('Timeout waiting for ISPF menu');
              origUpdate();
              log('Login complete - at ISPF Main Menu');

              log('Logging out...');
              await ati.send('X[enter]');
              await ati.wait(10, () => ati.scrhas('READY'));
              origUpdate();

              await ati.send('LOGOFF[enter]');
              await ati.wait(10, () => ati.scrhas('Logon ===>'));
              origUpdate();

              log('SUCCESS: Login/logout cycle complete');
              wsSend(ws, JSON.stringify({ type: 'loginDone', success: true }));
            } catch (err) {
              log('FAILED: ' + String(err));
              origUpdate();
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

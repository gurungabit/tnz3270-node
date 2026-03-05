import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';
import './index.css';

function App() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  const [connected, setConnected] = useState(false);
  const [locked, setLocked] = useState(false);
  
  // Refs to allow the xterm callback closure to read current state
  const stateRef = useRef({ connected: false, locked: false, rows: 43, cols: 80 });
  
  const [cursorPos, setCursorPos] = useState({ row: 1, col: 1 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('3270');
  const [ssl, setSsl] = useState(false);
  const [verifyCert, setVerifyCert] = useState(true);
  const [loginRunning, setLoginRunning] = useState(false);
  const [loginLogs, setLoginLogs] = useState<string[]>([]);

  useEffect(() => {
    // Initialize xterm
    const term = new Terminal({
      rows: 43,
      cols: 80,
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 14,
      lineHeight: 1,
      letterSpacing: 0,
      fontWeight: 500,
      theme: {
        background: '#000000',
        foreground: '#4af626', // Retro green
        cursor: '#4af626',
        selectionBackground: 'rgba(74, 246, 38, 0.3)',
      },
      allowProposedApi: true,
      scrollback: 0,
    });

    if (terminalRef.current) {
      term.open(terminalRef.current);
    }
    
    xtermRef.current = term;

    const showOfflineMessage = (msg: string) => {
      term.write('\x1b[2J\x1b[H'); // Clear screen
      const y = 20;
      const x = Math.max(1, Math.floor((80 - msg.length) / 2));
      term.write(`\x1b[${y};${x}H\x1b[1m${msg}\x1b[0m`);
    };

    // Connect WebSocket
    const connectWs = () => {
      const wsUrl = `ws://${window.location.host}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsReconnecting(false);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') {
          setConnected(true);
          stateRef.current.connected = true;
          term.focus();
          term.options.cursorBlink = true;
      } else if (msg.type === 'disconnected') {
        setConnected(false);
        stateRef.current.connected = false;
        setLocked(false);
        stateRef.current.locked = false;
        showOfflineMessage("CLICK CONNECT TO START SESSION");
        term.options.cursorBlink = false;
        setCursorPos({ row: 1, col: 1 });
      } else if (msg.type === 'screen') {
          // We write the ansi directly to the terminal
          term.write(msg.data);
      } else if (msg.type === 'status') {
        setLocked(msg.locked);
        stateRef.current.locked = msg.locked;
        if (msg.rows) stateRef.current.rows = msg.rows;
        if (msg.cols) stateRef.current.cols = msg.cols;
        
        const cols = msg.cols || stateRef.current.cols || 80;
        const cursor = typeof msg.cursor === 'number' ? msg.cursor : 0;
        const cRow = Math.floor(cursor / cols) + 1;
        const cCol = (cursor % cols) + 1;
        setCursorPos({ row: cRow, col: cCol });
        } else if (msg.type === 'loginLog') {
          setLoginLogs(prev => [...prev, msg.message]);
        } else if (msg.type === 'loginDone') {
          setLoginRunning(false);
          setLoginLogs(prev => [...prev, msg.success ? 'Done.' : 'Failed: ' + msg.error]);
        } else if (msg.type === 'error') {
          setErrorMsg(msg.message);
          setTimeout(() => setErrorMsg(null), 5000);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        stateRef.current.connected = false;
        setLocked(false);
        stateRef.current.locked = false;
        term.options.cursorBlink = false;
        setCursorPos({ row: 1, col: 1 });
        
        // Auto-reconnect after 2 seconds
        setIsReconnecting(true);
        showOfflineMessage("RECONNECTING...");
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.CLOSED) {
            connectWs();
          }
        }, 2000);
      };
    };

    showOfflineMessage("CLICK CONNECT TO START SESSION");
    connectWs();

    const sendWs = (data: unknown) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(data));
      }
    };

    // Handle user typing
    term.onKey(({ key, domEvent }) => {
      if (!stateRef.current.connected) return;

      const ev = domEvent as KeyboardEvent;

      // Stop browser default for specific keys
      if (ev.key === 'Tab' || ev.key === 'Backspace' || ev.key === 'Enter'
        || ev.key.startsWith('Arrow') || ev.key.startsWith('F')) {
        ev.preventDefault();
      }

      // Ctrl+V paste — let it through to the paste handler
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'v') {
        return;
      }

      // Allow reset even when locked (Ctrl+R or Escape while locked)
      if (ev.ctrlKey && ev.key === 'r') {
        sendWs({ action: 'key', val: 'reset' });
        return;
      }

      // Block everything else while locked
      if (stateRef.current.locked) return;

      let action = 'key';
      let val = '';

      // F-keys → PF keys
      const fMatch = ev.key.match(/^F(\d+)$/);
      if (fMatch) {
        const n = parseInt(fMatch[1]!, 10);
        if (n >= 1 && n <= 24) {
          val = `pf${n}`;
        }
      } else {
        switch (ev.key) {
          case 'Enter': val = 'enter'; break;
          case 'ArrowUp': val = 'keyCurUp'; break;
          case 'ArrowDown': val = 'keyCurDown'; break;
          case 'ArrowLeft': val = 'keyCurLeft'; break;
          case 'ArrowRight': val = 'keyCurRight'; break;
          case 'Tab': val = ev.shiftKey ? 'keyBacktab' : 'keyTab'; break;
          case 'Backspace': val = 'keyBackspace'; break;
          case 'Delete': val = 'keyDelete'; break;
          case 'Home': val = 'keyHome'; break;
          case 'End': val = 'keyEnd'; break;
          case 'Escape': val = 'clear'; break;
          default:
            if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
              action = 'type';
              val = ev.key;
            }
            break;
        }
      }

      if (val) {
        if (action === 'type') {
          sendWs({ action: 'type', text: val });
        } else {
          sendWs({ action: 'key', val });
        }
      }
    });

    // Handle paste
    const handlePaste = (e: ClipboardEvent) => {
      if (!stateRef.current.connected || stateRef.current.locked) return;
      const text = e.clipboardData?.getData('text');
      if (text) {
        sendWs({ action: 'type', text });
      }
    };
    document.addEventListener('paste', handlePaste);

    const handleMouse = (e: MouseEvent) => {
      if (!stateRef.current.connected || stateRef.current.locked) return;

      const screen = terminalRef.current?.querySelector('.xterm-screen');
      if (!screen) return;

      const rect = screen.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;

      // Use xterm's fixed grid size (always 43x80) for pixel mapping,
      // not the 3270 session's rows which may still be 24 initially
      const cellWidth = rect.width / term.cols;
      const cellHeight = rect.height / term.rows;

      const col = Math.min(Math.floor(x / cellWidth) + 1, stateRef.current.cols);
      const row = Math.min(Math.floor(y / cellHeight) + 1, stateRef.current.rows);

      sendWs({ action: 'setCursor', row, col });
    };

    setTimeout(() => {
      if (term.element) {
        term.element.addEventListener('mousedown', handleMouse);
      }
    }, 100);

    return () => {
      document.removeEventListener('paste', handlePaste);
      if (term.element) {
        term.element.removeEventListener('mousedown', handleMouse);
      }
      wsRef.current?.close();
      term.dispose();
    };

  }, []);

  const handleConnect = () => {
    if (connected) {
      wsRef.current?.send(JSON.stringify({ action: 'disconnect' }));
    } else {
      wsRef.current?.send(JSON.stringify({ action: 'connect', host, port: parseInt(port), secure: ssl, verifyCert }));
    }
  };

  const handleRunLogin = () => {
    if (!connected || loginRunning) return;
    setLoginLogs([]);
    setLoginRunning(true);
    wsRef.current?.send(JSON.stringify({ action: 'runLogin' }));
  };

  const sendKey = (val: string) => {
    wsRef.current?.send(JSON.stringify({ action: 'key', val }));
    xtermRef.current?.focus();
  };

  return (
    <div id="app">
      <header>
        <div className="logo">TNZ-NODE TERMINAL</div>
        <div className="controls">
          <input 
            value={host} 
            onChange={e => setHost(e.target.value)} 
            placeholder="Host"
            disabled={connected}
          />
          <input 
            value={port} 
            onChange={e => setPort(e.target.value)} 
            placeholder="Port" 
            style={{width: '80px'}}
            disabled={connected}
          />
          <label style={{display: 'flex', alignItems: 'center', gap: '6px', color: ssl ? '#4af626' : '#888', fontSize: '0.8rem', cursor: 'pointer'}}>
            <span className="toggle">
              <input type="checkbox" checked={ssl} onChange={e => setSsl(e.target.checked)} disabled={connected} />
              <span className="toggle-track" />
            </span>
            SSL
          </label>
          {ssl && (
            <label style={{display: 'flex', alignItems: 'center', gap: '6px', color: verifyCert ? '#4af626' : '#888', fontSize: '0.8rem', cursor: 'pointer'}}>
              <span className="toggle">
                <input type="checkbox" checked={verifyCert} onChange={e => setVerifyCert(e.target.checked)} disabled={connected} />
                <span className="toggle-track" />
              </span>
              Verify
            </label>
          )}
          <button
            className={connected ? '' : 'primary'}
            onClick={handleConnect}
          >
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </header>
      
      {errorMsg && (
        <div className="error-banner" onClick={() => setErrorMsg(null)}>
          {errorMsg}
        </div>
      )}

      <div className="main-area">
        <div className="terminal-container">
          <div className="terminal-wrapper">
            <div ref={terminalRef} />
          </div>
        </div>

        <div className="sidebar">
          <div className="status-panel">
            <span className={`status-indicator ${isReconnecting ? 'locked' : (!connected ? 'offline' : (locked ? 'locked' : 'ready'))}`}></span>
            {isReconnecting ? 'RECONNECTING...' : ((!connected) ? 'OFFLINE' : (locked ? 'SYSTEM LOCKED' : 'KEYBOARD READY'))}
            <span style={{marginLeft: 'auto', color: '#888'}}>
              R:{String(cursorPos.row).padStart(2, '0')} C:{String(cursorPos.col).padStart(2, '0')}
            </span>
          </div>

          <div className="sidebar-row">
            <div className="sidebar-section">
              <h3>System Actions</h3>
              <div className="macro-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)'}}>
                <button onClick={() => sendKey('enter')} className="primary">Enter</button>
                <button onClick={() => sendKey('clear')}>Clear</button>
                <button onClick={() => sendKey('reset')}>Reset</button>
                <button onClick={() => sendKey('attn')}>SysReq</button>
              </div>
            </div>
            <div className="sidebar-section">
              <h3>Attention (PA)</h3>
              <div className="macro-grid" style={{gridTemplateColumns: 'repeat(3, 1fr)'}}>
                <button onClick={() => sendKey('pa1')}>PA1</button>
                <button onClick={() => sendKey('pa2')}>PA2</button>
                <button onClick={() => sendKey('pa3')}>PA3</button>
              </div>
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Automation</h3>
            <button
              className="primary"
              style={{width: '100%', padding: '8px', fontSize: '13px'}}
              onClick={handleRunLogin}
              disabled={!connected || loginRunning}
            >
              {loginRunning ? 'Running...' : 'Run Login'}
            </button>
            {loginLogs.length > 0 && (
              <div style={{
                marginTop: '8px',
                padding: '6px 8px',
                background: '#111',
                border: '1px solid #333',
                borderRadius: '4px',
                fontSize: '11px',
                fontFamily: 'monospace',
                maxHeight: '120px',
                overflowY: 'auto',
                color: '#4af626',
              }}>
                {loginLogs.map((log, i) => (
                  <div key={i}>{log}</div>
                ))}
              </div>
            )}
          </div>

          <div className="sidebar-section">
            <h3>Program Function (PF)</h3>
            <div className="macro-grid" style={{gridTemplateColumns: 'repeat(8, 1fr)'}}>
              {Array.from({length: 24}).map((_, i) => (
                <button key={i} onClick={() => sendKey(`pf${i+1}`)}>F{i+1}</button>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Keyboard Shortcuts</h3>
            <div className="kbd-hints" style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px'}}>
              <span><kbd>Enter</kbd> Submit</span>
              <span><kbd>Esc</kbd> Clear</span>
              <span><kbd>Tab</kbd> Next Fld</span>
              <span><kbd>S+Tab</kbd> Prev Fld</span>
              <span><kbd>F1-F12</kbd> PF Keys</span>
              <span><kbd>^R</kbd> Reset</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

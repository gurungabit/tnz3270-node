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

  useEffect(() => {
    // Initialize xterm
    const term = new Terminal({
      rows: 43,
      cols: 80,
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 14,
      lineHeight: 1.05,
      letterSpacing: 0,
      fontWeight: 500,
      theme: {
        background: '#000000',
        foreground: '#4af626',
        cursor: '#4af626',
      },
      cursorBlink: false, cursorStyle: "block", cursorWidth: 2,
      scrollback: 0,
      allowProposedApi: true
    });

    if (terminalRef.current) {
      term.open(terminalRef.current);
    }
    
    xtermRef.current = term;

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
        term.write('\x1b[2J\x1b[H');
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
        term.write('\x1b[2J\x1b[H');
        term.options.cursorBlink = false;
        setCursorPos({ row: 1, col: 1 });
        
        // Auto-reconnect after 2 seconds
        setIsReconnecting(true);
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.CLOSED) {
            connectWs();
          }
        }, 2000);
      };
    };

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

    
    const handleMouse = (e: MouseEvent) => {
      if (!stateRef.current.connected || stateRef.current.locked) return;
      
      const screen = terminalRef.current?.querySelector('.xterm-screen');
      if (!screen) return;
      
      const rect = screen.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      
      const col = Math.floor((x / rect.width) * stateRef.current.cols) + 1;
      const row = Math.floor((y / rect.height) * stateRef.current.rows) + 1;
      
      sendWs({ action: 'setCursor', row, col });
    };

    setTimeout(() => {
      if (term.element) {
        term.element.addEventListener('mousedown', handleMouse);
      }
    }, 100);

    return () => {
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
      wsRef.current?.send(JSON.stringify({ action: 'connect', host, port: parseInt(port) }));
    }
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

          <div>
            <h3>Actions</h3>
            <div className="macro-grid" style={{gridTemplateColumns: 'repeat(4, 1fr)'}}>
              <button onClick={() => sendKey('enter')} className="primary">Enter</button>
              <button onClick={() => sendKey('clear')}>Clear</button>
              <button onClick={() => sendKey('reset')}>Reset Lock</button>
              <button onClick={() => sendKey('attn')}>Sys Req</button>
            </div>
          </div>

          <div>
            <h3>Program Function (PF)</h3>
            <div className="macro-grid" style={{gridTemplateColumns: 'repeat(6, 1fr)'}}>
              {Array.from({length: 24}).map((_, i) => (
                <button key={i} onClick={() => sendKey(`pf${i+1}`)}>PF{i+1}</button>
              ))}
            </div>
          </div>

          <div>
            <h3>Program Attention (PA)</h3>
            <div className="macro-grid" style={{gridTemplateColumns: 'repeat(3, 1fr)'}}>
              <button onClick={() => sendKey('pa1')}>PA1</button>
              <button onClick={() => sendKey('pa2')}>PA2</button>
              <button onClick={() => sendKey('pa3')}>PA3</button>
            </div>
          </div>

          <div>
            <h3>Keyboard Shortcuts</h3>
            <div className="kbd-hints" style={{flexDirection: 'row', flexWrap: 'wrap', gap: '10px 16px'}}>
              <span><kbd>Enter</kbd> Submit</span>
              <span><kbd>Esc</kbd> Clear</span>
              <span><kbd>Tab</kbd> Next Field</span>
              <span><kbd>S+Tab</kbd> Prev Field</span>
              <span><kbd>F1-F12</kbd> PF Keys</span>
              <span><kbd>^R</kbd> Reset Lock</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

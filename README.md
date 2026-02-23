# TNZ-Node

TNZ-Node is a zero-dependency, highly performant TypeScript library. It provides a complete TN3270 data stream parser, protocol negotiator, and screen buffer manager for interacting with IBM Mainframes (z/OS, MVS, TK4-).

It includes a powerful automation layer (`Ati`) for headless scripting, screen scraping, and concurrent mainframe interactions, as well as native support for `IND$FILE` (DDM) file transfers.

## Features

- **Full 3270 Protocol Implementation**: Complete support for `Write`, `Erase/Write`, `Read Buffer`, `Read Modified`, and `WSF` operations.
- **Native Keyboard Emulation**: Maps complex 3270 keys (`[enter]`, `[pf1]`, `[tab]`, `[clear]`) directly to buffer operations handling MDT and protection boundaries.
- **Enhanced Screen Reading**: `scrstr()` and `scrhas()` implementations with full character-set awareness (EBCDIC/ASCII/GE), control character translation, and password field cloaking.
- **ATI Automation Engine**: A robust, event-driven scripting layer allowing you to safely type, wait for screen conditions, and trigger conditional actions (`when`).
- **Concurrent Execution**: The socket logic is entirely event-driven, allowing you to spawn hundreds of mainframe bots simultaneously without blocking the Node.js event loop.
- **File Transfers**: Natively implements the DDM `IND$FILE` protocol, allowing file uploads and downloads between your local machine and the host.
- **Zero Runtime Dependencies**: The entire library is built strictly on Node.js built-ins (`net`, `tls`, `events`).

## Installation

```bash
bun install
```

## Quick Start

The easiest way to interact with the mainframe programmatically is through the `Ati` automation wrapper.

```typescript
import { Ati } from 'tnz-node';

async function main() {
  const ati = new Ati();

  console.log('Connecting...');
  await ati.connectSession('MVS_SESSION', {
    host: '127.0.0.1',
    port: 3270,
    useTn3270e: true,
  });

  // Wait for the Logon prompt to appear on the screen
  await ati.wait(10, () => ati.scrhas('Logon ===>'));

  // Clear the screen and type the TSO logon command
  await ati.send('[clear]');
  await ati.wait(2, () => ati.keyLock === false);
  await ati.send('L HERC01[enter]');

  // Wait for the password prompt
  await ati.wait(10, () => ati.scrhas('PASSWORD'));

  // Enter the password
  await ati.send('CUL8TR[enter]');

  // Wait for TSO READY
  await ati.wait(10, () => ati.scrhas('READY'));

  // Print the screen buffer to the console
  const tnz = ati.getTnz();
  console.log(tnz.scrstr(0, 0, true));

  console.log('Logged in successfully!');
  ati.dropSession();
}

main().catch(console.error);
```

### IND$FILE File Transfers

```typescript
// Download a remote dataset to your local machine
await ati.getFile('sys1.proclib(test) ascii crlf', './local-file.txt');

// Upload a local file to the mainframe
await ati.putFile('./local-file.txt', 'herc01.my.dataset ascii crlf');
```

## Development & Testing

```bash
# Start development mode
bun run dev

# Build for production
bun run build

# Run unit tests (289 tests covering 3270 binary protocols)
bun run test

# Run automation integration test against a local TK4- instance
bun run test-login.ts
bun run test-stress.ts
bun run test-concurrency.ts
```

## Project Structure

The codebase was refactored from a monolithic implementation into focused sub-modules under `src/core/`:
- `parser.ts`: Binary 3270 Data Stream unwrapper and processor.
- `buffer.ts`: Circular EBCDIC screen grid manipulations.
- `keyboard.ts`: Key-to-AID event dispatching and cursor routing.
- `screen.ts`: Screen scraping and text extraction logic.
- `connection.ts`: Telnet TCP/TLS negotiation and transport streams.

## License

MIT

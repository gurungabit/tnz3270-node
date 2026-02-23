# Architecture Notes

This document provides a high-level overview of the `tnz-node` architecture to help new contributors understand the codebase.

## Directory Structure

The codebase is organized as follows:

```text
src/
  index.ts                  # Public API re-exports
  types.ts                  # Constants (AID, ORDER, TELNET, CMD, FA, etc.) + interfaces
  core/
    tnz.ts                  # Tnz class: primary state holder, extends EventEmitter
    parser.ts               # Binary 3270 Data Stream unwrapper and processor
    buffer.ts               # Circular EBCDIC screen grid manipulations
    keyboard.ts             # Key-to-AID event dispatching and cursor routing
    screen.ts               # Screen scraping and text extraction logic
    connection.ts           # Telnet TCP/TLS negotiation and transport streams
    telnet.ts               # Stateless telnet negotiation helper functions
  automation/
    ati.ts                  # Ati class: sessions, variables, send, wait, when
    file-transfer.ts        # DDM/IND$FILE upload/download event listeners
  utils/
    codepage.ts             # EBCDIC encode/decode (cp037, cp1047, cp310 built-in)
    session-utils.ts        # Screen size calculations (HOD sizes, 14-bit limit)
    logger.ts               # Logging (trace, logdest, rotation)
```

## Core Design Principles

### The `Tnz` State Container

`Tnz` acts as a unified public API and state container. To prevent it from becoming a massive "God Object", its internal logic is broken down via delegation into sub-modules (`parser`, `buffer`, `keyboard`, `screen`, and `connection`). 

These sub-modules export **stateless pure functions** that take `tnz: Tnz` as their first argument. This allows the logic to be organized logically in separate files while maintaining a single source of truth for the terminal state.

### Event-Driven File Transfers

The File Transfer system (`IND$FILE`) uses an event-driven architecture.

When the `Tnz` connection parser encounters a file-transfer structured field in the data stream, it emits a `ddm` event. The `FileTransfer` manager listens for these events and acts on them asynchronously. This prevents file transfers from blocking the main socket read loop.

### Zero Runtime Dependencies

The library is built strictly on Node.js built-ins (`net`, `tls`, `events`). It does not rely on any third-party npm packages at runtime. EBCDIC-to-ASCII translation is handled by built-in lookup tables in `src/utils/codepage.ts`.

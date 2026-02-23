# AGENTS.md

This document provides guidelines for agents working in this repository.

## Project Overview

TypeScript library for IBM mainframe TN3270 terminal automation.
Zero runtime dependencies. Uses built-in EBCDIC lookup tables (cp037, cp1047, cp310).

## Commands

### Development

```bash
bun run dev          # Start development mode with watch
bun run build        # Build for production (outputs to ./dist)
bun run typecheck    # Run TypeScript type checking
```

### Testing

```bash
bun run test              # Run all tests
bun run test:watch        # Run tests in watch mode
bun run test <pattern>    # Run tests matching pattern
```

To run a single test file:
```bash
bun run test index.test.ts
```

To run a single test:
```bash
bun run test -- index.test.ts -t "test name"
```

### Linting & Formatting

```bash
bun run lint            # Lint code (uses Oxlint)
bun run format          # Format code (uses Oxfmt)
bun run format:check    # Check if code is formatted
```

### Publishing

```bash
bun run build           # Build before publishing
npm publish             # Publish to npm
```

## Architecture

```
src/
  index.ts                  # Public API re-exports
  types.ts                  # Constants (AID, ORDER, TELNET, CMD, FA, etc.) + interfaces
  core/
    tnz.ts                  # Tnz class: primary state holder, extends EventEmitter
    parser.ts               # Binary 3270 Data Stream unwrapper and processor
    buffer.ts               # Circular EBCDIC screen grid manipulations
    keyboard.ts             # Key-to-AID event dispatching and cursor routing
    screen.ts               # Screen scraping and text extraction logic
    telnet.ts               # Telnet negotiation helpers (stateless functions)
  automation/
    ati.ts                  # Ati class: sessions, variables, send, wait, when
    file-transfer.ts        # DDM/IND$FILE upload/download event listeners
  utils/
    codepage.ts             # EBCDIC encode/decode (cp037, cp1047, cp310 built-in)
    session-utils.ts        # Screen size calculations (HOD sizes, 14-bit limit)
    logger.ts               # Logging (trace, logdest, rotation)
```

Key design: `Tnz` acts as a unified public API and state container. To prevent it from becoming a 3,500+ line God Object, its internal logic is broken down via delegation into `parser`, `buffer`, `keyboard`, `screen`, and `connection`. These sub-modules export stateless pure functions that take `tnz: Tnz` as their first argument. 

The `FileTransfer` system uses an event-driven architecture. `Tnz` emits `ddm` events when it encounters a file-transfer structured field, and `FileTransfer` acts on them asynchronously to avoid blocking the socket read loop.

## Code Style Guidelines

### General

- Use TypeScript with strict mode enabled
- Enable `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- Use ESM modules (package.json has `"type": "module"`)
- Target ES2022, use ESNext modules
- Zero runtime dependencies

### Naming Conventions

- **Variables/Functions**: camelCase (`calculateTotal`, `isValid`)
- **Constants**: SCREAMING_SNAKE_CASE for compile-time constants, camelCase for runtime
- **Classes/Types/Interfaces**: PascalCase (`Tnz`, `CodecEntry`)
- **Files**: kebab-case (`session-utils.ts`, `file-transfer.ts`)
- **Boolean variables**: Use prefixes like `is`, `has`, `should`, `can`

### TypeScript

- Always define return types for exported functions
- Use `interface` for object shapes, `type` for unions/intersections
- Avoid `!` operator unless absolutely necessary
- **Never use `any`**. Use `unknown` and narrow types before use. No exceptions — not even `as any` casts.
- Use plain `number` for buffer addresses (no branded types)
- Use `as const` for constant objects (AID, ORDER, TELNET, etc.)
- Use `/** @internal */` for private properties that need to be accessed by delegated functions.

### Async/Sync Split

Methods that do I/O or block are async. Methods that read memory are sync:
- **Sync**: `scrhas()`, `scrstr()`, `value()`, `extract()`, `numvalue()`
- **Async**: `connect()`, `send()`, `wait()`, `getFile()`, `putFile()`

### Imports

- Group imports: external libraries first, then internal modules
- Use named imports over default imports
- Use relative imports within `src/`

### Error Handling

- Use custom error classes extending `Error`
- Always include meaningful error messages
- Prefer throwing for unexpected errors, return codes for expected failures

### Testing

- Use Vitest with the `describe`/`it` pattern
- Place tests in `/test` directory mirroring source structure
- Use descriptive test names
- Mock external dependencies (network, file system)

### General Practices

- Keep lines under 100 characters when practical
- Comment *why*, not *what*
- No TODO comments - create issues instead
- Remove console.log statements before committing

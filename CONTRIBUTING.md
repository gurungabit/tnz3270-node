# Contributing to tn3270-node

First off, thank you for considering contributing to `tnz-node`! It's people like you that make `tnz-node` such a great tool.

## 1. Where do I go from here?

If you've noticed a bug or have a feature request, make sure to check the [Issues](../../issues) tab to see if someone else in the community has already created a ticket. If not, go ahead and [make one](../../issues/new)!

## 2. Setting up the environment

`tnz-node` uses [Bun](https://bun.sh/) for package management and testing. It has **zero runtime dependencies**, but we use a few tools for development.

1. **Fork** the repo on GitHub
2. **Clone** the project to your own machine
3. **Install dependencies**:
   ```bash
   bun install
   ```

## 3. Development Workflow

We use standard, lightweight tools to ensure code quality.

### Running the App Locally

To start the compiler in watch mode:

```bash
bun run dev
```

### Testing

Tests are written using Vitest. Please ensure they pass before submitting any changes, and write new tests if you implement a new feature.

```bash
bun run test              # Run all tests
bun run test <pattern>    # Run tests matching a specific pattern
bun run test:watch        # Watch mode for tests
```

### Linting & Formatting

We use `oxlint` and `oxfmt` (via `tsdx`) to keep code clean and fast.

```bash
bun run format            # Auto-format code
bun run lint              # Run the linter
bun run typecheck         # Verify TypeScript typings
```

## 4. Pull Requests

When you're ready to submit your changes, please follow these guidelines:

1. **Create a new branch** for your feature or bugfix (`git checkout -b feature/my-awesome-feature`).
2. **Ensure tests pass** locally by running `bun run test`.
3. **Format your code** with `bun run format`.
4. **Push your code** to your fork.
5. **Open a Pull Request** with a clear title and description against the `main` branch.

### Code Style Guidelines

* **Zero runtime dependencies**: This library does not use external dependencies at runtime. Please avoid adding them.
* **TypeScript Strict Mode**: No `any`. Use `unknown` and narrow types where needed.
* **Async/Sync split**: Functions that read from memory/buffers should usually be asynchronous, while functions doing I/O should be `async`.

## 5. Architecture Notes

For a full breakdown of the architecture (how the `Tnz` class delegates to parser, buffer, keyboard, screen, and connection), please see [AGENTS.md](./AGENTS.md) or explore `src/core/`.

---

Thank you for your contributions!

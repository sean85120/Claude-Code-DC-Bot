# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Discord bot for remote-controlling Claude Code from Discord. Uses `@anthropic-ai/claude-agent-sdk` to spawn local Claude Code subprocesses, streaming results into Discord threads in real-time. The bot relies on the local `claude login` session (Max plan) — no API key needed.

All user-facing strings, logs, and comments are in English.

## Commands

```bash
npm install               # Install dependencies
npm run dev               # Run in dev mode (tsx)
npm run build             # Compile TypeScript
npm test                  # Run tests (vitest)
npm run test:watch        # Watch mode
npm test -- src/modules/formatters.test.ts  # Single test file
npm run deploy-commands   # Register Discord slash commands (run once or when commands change)
```

## Architecture

```
src/
├── commands/    # Slash command definitions (prompt, stop, status, history, retry)
├── handlers/    # Orchestration (interaction routing, stream processing, permission bridge, thread follow-ups)
├── modules/     # Pure functions (embed builders, formatters, permissions, tool display)
├── effects/     # Side effects (Discord I/O, Claude SDK bridge, state/rate-limit/usage stores, logger)
├── config.ts    # Env parsing & validation
├── types.ts     # All shared types and constants
└── index.ts     # Entry point
```

**Layer rules:** `modules/` contains pure functions with no side effects. `effects/` handles all I/O (Discord API, Claude SDK, file system). `handlers/` coordinates between modules and effects. `commands/` defines Discord slash command metadata and execution.

### Core Mechanism: Tool Permission Bridge

The `canUseTool` callback (in `permission-handler.ts`) creates a Promise and stores its `resolve` in `StateStore`. The SDK pauses waiting for the result. When the user clicks Approve/Deny in Discord, the button interaction calls `store.resolvePendingApproval()` which invokes the stored `resolve`, unblocking the SDK.

### Session Lifecycle

Sessions are keyed by Discord Thread ID in an in-memory `StateStore`. States: `idle` → `running` → `awaiting_permission` | `waiting_input` → (loop on follow-ups via thread messages). On completion, session stays in `waiting_input` for follow-up questions (resume via `sessionId`). State is lost on restart.

### Streaming

`stream-handler.ts` throttles Discord message updates at 2-second intervals. `stream_event` messages accumulate text; the final `assistant` message replaces the streaming message with complete text. Messages over 2000 chars (Discord limit) are chunked.

## Configuration

- `.env` — Discord credentials and bot settings (see `.env.example`)
- `projects.json` — Whitelist of project paths the bot can operate in (see `projects.example.json`)
- `DISCORD_CLIENT_ID` is only needed for `deploy-commands`, not at runtime

## Testing

Tests use Vitest and are co-located with source files (`*.test.ts`). Tests are excluded from the TypeScript build via `tsconfig.json`. All modules are tested with pure unit tests — no Discord or SDK mocking needed for `modules/`.

## Key Conventions

- ESM-only (`"type": "module"` in package.json); use `.js` extensions in imports even for `.ts` files
- Package manager is npm
- TypeScript strict mode enabled
- All types centralized in `types.ts` — check there before creating new type files
- Discord embed colors and tool emojis are constants in `types.ts` (`COLORS`, `TOOL_EMOJI`)

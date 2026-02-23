# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-platform bot for remote-controlling Claude Code from Discord, Slack, or WhatsApp. Uses `@anthropic-ai/claude-agent-sdk` to spawn local Claude Code subprocesses, streaming results in real-time. The bot relies on the local `claude login` session (Max plan) — no API key needed.

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
├── effects/     # Side effects (Claude SDK bridge, state/rate-limit/usage stores, logger)
├── platforms/   # Platform adapters
│   ├── types.ts            # PlatformAdapter interface, RichMessage, ActionButton, PlatformInteraction
│   ├── discord/adapter.ts  # Discord implementation (discord.js)
│   ├── slack/adapter.ts    # Slack implementation (@slack/bolt, Socket Mode)
│   └── whatsapp/adapter.ts # WhatsApp implementation (whatsapp-web.js)
├── config.ts    # Env parsing & validation
├── types.ts     # All shared types and constants
└── index.ts     # Entry point (multi-platform orchestrator)
```

**Layer rules:** `modules/` contains pure functions with no side effects. `effects/` handles all I/O (Claude SDK, file system). `handlers/` coordinates between modules and effects. `commands/` defines Discord slash command metadata and execution. `platforms/` implements the `PlatformAdapter` interface for each messaging platform.

### Platform Adapter Pattern

All platform I/O goes through the `PlatformAdapter` interface (`platforms/types.ts`). Handlers never import platform-specific libraries directly. Key types:

- `RichMessage` — Platform-agnostic rich content (replaces Discord's `APIEmbed`)
- `ActionButton` — Platform-agnostic button (approve/deny/always-allow)
- `PlatformInteraction` — Unified representation of a command, button click, or message
- `PlatformMessage` — Reference to a sent message (for editing/deleting)

Each adapter converts these to platform-native formats: Discord embeds, Slack Block Kit, WhatsApp formatted text.

### Core Mechanism: Tool Permission Bridge

The `canUseTool` callback (in `permission-handler.ts`) creates a Promise and stores its `resolve` in `StateStore`. The SDK pauses waiting for the result. When the user clicks Approve/Deny (button on Discord/Slack, numbered reply on WhatsApp), the interaction calls `store.resolvePendingApproval()` which invokes the stored `resolve`, unblocking the SDK.

### Session Lifecycle

Sessions are keyed by thread ID in an in-memory `StateStore`. Thread ID formats differ per platform: Discord = channel ID, Slack = `{channelId}:{thread_ts}`, WhatsApp = `wa:{chatId}:{sessionUUID}`. Each session stores a `platform` field for routing.

States: `idle` → `running` → `awaiting_permission` | `waiting_input` → (loop on follow-ups). On completion, session stays in `waiting_input` for follow-up questions (resume via `sessionId`). State is lost on restart.

### Streaming

`stream-handler.ts` throttles message updates at 2-second intervals via the adapter. `stream_event` messages accumulate text; the final `assistant` message replaces the streaming message. Messages are chunked at the platform's `messageLimit` (Discord: 2000, Slack: 4000, WhatsApp: 4096). WhatsApp doesn't support message editing, so streaming sends the final result only.

## Configuration

- `.env` — Platform credentials and bot settings (see `.env.example`)
- `projects.json` — Whitelist of project paths the bot can operate in (see `projects.example.json`)
- `DISCORD_CLIENT_ID` is only needed for `deploy-commands`, not at runtime
- Platform toggles: `DISCORD_ENABLED`, `SLACK_ENABLED`, `WHATSAPP_ENABLED` (at least one required)

## Testing

Tests use Vitest and are co-located with source files (`*.test.ts`). Tests are excluded from the TypeScript build via `tsconfig.json`. All modules are tested with pure unit tests — no platform or SDK mocking needed for `modules/`. Platform converters have their own test files under `platforms/*/converter.test.ts`.

## Key Conventions

- ESM-only (`"type": "module"` in package.json); use `.js` extensions in imports even for `.ts` files
- Package manager is npm
- TypeScript strict mode enabled
- All types centralized in `types.ts` — check there before creating new type files
- Platform-specific types live in `platforms/types.ts`
- Discord embed colors and tool emojis are constants in `types.ts` (`COLORS`, `TOOL_EMOJI`)
- Use `RichMessage` (not `APIEmbed`) when building embeds in handlers/modules; the adapter converts to native format

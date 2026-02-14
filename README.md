# Claude-Code-DC-Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org)

Remotely control [Claude Code](https://docs.anthropic.com/en/docs/claude-code) from your phone, tablet, or any device with Discord. Send prompts, approve tool calls, and track progress — all without being at your computer.

Built on the official [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which spawns a local Claude Code process and streams results into Discord threads in real time.

> **Note:** Tested with Claude Code on the Max plan. API Key authentication should work but is untested and will consume API credits.

## Features

- **Real-time streaming** — Responses update live with throttled Discord edits
- **Thread isolation** — Each `/prompt` creates a dedicated thread; run multiple tasks concurrently
- **Follow-up conversations** — Reply in a thread to continue with full context, including file attachments (images, PDFs, text)
- **Tool approval** — Unapproved operations present Approve/Deny buttons in Discord
- **Interactive Q&A** — `AskUserQuestion` renders as buttons with single-select, multi-select, and free-text input
- **Session management** — `/stop` to abort, `/retry` to re-run, `/history` to export as Markdown
- **Token tracking** — Cumulative token usage and cost via `/status`
- **Rate limiting** — Configurable per-user request throttling

## Quick Start

### Prerequisites

- **Node.js** 18+
- **npm** 9+
- **Claude Code CLI** installed and logged in (`claude login`)
- **Discord Bot Token** from the [Discord Developer Portal](https://discord.com/developers/applications)

### 1. Clone and install

```bash
git clone https://github.com/hsiangfeng/Claude-by-Discord.git
cd Claude-by-Discord
npm install
```

### 2. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. Navigate to **Bot** → **Reset Token** → copy the token
3. Note the **Application ID** (Client ID)
4. Enable **Message Content Intent** under Privileged Gateway Intents

### 3. Invite the Bot

Replace `CLIENT_ID` in the URL below and open it in your browser:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=326417591296
```

Required permissions: Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Read Message History, Use Slash Commands.

### 4. Configure environment

Run the interactive setup script to create `.env` and `projects.json`:

```bash
bash setup.sh
```

Or configure manually:

```bash
cp .env.example .env
cp projects.example.json projects.json
```

Edit `.env` with your credentials:

```env
DISCORD_BOT_TOKEN=           # Bot token
DISCORD_CLIENT_ID=           # Application Client ID
DISCORD_GUILD_ID=            # Server ID
DISCORD_CHANNEL_ID=          # Channel the bot operates in
ALLOWED_USER_IDS=            # Comma-separated user IDs
```

Edit `projects.json` to define your project directories:

```json
[
  { "name": "my-app", "path": "/home/user/projects/my-app" },
  { "name": "api-server", "path": "/home/user/projects/api-server" }
]
```

### 5. Deploy and run

```bash
npm run deploy-commands   # Register slash commands (first time or after changes)
npm run dev               # Start the bot
```

## Usage

### Commands

| Command | Description |
| --- | --- |
| `/prompt` | Send a prompt to Claude Code (creates a new thread) |
| `/stop` | Preview progress summary, then confirm to abort and archive |
| `/retry` | Re-execute the same prompt in a fresh session |
| `/history` | Export session transcript as a Markdown file |
| `/status` | View session or global token usage and cost |

### `/prompt` parameters

| Parameter | Description | Required |
| --- | --- | --- |
| `message` | The prompt to send to Claude | Yes |
| `cwd` | Working directory (dropdown from `projects.json`) | Yes |
| `model` | Model override (Opus 4.6 / Sonnet 4.5 / Haiku 4.5) | No |

### Workflow

1. Run `/prompt` in the configured channel — a new thread is created
2. Claude streams its response into the thread in real time
3. When Claude needs an unapproved tool, **Approve / Deny** buttons appear
4. After completion, reply in the thread to continue the conversation (supports file attachments)
5. Use `/stop` to end the session or `/retry` to start over

## Configuration Reference

### Optional environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `DEFAULT_MODEL` | Model when `/prompt` doesn't specify one | `claude-opus-4-6` |
| `DEFAULT_PERMISSION_MODE` | Tool permission handling (see below) | `default` |
| `DEFAULT_CWD` | Default working directory; must be in `projects.json` | First project |
| `RATE_LIMIT_WINDOW_MS` | Rate limit time window (ms) | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max `/prompt` requests per user per window | `5` |

### Permission modes

| Mode | Behavior |
| --- | --- |
| `default` | Auto-approves tools in the project's `.claude/settings.local.json` allow list; others require Discord approval |
| `acceptEdits` | Like `default`, but also auto-approves file edit operations (Write, Edit, etc.) |
| `bypassPermissions` | Auto-approves everything. **Use with caution.** |

## Architecture

```
src/
├── commands/    # Slash command definitions (prompt, stop, status, history, retry)
├── handlers/    # Orchestration (interaction routing, streaming, permissions, follow-ups)
├── modules/     # Pure functions (embeds, formatting, permissions, tool display)
├── effects/     # Side effects (Discord I/O, Claude SDK bridge, state stores, logger)
├── config.ts    # Environment variable parsing and validation
├── types.ts     # Shared type definitions and constants
└── index.ts     # Entry point
```

**Key design decisions:**

- **`modules/`** contains pure functions with no side effects — easy to test in isolation
- **`effects/`** encapsulates all I/O (Discord API, Claude SDK, file system)
- **Permission bridge:** `canUseTool` creates a Promise and stores its `resolve` in the `StateStore`. The SDK pauses until a user clicks Approve/Deny in Discord, which resolves the Promise and unblocks execution
- **Session state** is keyed by Discord thread ID and stored in memory (cleared on restart)

## Security Model

Three layers of defense:

1. **User authorization** — Only `ALLOWED_USER_IDS` can interact in `DISCORD_CHANNEL_ID`
2. **Project whitelist** — `cwd` must be listed in `projects.json`, ensuring correct settings are loaded
3. **Tool approval** — Each project's `.claude/settings.local.json` defines auto-approved tools; everything else requires explicit approval via Discord buttons

> **Note:** The `cwd` restriction controls Claude's starting directory and loaded settings, not file system access. Claude can still reach other paths. The actual safeguards are the per-project allow list and the `canUseTool` approval flow.

## Development

```bash
npm run dev                # Dev mode with hot reload (tsx)
npm run build              # Compile TypeScript
npm start                  # Run compiled output
npm test                   # Run tests (Vitest)
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report
npm run deploy-commands    # Register slash commands
```

### Running a single test file

```bash
npm test -- src/modules/formatters.test.ts
```

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create a branch** for your feature or fix (`git checkout -b feat/my-feature`)
3. **Make your changes** — follow the existing code style and layer conventions
4. **Add or update tests** — all modules have co-located `.test.ts` files
5. **Run the test suite** to make sure everything passes (`npm test`)
6. **Open a pull request** with a clear description of what you changed and why

### Guidelines

- Keep `modules/` pure — no I/O or side effects
- Place all Discord/SDK interactions in `effects/`
- Co-locate tests next to their source files (`foo.ts` / `foo.test.ts`)
- All shared types go in `types.ts`
- Use `.js` extensions in imports (ESM requirement)

### Ideas for contribution

- Webhook/notification integrations
- Persistent session storage (database-backed)
- Web dashboard for session monitoring
- Multi-server support
- Docker deployment setup
- Localization / i18n support

## Known Limitations

- Runs locally — the host machine must stay on with the terminal open
- Single-channel operation with user whitelist
- In-memory session state (lost on restart)
- Requires Claude Code CLI to be authenticated

## License

[MIT](LICENSE)

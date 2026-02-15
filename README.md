# 🤖 Claude-Code-DC-Bot

[![CI](https://github.com/sean85120/Claude-Code-DC-Bot/actions/workflows/ci.yml/badge.svg)](https://github.com/sean85120/Claude-Code-DC-Bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org)

> 📱 Control [Claude Code](https://docs.anthropic.com/en/docs/claude-code) from anywhere — your phone, tablet, or any device with Discord.

Send prompts, approve tool calls, and watch Claude work in real time, all without sitting at your computer. Built on the official [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

> ⚠️ **Note:** Tested with Claude Code on the Max plan. API Key authentication should work but is untested and will consume API credits.

---

## 💡 Why?

Claude Code is powerful but terminal-bound. This bot breaks that limit — you can kick off a refactor from your couch, approve a file write from your phone, and check progress from anywhere Discord runs. Each prompt gets its own thread, so you can run multiple tasks at once and never lose context.

---

## ✨ Features

- 🔴 **Real-time streaming** — Responses update live with throttled Discord edits
- 🧵 **Thread isolation** — Each `/prompt` creates a dedicated thread; run multiple tasks concurrently
- 💬 **Follow-up conversations** — Reply in a thread to continue with full context, including file attachments (images, PDFs, code files)
- ✅ **Tool approval** — Unapproved operations present Approve/Deny buttons in Discord
- ❓ **Interactive Q&A** — `AskUserQuestion` renders as buttons with single-select, multi-select, and free-text input
- 🎛️ **Session management** — `/stop` to abort, `/retry` to re-run, `/history` to export as Markdown
- ⚙️ **Live configuration** — `/settings` and `/repos` let you tweak bot config and manage projects without restarting
- 📊 **Token tracking** — Cumulative token usage and cost via `/status`
- 🚦 **Rate limiting** — Configurable per-user request throttling
- 📅 **Daily summaries** — Automatic daily reports of completed work, token usage, and costs per repository, posted to a dedicated channel
- 📋 **Per-project session queue** — When a project is busy, new prompts are automatically queued and started in order when the current session completes
- 🔄 **Session recovery** — Active sessions are persisted to disk; after a bot restart, users are notified with Retry/Dismiss buttons to re-run interrupted work
- 📝 **Unified diff display** — Edit tool embeds show a unified diff preview of changes instead of raw input
- 📄 **Write preview** — Write tool embeds show a content preview with line/character counts
- 🙈 **Tool embed controls** — Configurable options to hide Read/Search/all tool embeds, or show compact single-line embeds

---

## 🚀 Quick Start

### Prerequisites

- 📦 **Node.js** 18+
- 📦 **npm** 9+
- 🖥️ **Claude Code CLI** installed and logged in (`claude login`)
- 🔑 **Discord Bot Token** from the [Discord Developer Portal](https://discord.com/developers/applications)

### 1️⃣ Clone and install

```bash
git clone https://github.com/sean85120/Claude-Code-DC-Bot.git
cd Claude-Code-DC-Bot
npm install
```

### 2️⃣ Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**
2. Navigate to **Bot** > **Reset Token** > copy the token
3. Note the **Application ID** (this is your Client ID)
4. Enable **Message Content Intent** under Privileged Gateway Intents

### 3️⃣ Invite the Bot

Replace `CLIENT_ID` in the URL below and open it in your browser:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=326417591296
```

Required permissions: Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Read Message History, Use Slash Commands.

### 4️⃣ Configure environment

Run the interactive setup script:

```bash
bash setup.sh
```

Or configure manually:

```bash
cp .env.example .env
cp projects.example.json projects.json
```

Fill in `.env`:

```env
DISCORD_BOT_TOKEN=           # 🔑 Bot token
DISCORD_CLIENT_ID=           # 🆔 Application Client ID
DISCORD_GUILD_ID=            # 🏠 Server ID
DISCORD_CHANNEL_ID=          # 📺 Channel the bot operates in
ALLOWED_USER_IDS=            # 👤 Comma-separated user IDs
```

Define your project directories in `projects.json`:

```json
[
  { "name": "my-app", "path": "/home/user/projects/my-app" },
  { "name": "api-server", "path": "/home/user/projects/api-server" }
]
```

### 5️⃣ Deploy and run

```bash
npm run deploy-commands   # 📡 Register slash commands (first time or after changes)
npm run dev               # 🟢 Start the bot
```

---

## 🎮 Usage

### Commands

| Command | Description |
| --- | --- |
| `/prompt` | 💬 Send a prompt to Claude Code (creates a new thread) |
| `/stop` | 🛑 Preview progress summary, then confirm to abort and archive |
| `/retry` | 🔄 Re-execute the same prompt in a fresh session |
| `/history` | 📜 Export session transcript as a Markdown file |
| `/status` | 📊 View session or global token usage and cost |
| `/settings view` | 👁️ Show current bot settings |
| `/settings update` | ⚙️ Change a setting live (model, cwd, permission mode, rate limits) |
| `/repos list` | 📂 List registered project directories |
| `/repos add` | ➕ Add a project (updates `/prompt` dropdown immediately) |
| `/repos remove` | ➖ Remove a project |

### `/prompt` parameters

| Parameter | Description | Required |
| --- | --- | --- |
| `message` | The prompt to send to Claude | ✅ Yes |
| `cwd` | Working directory (dropdown from `projects.json`) | ✅ Yes |
| `model` | Model override (Opus 4.6 / Sonnet 4.5 / Haiku 4.5) | ❌ No |

### 🔄 Typical workflow

1. Run `/prompt` in the configured channel — a new thread is created
2. Claude streams its response into the thread in real time
3. When Claude needs an unapproved tool, **✅ Approve / ❌ Deny** buttons appear
4. After completion, reply in the thread to continue the conversation (supports file attachments)
5. Use `/stop` to end the session or `/retry` to start over

---

## ⚙️ Configuration Reference

### Optional environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `DEFAULT_MODEL` | Model when `/prompt` doesn't specify one | `claude-opus-4-6` |
| `DEFAULT_PERMISSION_MODE` | Tool permission handling (see below) | `default` |
| `DEFAULT_CWD` | Default working directory; must be in `projects.json` | First project |
| `RATE_LIMIT_WINDOW_MS` | Rate limit time window (ms) | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max `/prompt` requests per user per window | `5` |
| `SUMMARY_ENABLED` | Enable daily summary posting | `true` |
| `SUMMARY_CHANNEL_NAME` | Channel name for daily summaries (auto-created) | `claude-daily-summary` |
| `SUMMARY_HOUR_UTC` | Hour (UTC, 0-23) to post daily summary | `0` |
| `HIDE_READ_RESULTS` | Hide Read tool embed cards in threads | `false` |
| `HIDE_SEARCH_RESULTS` | Hide Glob/Grep tool embed cards in threads | `false` |
| `HIDE_ALL_TOOL_EMBEDS` | Hide all tool embed cards (overrides individual settings) | `false` |
| `COMPACT_TOOL_EMBEDS` | Show tool embeds as single-line compact cards | `false` |

> 💡 **Tip:** All of these can be changed at runtime via `/settings update` without restarting the bot. After adding new settings keys, run `npm run deploy-commands` to update Discord's slash command choices.

### 🔐 Permission modes

| Mode | Behavior |
| --- | --- |
| `default` | Auto-approves tools in the project's `.claude/settings.local.json` allow list; others require Discord approval |
| `acceptEdits` | Like `default`, but also auto-approves file edit operations (Write, Edit, etc.) |
| `bypassPermissions` | ⚠️ Auto-approves everything. **Use with caution.** |

---

## 📅 Daily Summary

The bot automatically posts a daily summary to a dedicated Discord channel (`#claude-daily-summary` by default). At the configured UTC hour, the bot posts **yesterday's** summary with a complete picture of the previous day's work:

- **Overall stats** — Total sessions, tokens, cost, and duration
- **Token breakdown** — Input, output, and cache token counts
- **Per-repository breakdown** — Completed tasks grouped by project with prompt descriptions and cost

The summary channel is auto-created in the same category as the general channel. Summary data is persisted to `daily-summary.json` so it survives bot restarts, and old data is automatically pruned after 30 days.

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `SUMMARY_ENABLED` | `true` | Set to `false` to disable |
| `SUMMARY_CHANNEL_NAME` | `claude-daily-summary` | Channel name (auto-created) |
| `SUMMARY_HOUR_UTC` | `0` | Hour in UTC to post (0 = midnight) |

---

## 🏗️ Architecture

```
src/
├── commands/    # 📋 Slash command definitions (prompt, stop, status, history, retry, settings, repos)
├── handlers/    # 🔀 Orchestration (interaction routing, streaming, permissions, follow-ups, summary scheduler)
├── modules/     # 🧩 Pure functions (embeds, formatting, permissions, tool display, daily summary)
├── effects/     # ⚡ Side effects (Discord I/O, Claude SDK bridge, state/usage/daily-summary stores, logger)
├── config.ts    # ⚙️ Environment variable parsing and validation
├── types.ts     # 📝 Shared type definitions and constants
└── index.ts     # 🚪 Entry point
```

**Key design decisions:**

- 🧩 **`modules/`** contains pure functions with no side effects — easy to test in isolation
- ⚡ **`effects/`** encapsulates all I/O (Discord API, Claude SDK, file system)
- 🔗 **Permission bridge:** `canUseTool` creates a Promise and stores its `resolve` in the `StateStore`. The SDK pauses until a user clicks Approve/Deny in Discord, which resolves the Promise and unblocks execution
- 💾 **Session state** is keyed by Discord thread ID and stored in memory. Active sessions are also persisted to `active-sessions.json` for crash recovery
- 📋 **Session queue** — Per-project queue ensures only one Claude subprocess runs per project directory at a time, preventing file conflicts

---

## 🛡️ Security Model

Three layers of defense:

1. 👤 **User authorization** — Only `ALLOWED_USER_IDS` can interact in `DISCORD_CHANNEL_ID`
2. 📁 **Project whitelist** — `cwd` must be listed in `projects.json`, ensuring correct settings are loaded
3. ✅ **Tool approval** — Each project's `.claude/settings.local.json` defines auto-approved tools; everything else requires explicit approval via Discord buttons

> ⚠️ **Note:** The `cwd` restriction controls Claude's starting directory and loaded settings, not file system access. Claude can still reach other paths. The actual safeguards are the per-project allow list and the `canUseTool` approval flow.

---

## 🛠️ Development

```bash
npm run dev                # 🟢 Dev mode with hot reload (tsx)
npm run build              # 🔨 Compile TypeScript
npm start                  # ▶️  Run compiled output
npm test                   # 🧪 Run tests (Vitest)
npm run test:watch         # 👀 Watch mode
npm run test:coverage      # 📊 Coverage report
npm run deploy-commands    # 📡 Register slash commands
```

Run a single test file:

```bash
npm test -- src/modules/formatters.test.ts
```

---

## 🗺️ Roadmap

### Completed

- [x] Real-time streaming with throttled Discord edits
- [x] Thread-per-prompt with follow-up conversations and file attachments
- [x] Tool approval buttons (Approve/Deny) with permission bridge
- [x] Interactive Q&A (AskUserQuestion) with single-select, multi-select, and free-text
- [x] Session management (`/stop`, `/retry`, `/history`)
- [x] Live configuration (`/settings`, `/repos`)
- [x] Token tracking and per-user usage stats
- [x] Rate limiting
- [x] Channel-per-repo routing (auto-creates channels per project)
- [x] Daily summary reports with per-repository breakdown
- [x] Tool embed display options (hide Read/Search/all, compact mode)
- [x] Per-project session queue (prevents concurrent sessions on same repo)
- [x] Session recovery after bot restart (Retry/Dismiss buttons)
- [x] Unified diff display for Edit tool and Write content preview

### Planned

- [ ] Persistent queue storage (queued sessions survive restart)
- [ ] Docker deployment with docker-compose
- [ ] Web dashboard for session monitoring and management
- [ ] Multi-guild support
- [ ] Webhook integrations (Slack, email notifications)
- [ ] Usage analytics with cost alerts and budgets
- [ ] Per-user permission mode overrides
- [ ] Session tagging and search

---

## 🤝 Contributing

Contributions are welcome! Whether it's a bug fix, a new feature, or improved docs — all PRs are appreciated.

> 🔒 **CI runs automatically** on every pull request — your code must pass type checking and all tests before merging.

### 🏁 Getting started

1. 🍴 **Fork** the repository
2. 🌿 **Create a branch** for your feature or fix (`git checkout -b feat/my-feature`)
3. ✏️ **Make your changes** — follow the existing code style and layer conventions
4. 🧪 **Add or update tests** — all modules have co-located `.test.ts` files
5. ✅ **Run the test suite** (`npm test`) — make sure everything passes
6. 🚀 **Open a pull request** with a clear description of what you changed and why

### 📏 Code conventions

| Rule | Details |
| --- | --- |
| 🧩 Pure logic in `modules/` | No I/O, no side effects — keep it testable |
| ⚡ I/O in `effects/` | All Discord/SDK/filesystem interactions live here |
| 📂 Co-located tests | `foo.ts` pairs with `foo.test.ts` in the same directory |
| 📝 Centralized types | All shared types go in `types.ts` |
| 📦 ESM imports | Use `.js` extensions in imports (TypeScript ESM requirement) |

### 💭 Ideas for contribution

- 🐳 Docker deployment setup
- 🖥️ Web dashboard for session monitoring
- 🌐 Multi-server (multi-guild) support
- 🔔 Webhook / notification integrations (Slack, email)
- 💾 Persistent queue storage (survive restart)
- 🌍 Localization / i18n support
- 📈 Usage analytics and cost alerts
- 🔐 Per-user permission mode overrides

---

## ⚠️ Known Limitations

- 🏠 Runs locally — the host machine must stay on with the terminal open
- 📺 Single-guild operation with user whitelist (channel-per-repo routing within the guild)
- 💾 In-memory session state (active sessions are persisted for crash recovery; daily summary data is persisted to file)
- 🔑 Requires Claude Code CLI to be authenticated
- 📋 Queued sessions are in-memory only — lost on restart (active/running sessions are recoverable)

---

## 📄 License

[MIT](LICENSE)

#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m' # No Color

print_green()  { printf "${GREEN}%s${NC}\n" "$1"; }
print_yellow() { printf "${YELLOW}%s${NC}\n" "$1"; }
print_cyan()   { printf "${CYAN}%s${NC}" "$1"; }
print_red()    { printf "${RED}%s${NC}\n" "$1"; }
print_dim()    { printf "${DIM}%s${NC}\n" "$1"; }

# Prompt for a required value (re-prompts if empty)
prompt_required() {
  local var_name="$1"
  local description="$2"
  local value=""
  while [ -z "$value" ]; do
    print_cyan "$description: "
    read -r value
    if [ -z "$value" ]; then
      print_red "  This field is required. Please enter a value."
    fi
  done
  eval "$var_name=\"$value\""
}

# Prompt for an optional value with a default
prompt_optional() {
  local var_name="$1"
  local description="$2"
  local default="$3"
  if [ -n "$default" ]; then
    print_cyan "$description [${default}]: "
  else
    print_cyan "$description (optional): "
  fi
  read -r value
  if [ -z "$value" ]; then
    value="$default"
  fi
  eval "$var_name=\"$value\""
}

# Ask yes/no, default to the provided value
confirm() {
  local prompt="$1"
  local default="${2:-y}"
  if [ "$default" = "y" ]; then
    print_cyan "$prompt [Y/n]: "
  else
    print_cyan "$prompt [y/N]: "
  fi
  read -r answer
  answer="${answer:-$default}"
  case "$answer" in
    [yY]*) return 0 ;;
    *) return 1 ;;
  esac
}

echo ""
print_green "========================================="
print_green "  Claude-Code-DC-Bot Setup"
print_green "========================================="
echo ""

# ─── Prerequisites Check ──────────────────────────────────────

check_prerequisites() {
  echo "Checking prerequisites..."
  echo ""

  local all_ok=true

  # Node.js
  if command -v node &> /dev/null; then
    local node_version
    node_version=$(node --version)
    local node_major
    node_major=$(echo "$node_version" | sed 's/v//' | cut -d. -f1)
    if [ "$node_major" -ge 18 ]; then
      printf "  ${GREEN}✓${NC} Node.js %s\n" "$node_version"
    else
      printf "  ${RED}✗${NC} Node.js %s (v18+ required)\n" "$node_version"
      all_ok=false
    fi
  else
    printf "  ${RED}✗${NC} Node.js not found (v18+ required)\n"
    print_dim "    Install: https://nodejs.org"
    all_ok=false
  fi

  # Package manager (pnpm preferred, npm as fallback)
  PKG_MGR=""
  PKG_RUN=""
  if command -v pnpm &> /dev/null; then
    local pnpm_version
    pnpm_version=$(pnpm --version)
    printf "  ${GREEN}✓${NC} pnpm %s\n" "$pnpm_version"
    PKG_MGR="pnpm"
    PKG_RUN="pnpm"
  elif command -v npm &> /dev/null; then
    local npm_version
    npm_version=$(npm --version)
    printf "  ${YELLOW}△${NC} npm %s ${DIM}(pnpm recommended)${NC}\n" "$npm_version"
    PKG_MGR="npm"
    PKG_RUN="npx"
  else
    printf "  ${RED}✗${NC} No package manager found (pnpm or npm required)\n"
    print_dim "    Install pnpm: npm install -g pnpm"
    all_ok=false
  fi

  # Git
  if command -v git &> /dev/null; then
    local git_version
    git_version=$(git --version | sed 's/git version //')
    printf "  ${GREEN}✓${NC} git %s\n" "$git_version"
  else
    printf "  ${RED}✗${NC} git not found\n"
    print_dim "    Install: https://git-scm.com"
    all_ok=false
  fi

  # Claude CLI
  if command -v claude &> /dev/null; then
    printf "  ${GREEN}✓${NC} Claude CLI found\n"
    # Check if logged in by running claude status (suppress errors)
    if claude status &> /dev/null; then
      printf "  ${GREEN}✓${NC} Claude CLI logged in\n"
    else
      printf "  ${YELLOW}△${NC} Claude CLI not logged in ${DIM}(run 'claude login' before starting the bot)${NC}\n"
    fi
  else
    printf "  ${RED}✗${NC} Claude CLI not found\n"
    print_dim "    Install: npm install -g @anthropic-ai/claude-code"
    print_dim "    Then run: claude login"
    all_ok=false
  fi

  echo ""

  if [ "$all_ok" = false ]; then
    print_red "Some prerequisites are missing. Please install them and re-run setup."
    if ! confirm "Continue anyway?" "n"; then
      exit 1
    fi
    echo ""
  else
    print_green "All prerequisites satisfied!"
    echo ""
  fi
}

check_prerequisites

# ─── Part 1: .env ───────────────────────────────────────────────

created_env=false

setup_env() {
  if [ -f .env ]; then
    print_yellow "Warning: .env already exists."
    if ! confirm "Overwrite it?" "n"; then
      echo "Skipping .env setup."
      return
    fi
    echo ""
  fi

  echo "Enter your Discord credentials and bot settings."
  echo "Required fields cannot be left empty."
  echo ""

  # Required
  prompt_required DISCORD_BOT_TOKEN    "Discord Bot Token"
  prompt_required DISCORD_CLIENT_ID    "Discord Application Client ID"
  prompt_required DISCORD_GUILD_ID     "Discord Server (Guild) ID"
  prompt_required DISCORD_CHANNEL_ID   "Channel ID (general channel for the bot repo)"
  prompt_required ALLOWED_USER_IDS     "Allowed user IDs (comma-separated)"

  echo ""
  echo "Optional settings (press Enter to keep defaults):"
  echo ""

  # Optional
  prompt_optional DEFAULT_MODEL            "Default model"                                        "claude-opus-4-6"
  prompt_optional DEFAULT_CWD              "Default working directory"                            ""
  prompt_optional DEFAULT_PERMISSION_MODE  "Default permission mode (default|acceptEdits|bypassPermissions)" "default"

  # Bot repo path — auto-detect current directory as default
  local bot_repo_default
  bot_repo_default="$(pwd)"
  echo ""
  print_dim "  The bot repo path determines which project uses the general channel."
  print_dim "  Other projects will get their own auto-created channels."
  prompt_optional BOT_REPO_PATH          "Bot repo path (for channel-per-repo routing)"          "$bot_repo_default"

  prompt_optional RATE_LIMIT_WINDOW_MS     "Rate limit window in ms"                              "60000"
  prompt_optional RATE_LIMIT_MAX_REQUESTS  "Rate limit max requests per window"                   "5"

  # Write .env
  cat > .env << EOF
# Discord Bot Token (from Discord Developer Portal)
DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}

# Discord Application Client ID (for registering Slash Commands)
DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID}

# Discord Server ID
DISCORD_GUILD_ID=${DISCORD_GUILD_ID}

# Channel ID (general channel — used for the bot's own repo)
DISCORD_CHANNEL_ID=${DISCORD_CHANNEL_ID}

# Allowed user IDs (comma-separated)
ALLOWED_USER_IDS=${ALLOWED_USER_IDS}

# Default model
DEFAULT_MODEL=${DEFAULT_MODEL}

# Default working directory (optional, falls back to the first project in projects.json)
DEFAULT_CWD=${DEFAULT_CWD}

# Default permission mode (default | acceptEdits | bypassPermissions)
DEFAULT_PERMISSION_MODE=${DEFAULT_PERMISSION_MODE}

# Bot's own repo path — sessions for this path use the general channel (defaults to cwd)
BOT_REPO_PATH=${BOT_REPO_PATH}

# Rate Limiting (optional)
RATE_LIMIT_WINDOW_MS=${RATE_LIMIT_WINDOW_MS}
RATE_LIMIT_MAX_REQUESTS=${RATE_LIMIT_MAX_REQUESTS}
EOF

  created_env=true
  echo ""
  print_green ".env file created successfully!"
}

# ─── Part 2: projects.json ──────────────────────────────────────

created_projects=false

setup_projects() {
  echo ""

  if [ -f projects.json ]; then
    print_yellow "Warning: projects.json already exists."
    if ! confirm "Overwrite it?" "n"; then
      echo "Skipping projects.json setup."
      return
    fi
    echo ""
  fi

  echo "Add projects that the bot can operate in."
  echo "Each project needs a name and an absolute path."
  print_dim "Each project will get its own Discord channel (except the bot repo, which uses the general channel)."
  echo ""

  local projects="["
  local first=true

  while true; do
    local name=""
    local path=""

    prompt_required name "Project name"

    while true; do
      prompt_required path "Absolute path to project"
      if [ -d "$path" ]; then
        break
      else
        print_red "  Directory not found: $path"
        print_yellow "  Please enter a valid path."
      fi
    done

    if [ "$first" = true ]; then
      projects="${projects}
  { \"name\": \"${name}\", \"path\": \"${path}\" }"
      first=false
    else
      projects="${projects},
  { \"name\": \"${name}\", \"path\": \"${path}\" }"
    fi

    echo ""
    if ! confirm "Add another project?" "n"; then
      break
    fi
    echo ""
  done

  projects="${projects}
]"

  echo "$projects" > projects.json

  created_projects=true
  echo ""
  print_green "projects.json created successfully!"
}

# ─── Part 3: Deploy Commands ──────────────────────────────────

deploy_slash_commands() {
  # Only offer if .env and projects.json both exist
  if [ ! -f .env ] || [ ! -f projects.json ]; then
    return
  fi

  echo ""
  if confirm "Deploy Discord slash commands now?" "y"; then
    echo ""
    echo "Registering slash commands with Discord..."
    echo ""

    if [ -n "$PKG_MGR" ]; then
      if [ "$PKG_MGR" = "pnpm" ]; then
        if pnpm deploy-commands; then
          echo ""
          print_green "Slash commands deployed successfully!"
        else
          echo ""
          print_red "Failed to deploy commands. You can retry later with: pnpm deploy-commands"
        fi
      else
        if npm run deploy-commands; then
          echo ""
          print_green "Slash commands deployed successfully!"
        else
          echo ""
          print_red "Failed to deploy commands. You can retry later with: npm run deploy-commands"
        fi
      fi
    else
      print_yellow "No package manager found. Run manually: pnpm deploy-commands"
    fi
  fi
}

# ─── Run ────────────────────────────────────────────────────────

setup_env
setup_projects
deploy_slash_commands

# ─── Summary ────────────────────────────────────────────────────

echo ""
print_green "========================================="
print_green "  Setup Complete!"
print_green "========================================="
echo ""

if [ "$created_env" = true ]; then
  print_green "  Created: .env"
fi
if [ "$created_projects" = true ]; then
  print_green "  Created: projects.json"
fi

if [ "$created_env" = false ] && [ "$created_projects" = false ]; then
  print_yellow "  No files were modified."
else
  echo ""
  echo "Next steps:"
  if [ -n "$PKG_MGR" ]; then
    echo "  1. $PKG_MGR run dev               # Start the bot in dev mode"
  else
    echo "  1. pnpm dev                        # Start the bot in dev mode"
  fi
fi
echo ""

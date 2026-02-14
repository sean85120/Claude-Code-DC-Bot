import { config as loadEnv } from 'dotenv';
import { logger } from '../effects/logger.js';
import { loadProjects } from '../config.js';
import { deployCommands } from '../effects/command-deployer.js';

const log = logger.child({ module: 'Deploy' });

loadEnv();

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !guildId || !clientId) {
  log.fatal('Please set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, and DISCORD_CLIENT_ID');
  process.exit(1);
}

const projects = loadProjects();

async function main() {
  await deployCommands(token!, clientId!, guildId!, projects);
}

main().catch((error) => {
  log.error({ err: error }, 'Registration failed');
  process.exit(1);
});

#!/usr/bin/env node
// @citizenweb3/ai-integrations — CLI entry point
import { parseArgs } from "node:util";
import { detectAgents } from "./detect.js";
import { installSkill } from "./install.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SUPPORTED_NETWORKS = ["logos-node"] as const;
type Network = (typeof SUPPORTED_NETWORKS)[number];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    global: { type: "boolean", short: "g", default: false },
    help:   { type: "boolean", short: "h", default: false },
    yes:    { type: "boolean", short: "y", default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(`
Usage: ai-integrations <network> [options]

Networks:
  logos-node    Logos Blockchain testnet validator node

Options:
  --global, -g  Install to home directory (available in all projects)
  --yes, -y     Skip confirmation prompts
  --help, -h    Show this help

Examples:
  npx @citizenweb3/ai-integrations logos-node
  npx @citizenweb3/ai-integrations logos-node --global
  ai-integrations logos-node --global --yes
`);
  process.exit(0);
}

const network = positionals[0] as Network;

if (!SUPPORTED_NETWORKS.includes(network)) {
  console.error(`Unknown network: ${network}`);
  console.error(`Supported networks: ${SUPPORTED_NETWORKS.join(", ")}`);
  process.exit(1);
}

const isGlobal = values.global as boolean;
const autoYes  = values.yes as boolean;

(async () => {
  console.log(`\n🔗 ai-integrations — installing skill: ${network}\n`);

  const agents = await detectAgents(isGlobal, network);

  if (agents.length === 0) {
    const fallback = isGlobal
      ? `${process.env.HOME}/.agents/skills/${network}`
      : `${process.cwd()}/.agents/skills/${network}`;
    console.log(`⚠️  No supported AI agents detected.`);
    console.log(`   Installing to fallback path: ${fallback}\n`);
    await installSkill(network, fallback);
    printSuccess(network);
    return;
  }

  console.log("Detected agents:");
  for (const a of agents) {
    console.log(`  • ${a.name} → ${a.installPath}`);
  }
  console.log("");

  const rl = autoYes ? null : readline.createInterface({ input, output });

  for (const agent of agents) {
    let install = true;
    if (rl) {
      const answer = await rl.question(`Install for ${agent.name}? [Y/n] `);
      install = !answer.trim().toLowerCase().startsWith("n");
    }
    if (install) {
      await installSkill(network, agent.installPath);
      console.log(`✅ Installed for ${agent.name} → ${agent.installPath}`);
    } else {
      console.log(`⏭️  Skipped ${agent.name}`);
    }
  }

  rl?.close();
  printSuccess(network);
})();

function printSuccess(network: string) {
  console.log(`
✨ Done! Activate the skill in your agent:

  /${network} install   — fresh node setup
  /${network} update    — breaking upgrade (wipe + re-init)
  /${network} status    — check sync, peers, wallet balance
`);
}

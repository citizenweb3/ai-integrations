// detect.ts — detect which AI agents are installed on this machine
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import * as path from "node:path";

export interface AgentInfo {
  id:          string;
  name:        string;
  installPath: string;
}

const HOME = process.env.HOME ?? "/root";
const CWD  = process.cwd();

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasEnv(name: string): boolean {
  return !!process.env[name];
}

export async function detectAgents(
  global: boolean,
  skillName: string
): Promise<AgentInfo[]> {
  const detected: AgentInfo[] = [];

  // ── Claude Code ─────────────────────────────────────────────────────────
  if (existsSync(path.join(HOME, ".claude")) || existsSync(path.join(CWD, ".claude"))) {
    detected.push({
      id:   "claude",
      name: "Claude Code",
      installPath: global
        ? path.join(HOME, ".claude", "skills", skillName)
        : path.join(CWD, ".claude", "skills", skillName),
    });
  }

  // ── GitHub Copilot ───────────────────────────────────────────────────────
  const hasCopilotDir = existsSync(path.join(CWD, ".github", "copilot"));
  const hasGithubRemote = (() => {
    try {
      const remotes = execSync("git remote -v", { stdio: ["ignore", "pipe", "ignore"] })
        .toString();
      return remotes.includes("github.com");
    } catch {
      return false;
    }
  })();
  if (hasCopilotDir || hasGithubRemote) {
    detected.push({
      id:   "copilot",
      name: "GitHub Copilot",
      installPath: global
        ? path.join(HOME, ".agents", "skills", skillName)
        : path.join(CWD, ".agents", "skills", skillName),
    });
  }

  // ── Gemini CLI ───────────────────────────────────────────────────────────
  if (
    existsSync(path.join(CWD, ".gemini")) ||
    existsSync(path.join(HOME, ".gemini")) ||
    hasEnv("GEMINI_API_KEY")
  ) {
    detected.push({
      id:   "gemini",
      name: "Gemini CLI",
      installPath: global
        ? path.join(HOME, ".gemini", "skills", skillName)
        : path.join(CWD, ".gemini", "skills", skillName),
    });
  }

  // ── OpenAI Codex CLI ─────────────────────────────────────────────────────
  if (hasEnv("OPENAI_API_KEY") || existsSync(path.join(CWD, ".codex"))) {
    detected.push({
      id:   "codex",
      name: "OpenAI Codex CLI",
      installPath: global
        ? path.join(HOME, ".agents", "skills", skillName)
        : path.join(CWD, ".agents", "skills", skillName),
    });
  }

  // ── opencode (anomalyco/opencode) ────────────────────────────────────────
  if (
    existsSync(path.join(CWD, ".opencode")) ||
    existsSync(path.join(CWD, "opencode.json")) ||
    commandExists("opencode")
  ) {
    detected.push({
      id:   "opencode",
      name: "opencode",
      installPath: global
        ? path.join(HOME, ".config", "opencode", "skills", skillName)
        : path.join(CWD, ".opencode", "skills", skillName),
    });
  }

  // ── OpenClaw (formerly clawdbot) — always global ─────────────────────────
  if (
    existsSync(path.join(HOME, ".openclaw")) ||
    existsSync(path.join(CWD, "openclaw.json")) ||
    commandExists("openclaw")
  ) {
    detected.push({
      id:   "openclaw",
      name: "OpenClaw",
      installPath: path.join(HOME, ".openclaw", "skills", skillName),
    });
  }

  // De-duplicate install paths (e.g. Copilot + Codex both use .agents/skills)
  const seen = new Set<string>();
  return detected.filter((a) => {
    if (seen.has(a.installPath)) return false;
    seen.add(a.installPath);
    return true;
  });
}

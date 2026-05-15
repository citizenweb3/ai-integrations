// install.ts — download logos-node branch tarball and copy skill/ to target path
import { createWriteStream, existsSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract } from "tar";
import { rm } from "node:fs/promises";

const REPO   = "citizenweb3/ai-integrations";
const BRANCH = "logos-node";
const URL    = `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz`;

export async function installSkill(
  _skillName: string,
  targetPath: string
): Promise<void> {
  const tmpDir = join(tmpdir(), `logos-skill-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    console.log(`  ↓ Downloading skill from github.com/${REPO}@${BRANCH}...`);
    const res = await fetch(URL);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download tarball: ${res.status} ${res.statusText}`);
    }

    // Extract tarball (strip top-level directory — archive root is ai-integrations-logos-node/)
    await pipeline(
      res.body as unknown as NodeJS.ReadableStream,
      createGunzip(),
      extract({ cwd: tmpDir, strip: 1 })
    );

    const skillSrc = join(tmpDir, "skill");
    if (!existsSync(skillSrc)) {
      throw new Error(`skill/ directory not found in downloaded archive`);
    }

    mkdirSync(targetPath, { recursive: true });
    cpSync(skillSrc, targetPath, { recursive: true });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

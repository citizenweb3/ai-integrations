#!/usr/bin/env node
// T-026Z: post-process tsc output to add `.js` extensions to relative imports.
// tsc with module=ESNext + moduleResolution=Bundler emits `from "./foo"`
// without extension, but Node's strict ESM loader requires `./foo.js`. This
// fixer walks one or more `dist/` directories and rewrites every relative
// import / export specifier in-place, leaving absolute / bare specifiers
// (e.g. `@bizdev/db`, `drizzle-orm`) untouched.
//
// Usage: node scripts/fix-esm-imports.mjs <dist-dir> [<dist-dir>...]
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ALREADY_HAS_EXT = /\.(?:js|mjs|cjs|json|node)$/;

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const s = await stat(path);
    if (s.isDirectory()) {
      await walk(path, out);
    } else if (name.endsWith(".js")) {
      out.push(path);
    }
  }
  return out;
}

function patch(source) {
  // Catches `from "./x"`, `from '../x'`, `import "./x"`, `export ... from "./x"`,
  // and dynamic `import("./x")`. Skips already-extensioned and bare specifiers.
  return source.replace(
    /(from\s+|import\s*\(?\s*|export[^"'`\n]*?from\s+)(["'`])((?:\.\.?\/)[^"'`\n]+)\2/g,
    (full, prefix, quote, spec) => {
      if (ALREADY_HAS_EXT.test(spec)) return full;
      return `${prefix}${quote}${spec}.js${quote}`;
    }
  );
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: fix-esm-imports.mjs <dist-dir> [<dist-dir>...]");
  process.exit(1);
}

let patched = 0;
for (const dir of targets) {
  const files = await walk(dir);
  for (const f of files) {
    const before = await readFile(f, "utf8");
    const after = patch(before);
    if (after !== before) {
      await writeFile(f, after);
      patched += 1;
    }
  }
}
console.log(`fix-esm-imports: patched ${patched} file(s)`);

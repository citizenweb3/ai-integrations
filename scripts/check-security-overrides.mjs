import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const patchedPostcssVersion = "8.5.10";
const expectedPostcssResolution = "8.5.12";
const rootPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const nextPackage = readPackage("next/package.json");
const postcssPackage = readPackage("postcss/package.json");

const nextPostcssSpec = nextPackage.dependencies?.postcss;
const nextPostcssVersion = firstSemver(nextPostcssSpec);
const installedPostcssVersion = postcssPackage.version;
const postcssResolution = rootPackage.resolutions?.postcss;

if (!nextPostcssSpec || !nextPostcssVersion) {
  fail(`Cannot inspect Next.js PostCSS dependency spec: ${String(nextPostcssSpec)}`);
}

if (compareVersions(installedPostcssVersion, patchedPostcssVersion) < 0) {
  fail(
    `Installed postcss@${installedPostcssVersion} is below patched ${patchedPostcssVersion}. ` +
    "Run yarn install and keep the security resolution active."
  );
}

if (compareVersions(nextPostcssVersion, patchedPostcssVersion) < 0) {
  if (postcssResolution !== expectedPostcssResolution) {
    fail(
      `Next.js still requests vulnerable postcss@${nextPostcssSpec}, but root resolutions.postcss ` +
      `is ${String(postcssResolution)} instead of ${expectedPostcssResolution}.`
    );
  }

  if (installedPostcssVersion !== expectedPostcssResolution) {
    fail(
      `Expected Yarn to resolve postcss@${expectedPostcssResolution}, got ${installedPostcssVersion}. ` +
      "Run yarn install and inspect yarn.lock."
    );
  }

  console.log(
    `Security override active: next requests postcss@${nextPostcssSpec}, ` +
    `Yarn resolves patched postcss@${installedPostcssVersion}.`
  );
} else {
  if (postcssResolution) {
    fail(
      `Next.js now requests patched postcss@${nextPostcssSpec}. ` +
      "Remove root resolutions.postcss and regenerate yarn.lock."
    );
  }

  console.log(`No PostCSS security override needed: Next.js requests ${nextPostcssSpec}.`);
}

function readPackage(packagePath) {
  return JSON.parse(readFileSync(require.resolve(packagePath), "utf8"));
}

function firstSemver(value) {
  if (typeof value !== "string") {
    return null;
  }
  return value.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

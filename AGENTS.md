# ai-integrations — main branch

This branch contains the npm package `@citizenweb3/ai-integrations` — the CLI installer
that copies skills from network branches to local AI agent directories.

## Structure

```
installer/
├── src/
│   ├── index.ts     # CLI entry: ai-integrations <network> [--global] [--yes]
│   ├── detect.ts    # Agent detection (6 agents)
│   └── install.ts   # Tarball download + skill copy
└── tsconfig.json

plugins/
└── logos-node/
    └── .claude-plugin/
        └── plugin.json   # Claude Code plugin metadata for logos-node

.claude-plugin/
└── marketplace.json      # Claude Code marketplace publisher registration

package.json   # @citizenweb3/ai-integrations npm package
LICENSE
README.md
AGENTS.md
```

## Agent roles

1. **research** — Verify npm package conventions, agent detection logic before changing.
2. **executor** — Build (`npm run build`), test CLI flow locally, then publish.
3. **review** — Check that no secrets are in env detection, no hardcoded paths, compatible Node versions.

## Adding a new network

1. Create a new branch `<network>-node` in this repo with skill content
2. Add the network name to `SUPPORTED_NETWORKS` in `installer/src/index.ts`
3. Commit to main, bump version, publish to npm

## Build and publish

```bash
npm install
npm run build
npm publish --access public
```

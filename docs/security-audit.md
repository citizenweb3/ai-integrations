# Security Audit Notes

Last checked: 2026-04-30.

## Commands

```bash
yarn audit --level moderate
yarn why postcss
yarn check:security-overrides
```

## Fixed

- Removed `drizzle-kit` from the foundation scaffold.
- This removed the dev-only `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild@0.18.20` advisory chain.
- The project currently uses manual SQL migrations plus the local migration runner in `packages/db/src/migrate.ts`.

## Temporary Security Override

`next@16.2.4` declares `postcss: 8.4.31` exactly.
That version is below the patched PostCSS range for `GHSA-qx2v-qp2m-jg93`.

Current mitigation:

- The project uses Yarn v1.
- Root `resolutions.postcss = 8.5.12` forces Next's transitive PostCSS dependency to a patched release.
- `scripts/check-security-overrides.mjs` verifies that this override is still required, still applied, and resolves to the expected patched version.
- If a future Next release requests patched PostCSS directly, `yarn check:security-overrides` fails and instructs us to remove the resolution and regenerate `yarn.lock`.

Advisory:

- `GHSA-qx2v-qp2m-jg93`
- PostCSS XSS via unescaped `</style>` in CSS stringify output
- vulnerable range: `<8.5.10`

Why not auto-fix:

- `npm audit fix --force` proposed replacing `next@16.2.4` with `next@9.3.3`, which is a destructive major downgrade and not a valid fix for this scaffold.
- `next@16.2.4` declares `postcss: 8.4.31` exactly.
- Root and workspace `overrides` did not replace Next's exact PostCSS dependency under npm 11.6.2.
- Yarn v1 `resolutions` does replace the transitive dependency deterministically.

Decision:

- Keep the Yarn resolution until Next requests a patched PostCSS dependency.
- Do not remove or change the resolution without running `yarn check:security-overrides`, `yarn build`, and `yarn audit --level moderate`.

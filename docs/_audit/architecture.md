# Architecture & Build Audit (maze)

## Verified current state
- `npm run test` → 38/38 passing
- `npx tsc --noEmit` → clean (exit 0)
- `npm audit` → 0 vulnerabilities

## Findings

### A1 — tsconfig has NO strict mode [HIGH]
`tsconfig.json` — there is no `"strict": true`. Missing strictNullChecks,
noImplicitAny, strictFunctionTypes. For a 4336-line `app.ts`, this is the single
biggest latent-bug risk: null/undefined access and implicit `any` go uncaught.
Recommend enabling `strict` incrementally (start with strictNullChecks).

### A2 — No vite.config.ts / no manual chunking [MED]
No `vite.config.*` exists. CLAUDE.md notes the chunk-size warning (>500kB from
pdfjs-dist). A vite config with `build.rollupOptions.output.manualChunks` to split
pdfjs/pdf-lib into separate chunks would silence the warning and improve load.

### A3 — Android release: minifyEnabled false [MED]
`android/app/build.gradle` release buildType has `minifyEnabled false`. No R8
code shrinking/obfuscation → larger APK (pdfjs is heavy) and no obfuscation.
Consider enabling R8 with proper proguard keep rules for Capacitor.

### A4 — No CI pipeline [MED]
No `.github/workflows/`. Tests + typecheck are run manually. A simple GH Action
(npm ci → tsc → vitest) would gate regressions before device deploy.

### A5 — Version metadata drift [LOW]
package.json version=0.1.0, build.gradle versionName=0.1.0/versionCode=2, but
CLAUDE.md/commit reference v0.0.2. Pick one source of truth.

### A6 — Signing config is correct [OK]
build.gradle reads keystore passwords from local.properties (gitignored) and the
.jks is gitignored. Secret handling verified safe after the recent .gitignore work.

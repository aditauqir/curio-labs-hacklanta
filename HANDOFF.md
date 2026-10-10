# Curio Labs: Handoff

Last updated: 2026-10-09

Read this first. It is the single source of truth for where the project stands and where to work next.
If you create a branch, you must also log it in the [Branch log](#branch-log). See [Working agreement](#working-agreement).

## 1. What this is

**Curio Labs** is an AI creative director for small businesses, artists, and designers.
Tagline: "From vague ideas to visual direction."

It does not generate finished artwork. It helps a user explore directions, pick type and color, and refine an editable poster through conversation.
The core idea is **Visual Consensus**: vague preferences become explicit design decisions (the creative brief) that the user can approve, reject, or edit, and the brief is the same state that drives the live canvas.

The demo we are building toward: three distinct poster directions -> user asks for one specific change -> only that property changes -> the brief updates -> export works.

## 2. Current state

Live at **http://155.138.194.120/** (plain HTTP, no domain or HTTPS yet). Deployed from `main` on every merge.

| Area | Status |
| --- | --- |
| Three-panel workspace (director, canvas, inspiration) | Working |
| Three poster directions (Vintage Jazz, Modern Minimal, Experimental Editorial) | Working |
| Independent edits: headline, copy, accent, alignment, spacing, font pairing, palette | Working |
| Creative brief reflecting and editing the live design | Working |
| LocalStorage persistence with validation of stored data | Working |
| PNG export (renders the same layout model as the screen) and brief JSON export | Working |
| Mobile layout (tabs: Director / Canvas / Inspiration) | Working |
| Chat replies | **Demo only.** Local keyword rules in `lib/demo-director.ts`, labelled "Demo rules" in the UI. Not an AI. |
| Visual reference cards | **Placeholders.** Original abstract art, no external sources. |
| Voice (microphone) | **Disabled on purpose.** Button is inert until ElevenLabs is wired up. Do not fake it. |
| Gemini integration | **Not built.** Key is provisioned, nothing reads it yet. |
| ElevenLabs integration | **Not built.** Key is provisioned, nothing reads it yet. |
| Auth0 | Not built. App is open, no login. |
| SVG export | Not built. |
| Tablet collapsible panels | Not built. Tablet reuses the mobile tabs. |
| HTTPS / custom domain | Not set up. |

## 3. Stack

Next.js 16 (App Router, Turbopack, `cacheComponents` on), React 19, TypeScript (strict), Tailwind CSS 4, npm. Hosted on a Vultr VPS, not Vercel.

**Next.js 16 has breaking changes versus older versions.** Read the matching guide in `node_modules/next/dist/docs/` before writing Next-specific code (see `AGENTS.md`).
`LayoutProps` is a generated global type. A bare `tsc` fails on a clean checkout, so always use `npm run typecheck`, which runs `next typegen` first.

## 4. Code map

```
app/
  layout.tsx            Loads Inter, Space Grotesk and the poster fonts via next/font; sets metadata
  page.tsx              Server component that renders <StudioLoader />
  globals.css           Tailwind import and the neutral UI palette tokens
components/studio/
  studio-loader.tsx     Client wrapper: dynamic(..., { ssr: false }) because state restores from LocalStorage
  studio-workspace.tsx  Header, mobile tabs, useReducer, persistence effect
  creative-director.tsx Left panel: chat UI, suggestion chips, disabled mic
  design-canvas.tsx     Centre panel: poster, direction switch, editing controls
  poster.tsx            Renders the poster as real SVG elements from the layout model
  inspiration-board.tsx Right panel shell, reference thumbnails
  creative-brief.tsx    Editable brief rows
  typography-selector.tsx, color-palette-selector.tsx, export-controls.tsx, ui.tsx, icons.tsx
lib/
  design-types.ts       DesignState, ChatMessage, PersistedStudioState
  design-presets.ts     Font pairs, palettes, direction configs, applyDirection(), initial design
  poster-layout.ts      buildPoster(design) -> shapes and texts. Shared by the SVG poster and the PNG exporter
  design-state.ts       studioReducer, StudioAction, getBrief(), sanitizeState() for untrusted stored data
  demo-director.ts      interpretRequest(): local rule engine that returns StudioAction[]
  storage.ts            LocalStorage load/save (key: studio-workspace-v1)
  export.ts             PNG (canvas) and brief JSON export
scripts/new-branch.mjs  Creates a branch and logs it here (see Working agreement)
```

### The key design decision

All edits go through one reducer. Each `StudioAction` changes only its own slice of `DesignState`, which is what makes "change the font and the colors stay put" true.
`StudioAction` is also the contract for AI: a Gemini response should be validated and mapped onto these same actions, never applied as raw state.

`buildPoster()` is the single source of layout. The SVG on screen and the exported PNG both render its output, so they cannot drift apart.

## 5. Infrastructure and deploy

| Item | Value |
| --- | --- |
| Host | Vultr Cloud Compute, Ubuntu 26.04, `155.138.194.120` |
| SSH user | `linuxuser` (CI uses an SSH key; no password is used by automation) |
| App directory | `/var/www/curiolabs` (a git clone of this repo, tracks `main`) |
| Process manager | PM2, process name `curiolabs`, serves Next on `127.0.0.1:3000` |
| Reverse proxy | nginx on :80 -> `127.0.0.1:3000`, config `/etc/nginx/sites-available/curiolabs` |
| Firewall | ufw: 22, 80, 443 open |

### Pipelines (`.github/workflows/`)

- **`ci.yml`**: runs on pull requests to `main`. Lint (zero warnings), typecheck, build, non-blocking `npm audit`.
- **`deploy.yml`**: runs on push to `main` (every merge) and manually. Job 1 lints, typechecks, and builds. Job 2 SSHes in, fast-forwards the server to `origin/main`, runs `npm ci` and `npm run build`, restarts PM2, and health-checks `127.0.0.1:3000`. If any step fails it restores the previous commit, rebuilds, and restarts. Job 3 checks the public URL.

### Things to know about deploy

- **Never push straight to `main`.** A push deploys to production immediately. Use a branch and a pull request.
- The server shell used by CI resolves Node 22, while PM2 launches the app with an nvm Node 24 (`~/.nvm/versions/node/v24.21.0`). It works today, but the mismatch is worth cleaning up.
- `deploy.yml` re-scans the server's SSH host key at deploy time, so the `VULTR_KNOWN_HOSTS` secret is currently unused. This trusts whatever answers on that IP, so pinning the host key is a hardening TODO.
- The workflow normalizes the `VULTR_SSH_KEY` secret (CRLF, escaped `\n`, quotes, base64). The original failure was a malformed key secret.

## 6. Secrets and environment variables

**Never commit secrets or paste them into issues, PRs, or this file.** `.env*` is gitignored; only `.env.example` (names, no values) is tracked.

| Variable | Used for | Where it lives |
| --- | --- | --- |
| `GEMINI_API_KEY` | Gemini calls (server only, never `NEXT_PUBLIC_`) | `.env.local` locally; `/var/www/curiolabs/.env.local` on the server (mode 600) |
| `ELEVENLABS_API_KEY` | ElevenLabs voice (server only) | same as above |
| GitHub Actions secrets | `VULTR_HOST`, `VULTR_USER`, `VULTR_SSH_KEY`, `VULTR_KNOWN_HOSTS` | GitHub repo settings. App keys are intentionally **not** here |

Both app keys were checked against their APIs on 2026-10-09 (HTTP 200). Nothing in the code reads them yet.

Keys are read only from `process.env` at runtime, never written in code. `npm run check:secrets` (part of `npm run check`, and a step in both CI workflows) fails the build if a credential-shaped string appears in any file git would commit. Gitignored files such as `.env.local` are skipped on purpose.

- Google Cloud project for Gemini: **Hacklanta 2**, project number `145508307041`.
- Gemini text models that were available to the key: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`, plus `*-latest` aliases. Re-list before relying on a name; they change.
- A new server needs the same `.env.local` created by hand. `git pull` will not bring it, by design.

**Security TODOs (the keys and the server password were shared in chat, so treat them as exposed):**
1. Rotate the Gemini key and the ElevenLabs key.
2. Rotate the `linuxuser` server password and consider disabling SSH password login, since CI uses key auth.
3. After rotating, update both `.env.local` files and restart PM2 with `pm2 restart curiolabs --update-env`.

## 7. Run it locally

```bash
npm ci
cp .env.example .env.local   # then fill in values; only needed once AI features exist
npm run dev                  # http://localhost:3000
```

Checks (run these before opening a PR; CI runs the same):

```bash
npm run lint        # eslint, zero warnings allowed
npm run typecheck   # next typegen && tsc --noEmit
npm run build       # production build
npm run check       # secret scan + lint + typecheck
npm run check:secrets  # just the secret scan
```

In opencode, `/check` runs lint, typecheck, and build and fixes failures. `opencode.json` enables the built-in TypeScript and ESLint language servers.

## 8. Working agreement

1. **Branch, then PR.** Do not commit to or push `main` directly. Merging to `main` deploys.
2. **Every new branch gets logged here.** When you create a branch, add a row to the [Branch log](#branch-log) in that same branch. Easiest way: `npm run branch -- <name> "<what it is for>"`, which creates the branch from up-to-date `main` and adds the row.
3. **Keep this file true.** If your work changes the current state, infrastructure, env vars, or next steps, update the relevant section and the `Last updated` date in the same branch. Update your branch's row status when you open, merge, or abandon it.
4. **Do not fake features.** No simulated AI replies presented as AI, no pretend microphone, no invented reference sources.
5. **Server-only secrets.** Keys stay out of client code and out of `NEXT_PUBLIC_*`.
6. **Do not rewrite deployment without reading `deploy.yml` first.** Do not overwrite GitHub secrets or the server's authorized keys.
7. **Verify, do not assume.** Run the checks above. For UI changes, test in a real browser.

## 9. Known issues and limitations

- Chat is rule-based, so unmatched requests get a clarifying prompt rather than an intelligent answer.
- Fonts use `next/font/google`. Builds need outbound network access to fetch them.
- The poster is fixed at 1080x1350 and long copy is not auto-shrunk (only the headline is fitted).
- The PNG exporter needs the fonts loaded; it awaits `document.fonts` but a slow connection could still produce a fallback font.
- The browser test suite (Playwright) that verified this work was ad hoc and is **not in the repo**. See next steps.

## 10. Where to work next

In priority order, matching the build phases:

1. **Gemini (Phase 2).** Add `app/api/creative-director/route.ts`. Accept `{ message, design }`, call Gemini server-side with a JSON response schema, validate the result, and map it to the existing `StudioAction` types (reuse `HEX_COLOR`, `fontPairs` ids, palette ids). Reject anything outside that whitelist. Fall back to `interpretRequest()` when no key is set, and label replies "Gemini" vs "Demo rules" truthfully in the UI. Cap input length. The success test is the demo in section 1: ask for one change, see only that property change, see the brief update.
2. **ElevenLabs (Phase 3).** Server route that issues a short-lived session credential so the key never reaches the browser, then a real microphone flow with genuine permission, listening, speaking, and transcript states. Keep text-only mode working when voice is unavailable.
3. **HTTPS and a domain.** Point a domain at the server and add TLS (certbot with the existing nginx).
4. **Put the browser tests in the repo** (`scripts/e2e/`, Playwright) and run them in CI.
5. **Real references.** Replace placeholders with legally usable assets or verified sources, with true attribution.
6. **SVG export, tablet collapsible panels, Auth0** (Auth0 last; the app must stay usable without login).
7. **Security hardening.** Rotate exposed credentials (section 6) and pin the SSH host key.

## Branch log

Newest at the bottom. Status: `in progress`, `PR open`, `merged`, `abandoned`.

| Branch | Created | Purpose | Status | Notes |
| --- | --- | --- | --- | --- |
| `main` | 2026-10-09 | Production. Auto-deploys to the Vultr server | live | Protected by convention: PRs only |
| `app-setup-1` | 2026-10-09 | Curio Labs workspace UI, CI checks, rollback-safe deploy, opencode LSP config | merged | PR #1, squash-merged |
| `handoff-and-env-setup` | 2026-10-09 | Add HANDOFF.md, branch-logging rule and script, and provision Gemini and ElevenLabs env vars | in progress | |
| `gemini-voice-integration` | 2026-10-09 | Wire Gemini (structured design edits) and ElevenLabs (speech-to-text, text-to-speech) into the app | in progress | Stacked on `handoff-and-env-setup` (not yet merged). Merge that first |
<!-- BRANCH-LOG-INSERT -->

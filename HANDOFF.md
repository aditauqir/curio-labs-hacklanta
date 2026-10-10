# Curio Labs: Handoff

Last updated: 2026-10-10

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

Live verification on 2026-10-10 (public HTTP API): Gemini is configured, the live status reports Whisper as the active transcriber, the public transcription endpoint returned the expected speech, and both PM2 processes are online. The browser mic still needs HTTPS.

| Area | Status |
| --- | --- |
| Three-panel workspace (director, canvas, inspiration) | Working |
| Three poster directions (Vintage Jazz, Modern Minimal, Experimental Editorial) | Working |
| Independent edits: headline, copy, accent, alignment, spacing, font pairing, palette | Working |
| Creative brief reflecting and editing the live design | Working |
| LocalStorage persistence with validation of stored data | Working |
| PostgreSQL persistence | Built on this branch. Anonymous instances have separate profiles, hashed passwords, workspace state, chat history, and files; the shared library seeds fonts, palettes, and references for Gemini context. No login UI yet. |
| PNG export (renders the same layout model as the screen) and brief JSON export | Working |
| Mobile layout (tabs: Director / Canvas / Inspiration) | Working |
| Chat replies | **Gemini** when `GEMINI_API_KEY` is set (replies labelled "Gemini"). Otherwise local keyword rules in `lib/demo-director.ts`, labelled "Demo rules". If Gemini fails, the UI falls back to the rules and says so. |
| Gemini integration | Built. `POST /api/creative-director`. Output is validated against whitelists and reconciled with the user's intent (see section 4). |
| Microphone (speech to text) | Built. The browser converts recordings to 16 kHz mono WAV, then `POST /api/voice/transcribe` uses local **Whisper** (`whisper.cpp`) first and **ElevenLabs** as fallback. Needs HTTPS or localhost (see section 5). |
| Spoken replies (text to speech) | Built. `POST /api/voice/speak`, ElevenLabs. Opt-in via the "Speak replies" toggle, and automatic for voice requests. Works over plain HTTP. |
| Visual reference cards | **Placeholders.** Original abstract art, no external sources. |
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
  studio-loader.tsx     Client wrapper: dynamic(..., { ssr: false }) because state restores from browser/database persistence
  studio-workspace.tsx  Header, mobile tabs, useReducer, database/local fallback persistence
  creative-director.tsx Left panel: chat UI, suggestion chips, microphone and spoken replies
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
app/api/
  status/route.ts             Which integrations are configured (booleans only). Uses connection() so it is not prerendered
  creative-director/route.ts  Gemini design edits. Validates input, rate limits, never returns upstream error text
  voice/transcribe/route.ts   Audio upload -> text (Whisper, ElevenLabs fallback)
  voice/speak/route.ts        Text -> MP3 (ElevenLabs), streamed
  workspace/route.ts           Anonymous instance workspace load/save
  instance/route.ts            Anonymous profile metadata and password hash updates
  files/route.ts, files/[id]   Instance-owned file upload, listing, download, delete
  assets/route.ts, assets/[id] Shared font/media library listing and token-gated ingestion
lib/ (server only: db.ts, instance.ts, instance-store.ts, library.ts, password.ts, gemini.ts, whisper.ts, elevenlabs.ts, transcribe.ts, rate-limit.ts, voice-error.ts)
  ai-patch.ts           AiPatch type, validatePatch(), reconcilePatch(), patchToActions(). Shared by server and client
  director-client.ts    Browser fetch for the director with a timeout
components/studio/use-voice.ts, use-capabilities.ts   Mic recording, playback, and server capability detection
scripts/new-branch.mjs  Creates a branch and logs it here (see Working agreement)
scripts/check-secrets.mjs  Fails if a credential-shaped string is in a committable file
```

### The key design decision

All edits go through one reducer. Each `StudioAction` changes only its own slice of `DesignState`, which is what makes "change the font and the colors stay put" true.
`StudioAction` is also the contract for AI: a Gemini response should be validated and mapped onto these same actions, never applied as raw state.

**AI output is untrusted.** The Gemini route never applies model output directly:
1. `validatePatch()` keeps only whitelisted ids, real `#RRGGBB` colors, and bounded plain text. Anything else is dropped and reported in `skipped`, which the UI shows.
2. `reconcilePatch()` enforces the user's intent in code, because the models ignore it otherwise. Probing showed they set `spacing` and claim direction changes even when told "keep the layout". If the user says to keep the layout, direction/alignment/spacing are removed and a requested direction becomes its palette and fonts. Values equal to the current design are dropped so the change chips only list real changes.
3. `patchToActions()` maps the result onto the same `StudioAction`s the manual controls use (order matters: direction, palette, fonts, colors, layout, copy).
4. The "changes" chips come from what was actually applied, not from the model's reply text.

`buildPoster()` is the single source of layout. The SVG on screen and the exported PNG both render its output, so they cannot drift apart.

## 5. Infrastructure and deploy

| Item | Value |
| --- | --- |
| Host | Vultr Cloud Compute, Ubuntu 26.04, `155.138.194.120` |
| SSH user | `linuxuser` (CI uses an SSH key; no password is used by automation) |
| App directory | `/var/www/curiolabs` (a git clone of this repo, tracks `main`) |
| Process manager | PM2, process name `curiolabs`, serves Next on `127.0.0.1:3000` |
| Offline transcription | PM2, process name `whisper`, `whisper.cpp` server on `127.0.0.1:8178`, `base.en` model in `/home/linuxuser/.curio-whisper` |
| Database | TigerData/Timescale PostgreSQL; connection string is in `/var/www/curiolabs/.env.local` only |
| Reverse proxy | nginx on :80 -> `127.0.0.1:3000`, config `/etc/nginx/sites-available/curiolabs` |
| Firewall | ufw: 22, 80, 443 open |

### Pipelines (`.github/workflows/`)

- **`ci.yml`**: runs on pull requests to `main`. Lint (zero warnings), typecheck, build, non-blocking `npm audit`.
- **`deploy.yml`**: runs on push to `main` (every merge) and manually. Job 1 lints, typechecks, and builds. Job 2 SSHes in, fast-forwards the server to `origin/main`, runs `npm ci` and `npm run build`, restarts PM2, and health-checks `127.0.0.1:3000`. If any step fails it restores the previous commit, rebuilds, and restarts. Job 3 checks the public URL. The separately installed `whisper` PM2 process is not rebuilt by application deploys.

### Microphone needs HTTPS (important)

Browsers only expose `getUserMedia` on **HTTPS or localhost**. The server is currently plain HTTP at `http://155.138.194.120/`, so on the live site the mic button is disabled and says why (that is the intended, honest behavior). Chat with Gemini and spoken replies still work over HTTP. To make the mic work in production you need a TLS certificate, which needs a hostname (a free `155-138-194-120.sslip.io` name works with Let's Encrypt, or use a real domain). Until then, test voice locally with `npm run dev` at `http://localhost:3000`.

### nginx upload size

nginx's default `client_max_body_size` is 1 MB. Voice clips are capped at 30 seconds (roughly 100 to 700 KB depending on browser codec), which fits, but raise the limit to `10m` in `/etc/nginx/sites-available/curiolabs` if you lengthen the cap. The API itself rejects audio over 8 MB.

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
| `ELEVENLABS_API_KEY` | Spoken replies, and backup speech-to-text | same as above |
| `WHISPER_URL`, `WHISPER_ENABLED` | Optional local Whisper URL and opt-out switch; defaults to `http://127.0.0.1:8178` and enabled | same as above |
| `DATABASE_URL` | TigerData/Timescale PostgreSQL connection string for anonymous instances, workspace state, chat, files, and the shared asset library | same as above |
| `LIBRARY_WRITE_TOKEN` | Optional server-only token required to upload shared font/media assets; reads remain available without it | same as above |
| `GEMINI_MODEL`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_STT_MODEL` | Optional model and voice overrides | same as above |
| GitHub Actions secrets | `VULTR_HOST`, `VULTR_USER`, `VULTR_SSH_KEY`, `VULTR_KNOWN_HOSTS` | GitHub repo settings. App keys are intentionally **not** here |

Gemini and ElevenLabs keys were checked against their APIs on 2026-10-09 and are now used by the app. `GET /api/status` reports which are configured (booleans only).

Keys are read only from `process.env` at runtime, never written in code. `npm run check:secrets` (part of `npm run check`, and a step in both CI workflows) fails the build if a credential-shaped string appears in any file git would commit. Gitignored files such as `.env.local` are skipped on purpose.

- Google Cloud project for Gemini: **Hacklanta 2**, project number `145508307041`.
- **Gemini model choice (measured, not assumed).** `gemini-2.5-flash` is listed by the API but is **retired for new keys** (404). `gemini-3.8-flash` took about 36 s for a trivial prompt and hung with `thinkingBudget:0`. The flash-lite models answer in about 1 s. Default chain is `gemini-3.5-flash-lite` then `gemini-flash-lite-latest` (an alias, so a retirement cannot break the app). Expect occasional latency spikes (one 7 s call was observed). Re-list models before relying on a name; they change.
- Whisper was built and smoke-tested on the Vultr server and locally with `whisper.cpp` `v1.9.5` and the `base.en` model. A 3.5-second clip transcribed in about 1.4 seconds on the server. `whisper-server` returns empty text for tested silence when started with `--suppress-nst`; the app also gates low-amplitude WAVs before inference.
- A new server needs the same `.env.local` created by hand. `git pull` will not bring it, by design.

**Security TODOs (the keys and the server password were shared in chat, so treat them as exposed):**
1. Rotate the Gemini key and the ElevenLabs key.
2. Rotate the `linuxuser` server password and consider disabling SSH password login, since CI uses key auth.
3. After rotating, update both `.env.local` files and restart PM2 with `pm2 restart curiolabs --update-env`.
4. Rotate the TigerData database credential because it was shared in chat, then update the server `.env.local` and restart PM2.

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

- Rate limits are in-memory per process (`lib/rate-limit.ts`): 20 director calls, 12 transcriptions, 20 speaks per client per minute, plus hourly global caps, to protect the paid keys on a public URL. They reset on restart and are not a substitute for auth. The client key comes from nginx's `X-Real-IP`.
- Voice recordings are capped at 30 seconds. Safari (mp4/m4a) and Firefox recording paths are implemented but were only tested in Chromium.
- Microphone permission errors were tested by throwing the same `DOMException` names browsers throw (`NotAllowedError`, `NotFoundError`, `NotReadableError`, `NotSupportedError`), because headless Chromium cannot show a real permission prompt.
- Without Gemini or voice keys, the app runs in demo mode and says so. Demo mode is keyword rules only, so unmatched requests get a clarifying prompt.
- Fonts use `next/font/google`. Builds need outbound network access to fetch them.
- The poster is fixed at 1080x1350 and long copy is not auto-shrunk (only the headline is fitted).
- The PNG exporter needs the fonts loaded; it awaits `document.fonts` but a slow connection could still produce a fallback font.
- The browser test suites (Playwright) that verified this work were ad hoc and are **not in the repo**. See next steps.
- Anonymous instance cookies identify a workspace but are not authentication. The future auth service must bind authenticated users to these instance records before exposing profile/password operations broadly.
- Instance files are capped at 10 MB and shared library assets at 25 MB. Library writes require `LIBRARY_WRITE_TOKEN` until the auth service exists.

## 10. Where to work next

In priority order, matching the build phases:

1. **HTTPS and a hostname** so the mic works in production (section 5).
2. **Put the browser and API tests in the repo** (`scripts/e2e/`, Playwright) and run them in CI. The Gemini and voice suites covered: keep-layout enforcement, hostile model output, fallback on outage and 429, full voice loop with a fake microphone, permission errors, silence, rate limiting, and key-leak scans.
3. **Connect the future auth service** to `curio_instance_id` and gate profile/password operations and library writes by authenticated identity.
4. **Gemini editing quality.** Add more intents (font size, copy rewrites, multi-step requests) and few-shot examples. Consider streaming the reply.
5. **Real references.** Replace placeholders with legally usable assets or verified sources, with true attribution.
6. **SVG export, tablet collapsible panels, Auth0** (Auth0 last; the app must stay usable without login).
7. **Security hardening.** Rotate exposed credentials (section 6) and pin the SSH host key.

## Branch log

Newest at the bottom. Status: `in progress`, `PR open`, `merged`, `abandoned`.

| Branch | Created | Purpose | Status | Notes |
| --- | --- | --- | --- | --- |
| `main` | 2026-10-09 | Production. Auto-deploys to the Vultr server | live | Protected by convention: PRs only |
| `app-setup-1` | 2026-10-09 | Curio Labs workspace UI, CI checks, rollback-safe deploy, opencode LSP config | merged | PR #1, squash-merged |
| `handoff-and-env-setup` | 2026-10-09 | Add HANDOFF.md, branch-logging rule and script, and provision Gemini and ElevenLabs env vars | merged | Carried into main by PR #2 (it was the base of `gemini-voice-integration`) |
| `gemini-voice-integration` | 2026-10-09 | Wire Gemini (validated design edits), OpenAI/ElevenLabs speech-to-text, and ElevenLabs spoken replies into the app | merged | PR #2, squash-merged as `3fbdc3c`. Also carried `handoff-and-env-setup`. Deployed and verified live |
| `offline-whisper-stt` | 2026-10-10 | Replace the OpenAI API transcription path with offline Whisper (whisper.cpp) running on the Vultr server; flow is Whisper -> Gemini -> ElevenLabs | merged | PR #3, squash-merged as `1ac666d`; deployed and verified live |
| `handoff-whisper-merged` | 2026-10-10 | Mark the offline Whisper branch merged and record its live deployment | in progress | |
| `persist-user-instances` | 2026-10-10 | Persist anonymous user instances, profiles, workspace state, chat history, and associated files in PostgreSQL | in progress | |
<!-- BRANCH-LOG-INSERT -->

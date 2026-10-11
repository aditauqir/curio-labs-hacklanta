# Curio Labs: Handoff

Last updated: 2026-10-11

Read this first. It is the single source of truth for where the project stands and where to work next.
If you create a branch, you must also log it in the [Branch log](#branch-log). See [Working agreement](#working-agreement).

## 1. What this is

**Curio Labs** is an AI creative director for small businesses, artists, and designers.
Tagline: "From vague ideas to visual direction."

It does not generate finished artwork. It helps a user explore directions, pick type and color, and refine an editable poster through conversation.
The core idea is **Visual Consensus**: vague preferences become explicit design decisions (the creative brief) that the user can approve, reject, or edit, and the brief is the same state that drives the live canvas.

The demo we are building toward: three distinct poster directions -> user asks for one specific change -> only that property changes -> the brief updates -> export works.

## 2. Current state

Live at **https://idkjustmakeitlookgood.gay/** and **https://155-138-194-120.sslip.io/**. Deployed from `main` on every merge.

Live verification on 2026-10-10: Gemini and ElevenLabs returned successful responses, Whisper is online on the server, HTTPS is active, and the browser reports a secure context with the microphone control enabled. Local verification also confirmed the wireframe start screen and Gemini coaching tool loop.

| Area | Status |
| --- | --- |
| Start, director, and full editor screen states | Working locally. The start/home screen gathers an idea at `/home`, the director screen owns the conversation, and the full editor is at `/app` with a dark surface combining the director, live poster, vertical tools, properties drawer, and optional references inspector. |
| Entry route | Working locally. The apex `/` redirects to `/home`; a fresh direct `/app` visit now opens the same start screen before entering the canonical `/app` workspace; the home flow enters the full app at `/app`, the app-subdomain root rewrites to `/app`, and `/director` plus `/editor` remain direct aliases. Live `app.` DNS/nginx/TLS is still pending. The supplied Curio Labs wordmark image is now the browser/app icon. |
| Onboarding/editor visual workflow | Working locally. The wireframe-led start screen uses `voice_key1.svg` as the mascot, a lighter full-bleed supplied landscape scene with a denser ASCII Magic-inspired character-ramp overlay, a focal-point prompt positioned just below the vertical center, smaller high-contrast typography with local glyph-level blur, and a crisp prompt placeholder with no text shadow. The synthetic white prompt underline and voice waveform bars were removed; microphone activity now keeps only the surrounding glow/orb. Bundled Redaction 35 is used for the main thought heading, with a centered LT Superior Serif Curio Labs wordmark, white Neue Montreal recent-project text, Gemini-backed starter chips with a static fallback, and the `loading-dev` Leap loading shell. The mascot is positioned as part of the hero flow so its speaking animation does not overlap the heading. The white card surface, “Edit and ready” action, and redundant chat/voice button are removed while real start/director/editor transitions remain intact; the right rail is limited to recent/demo projects and is vertically centered on the right side. The editor’s Vintage Jazz poster now has a stronger warm composition with a structured accent panel, vertical marker, layered ring motif, and improved spacing. The mascot container is transparent, and all five supplied mascot frames rotate through a randomized timed loop while speaking. |
| Unified editor workspace (director, canvas, optional inspiration) | Working locally at `/app`. The editor is one desktop workspace surface matching the refined supplied composition: a rounded black Chatbox area on the left, live poster and vertical tools in the center, and a compact right-aligned Reference plus Layers dock on the right by default. The former stacked panes, workspace tab strip, and freeform board are gone. The surface has a document header, artboard grid, left tool rail, inspector, properties drawer, quiet document status bar, user-facing copy that hides provider/database implementation details, a compact Brief → Concept → References → Compose → Refine workflow rail, AICSS thinking/streaming presentation for director responses, and a desktop-only `voice-glow` beam around the chat composer. The Reference rail now uses the supplied simple 2×2 study-tile treatment with active font names right-aligned above a visible Layers dock; reference tiles retain source links. Header Editor actions plus Canvas tools, text actions, and Inspire/Restyle/Shuffle/Layers/Export actions now share a floating-button-group interaction with one morphing hover highlight, pressed states, separators, tooltips, and keyboard navigation. Internal voice/canvas status copy, provider labels, recording/live dots, and saved-state chrome are hidden from the product surface while accessible announcements and actual controls remain. Decorative editor borders, divider rules, tile strokes, button outlines, and the poster metadata strip are removed so the chat, canvas, inspector, and overlays read as one cohesive surface; functional poster selection handles remain. The right inspector still supports full Layers and Reference views; the Layers view exposes the live poster stack while Reference preserves the active poster's brief context. Manual editor actions now work on the SVG poster: select layers, drag to move, drag corner handles to scale, edit X/Y/scale/rotation/opacity, hide/show, lock/unlock, edit text through the Text tool or double-click, and Delete to hide the selected layer. Exports include the current transforms and visibility in PNG/JPG/PSD/JSON output, and poster edits persist in local/TigerData workspace state. The implementation uses pointer capture and reducer-backed layer state rather than embedding tldraw, Compositor, or GIMP; it follows the practical layer/transform/text interaction model described by [Compositor](https://github.com/robbietilton/Compositor). The editor uses fluid columns without a top-level viewport aspect-ratio lock, and all voice mascot frames are rendered white. |
| Three poster directions (Vintage Jazz, Modern Minimal, Experimental Editorial) | Working |
| Independent edits: headline, copy, accent, alignment, spacing, font pairing, palette | Working |
| Creative brief reflecting and editing the live design | Working |
| LocalStorage persistence with validation of stored data | Working |
| PostgreSQL persistence | Working. Anonymous instances have separate profiles, hashed passwords, workspace state, chat history, and files; the shared library seeds fonts, palettes, and references for Gemini context. |
| Design-principles source of truth | Working. The two supplied PDFs are represented in TigerData by two source records, 240 bounded extracts/curated clips (including 224 text-page extracts from *How Posters Work*), and two searchable document assets. Gemini retrieves relevant clips for each design brief; the raster-only grid PDF is explicitly marked as manual visual notes. |
| Account sessions and ownership | Built on `user-persistence-refresh`; local checks, a real TigerData smoke test, and production API verification pass. |
| PNG export (renders the same layout model as the screen) and brief JSON export | Working |
| Poster export formats | Working locally. PNG and JPG are raster exports; PSD is a real layered Photoshop-compatible document with background, graphics, and typography layers. |
| Narrow viewport behavior | Intentionally desktop-first. The three-pane editor composition remains in place; mobile tabs are not part of the product surface. |
| Viewport behavior | Working locally. The document and all top-level screens are locked to `100dvh` with no page scroll; long chat, inspiration, and canvas content stays inside its own panel. |
| Chat replies | **Gemini** when `GEMINI_API_KEY` is set (replies labelled "Gemini"). Otherwise local keyword rules in `lib/demo-director.ts`, labelled "Demo rules". If Gemini fails, the UI falls back to the rules and says so. |
| Gemini integration | Built. `POST /api/creative-director` returns validated reducer patches and receives relevant design-principles clips from TigerData for each request. The server injects `data/gemini/whoami.md` and `taste.json`, sends current poster geometry/transforms, and accepts validated `layerEdits` for exact canvas ids so requests such as “use this font” or “move the headline right” apply through the same reducer as manual editing. `POST /api/creative-coach` performs a Gemini function-call round trip into the TigerData library and receives the same principles context before returning placement feedback. |
| Microphone (speech to text) | Built. The browser converts recordings to 16 kHz mono WAV, then `POST /api/voice/transcribe` uses local **Whisper** (`whisper.cpp`) first and **ElevenLabs** as fallback. Production microphone access is enabled over HTTPS. |
| Spoken replies (text to speech) | Built. `POST /api/voice/speak`, ElevenLabs. Director replies speak automatically whenever ElevenLabs is configured; voice requests also speak automatically. Default voice is `ZoiZ8fuDWInAcwPXaVeq`; `ELEVENLABS_VOICE_ID` can override it. Works over plain HTTP. |
| Visual reference cards | Working locally. 31 distinct Pinterest poster searches are source-linked in the inspiration rail; Curio renders original abstract thumbnails rather than copying remote poster images. |
| Auth0 | Not built. App is open, no login. |
| SVG export | Not built. |
| Tablet collapsible panels | Not built. Tablet reuses the mobile tabs. |
| HTTPS / custom domain | Working for the apex and `www`; the app subdomain still needs its DNS A record and certificate expansion before it is live. See the nginx caveat in section 9. |

## 3. Stack

Next.js 16 (App Router, Turbopack, `cacheComponents` on), React 19, TypeScript (strict), Tailwind CSS 4, shadcn/ui source components backed by Radix, npm. The poster itself stays a reducer-driven SVG for crisp text/export performance; PhotoCraft was evaluated as a Rust/WebAssembly GPU image editor, but is not bundled into the poster path. Hosted on a Vultr VPS, not Vercel.

**Next.js 16 has breaking changes versus older versions.** Read the matching guide in `node_modules/next/dist/docs/` before writing Next-specific code (see `AGENTS.md`).
`LayoutProps` is a generated global type. A bare `tsc` fails on a clean checkout, so always use `npm run typecheck`, which runs `next typegen` first.

## 4. Code map

```
app/
  layout.tsx            Loads Inter, Space Grotesk and the poster fonts via next/font; bundled Neue Montreal, Apfel Grotezk, and Redaction 20 assets load from globals.css; declares the Curio Labs app icons
  icon.png              Supplied 200×200 Curio Labs wordmark used as the browser favicon and app icon
  page.tsx              Apex redirects to /home; proxy.ts rewrites the app-subdomain root to /app
  proxy.ts              Keeps the app-subdomain root at / while rendering the canonical /app home internally
  home/page.tsx          Addressable start/home screen at /home
  app/page.tsx           Canonical full editor at /app
  director/page.tsx      Addressable director screen at /director
  editor/page.tsx        Addressable full editor at /editor
  globals.css           Tailwind import, neutral UI palette tokens, bundled font faces, no-scroll onboarding treatment, desktop VoiceBeam styling, and Layers/Reference inspector chrome
components/studio/
  onboarding-studio.tsx Client home prompt, Gemini starter chips, microphone level orb, and onboarding transitions
  studio-loader.tsx     Client wrapper: dynamic(..., { ssr: false }) because state restores from browser/database persistence
  studio-workspace.tsx  `/home` start flow and `/app` editor states, single three-pane editor surface, useReducer, database/local fallback persistence
  creative-director.tsx Left panel: chat UI, suggestion chips, microphone, spoken replies, and desktop VoiceBeam composer effect
  ThinkingState.tsx, StreamingText.tsx  AICSS-installed thinking and assistant-output presentation components
components/ui/floating-button-group.tsx  Shared floating toolbar with morphing highlight, pressed states, separators, tooltips, and keyboard navigation
  studio-inspector.tsx, layers-panel.tsx  Right-side compact Reference/2×2 study tiles/Layers dock plus full live poster layer list
  design-canvas.tsx     Unified poster surface: direction switch, Select/Text tools, pointer-driven layer transforms, direct text editing, font pairing, visibility/lock/delete controls, properties drawer, Gemini/TigerData coach, and functional canvas action pill
  poster.tsx            Renders the poster as real SVG elements from the layout model with selection, drag, scale-handle, and keyboard interactions
  inspiration-board.tsx Right panel shell, reference thumbnails
  creative-brief.tsx    Editable brief rows
  typography-selector.tsx, color-palette-selector.tsx, export-controls.tsx, ui.tsx, icons.tsx
lib/
  host-routing.ts       App-subdomain detection and base/app host navigation helpers
  design-types.ts       DesignState, ChatMessage, PersistedStudioState
  design-presets.ts     Font pairs, palettes, direction configs, applyDirection(), initial design
  poster-layout.ts      buildPoster(design) -> shapes and texts. Shared by the SVG poster and the PNG exporter
  design-state.ts       studioReducer, StudioAction, getBrief(), sanitizeState() for untrusted stored data
  demo-director.ts      interpretRequest(): local rule engine that returns StudioAction[]
  storage.ts            LocalStorage load/save (key: studio-workspace-v1)
  export.ts             PNG/JPG/PSD export plus brief JSON export with poster transforms and visibility
  instance-store.ts     Anonymous workspace persistence, including poster layer edits
app/api/
  status/route.ts             Which integrations are configured (booleans only). Uses connection() so it is not prerendered
  onboarding-suggestions/route.ts Gemini-generated home starter chips with rate limiting and fallback-safe errors
  creative-director/route.ts  Gemini design edits. Validates input, rate limits, never returns upstream error text
  creative-coach/route.ts     Gemini visual coaching with a TigerData library search tool
  voice/transcribe/route.ts   Audio upload -> text (Whisper, ElevenLabs fallback)
  voice/speak/route.ts        Text -> MP3 (ElevenLabs), streamed
  workspace/route.ts           Anonymous instance workspace load/save
  instance/route.ts            Anonymous profile metadata and password hash updates
  files/route.ts, files/[id]   Instance-owned file upload, listing, download, delete
  assets/route.ts, assets/[id] Shared font/media library listing and token-gated ingestion
public/
  home-landscape.png          Supplied light landscape reference used as the full-bleed home screen scene
  home-ascii-overlay.svg      Dense local ASCII Magic-inspired character-ramp texture layered over the home scene
  fonts/Redaction35-*.otf      Bundled Redaction 35 faces used by the home thought heading
  fonts/LTSuperiorSerif-*.otf Bundled LT Superior Serif faces used by the Curio Labs wordmark
data/design-principles.json    Source metadata and curated clips for the two supplied design PDFs
data/gemini/whoami.md          Curio-specific Gemini identity and operating contract
data/gemini/taste.json         Machine-readable Curio design rubric and canvas edit policy
data/gemini/system-prompt.md   Copy/paste system prompt for the Gemini backend implementation
data/gemini/response.schema.json Structured response contract for the friend-owned Gemini backend
lib/ (server only: db.ts, instance.ts, instance-store.ts, library.ts, password.ts, gemini.ts, whisper.ts, elevenlabs.ts, transcribe.ts, rate-limit.ts, voice-error.ts)
  ai-patch.ts           AiPatch type, validatePatch(), reconcilePatch(), patchToActions(). Shared by server and client
  poster-editor.ts      Bounded non-destructive layer transforms and visibility/lock state for the SVG editor
  knowledge.ts          Search and compact retrieval context for the TigerData design-principles corpus
  director-client.ts    Browser fetch for the director with a timeout
  coach-client.ts       Browser fetch for the Gemini/TigerData coaching route
components/studio/use-voice.ts, use-capabilities.ts   Mic recording, playback, and server capability detection
components/ui/             shadcn/ui source primitives used by the workflow
scripts/new-branch.mjs  Creates a branch and logs it here (see Working agreement)
scripts/check-secrets.mjs  Fails if a credential-shaped string is in a committable file
scripts/add-domain-ssl.sh  Server-side: add a domain to nginx and expand the Let's Encrypt certificate
scripts/fix-nginx-server-names.sh  Server-side: repair duplicate server_name declarations
scripts/nginx-server-names.mjs     The pure rewrite behind it, with tests alongside
scripts/import-design-principles.mjs  Idempotent PDF extract/clip import into TigerData (`npm run design-principles:import`)
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
| Reverse proxy | nginx on :80 (redirect) and :443 (TLS) -> `127.0.0.1:3000`, config `/etc/nginx/sites-available/curiolabs` |
| Domain | `idkjustmakeitlookgood.gay`; apex and `www` are A records pointing at the server. Planned app host: `app.idkjustmakeitlookgood.gay`. No AAAA record, so Let's Encrypt validates over IPv4 |
| Firewall | ufw: 22, 80, 443 open |

### Pipelines (`.github/workflows/`)

- **`ci.yml`**: runs on pull requests to `main`. Lint (zero warnings), typecheck, build, non-blocking `npm audit`.
- **`deploy.yml`**: runs on push to `main` (every merge) and manually. Job 1 lints, typechecks, and builds. Job 2 SSHes in, fast-forwards the server to `origin/main`, runs `npm ci` and `npm run build`, restarts PM2, and health-checks `127.0.0.1:3000`. If any step fails it restores the previous commit, rebuilds, and restarts. Job 3 checks the public URL. The separately installed `whisper` PM2 process is not rebuilt by application deploys.

### Production microphone access

The live site uses `https://idkjustmakeitlookgood.gay/` (and still `https://155-138-194-120.sslip.io/`), with a Let's Encrypt certificate managed by Certbot. Browsers can now expose `getUserMedia`; users still need to grant microphone permission in the browser. The direct IP remains available over plain HTTP and is deliberately not redirected, because it has no certificate of its own.

### Adding another domain

`scripts/add-domain-ssl.sh` runs on the server, adds the names to nginx and expands the existing certificate rather than issuing a second one. It is a dry run unless given `--apply`; **read the diff before applying**. Point the name at the server with an A record first, or the Let's Encrypt HTTP challenge fails. For the studio host, use `DOMAINS='app.idkjustmakeitlookgood.gay' bash scripts/add-domain-ssl.sh --apply` after DNS propagates.

`scripts/fix-nginx-server-names.sh` repairs the case where a name ends up declared in more than one block for the same port. The rewrite it uses lives in `scripts/nginx-server-names.mjs` and is covered by `npm run test:unit`.

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
npm run test:unit   # node:test unit tests for scripts/
npm run test:e2e    # Playwright browser and API suite
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

- **Open on the server:** `idkjustmakeitlookgood.gay` and `www.idkjustmakeitlookgood.gay` are each declared in two `:80` blocks and the apex is also in a `:443` catch-all, so `nginx -t` logs `conflicting server name ... ignored`. nginx keeps the first declaration, which puts the apex in certbot's redirect block where it falls through to `return 404`. Effect: **`http://idkjustmakeitlookgood.gay/` returns 404 instead of redirecting.** HTTPS is unaffected and correct on all three names. Fix with `bash scripts/fix-nginx-server-names.sh --apply` on the server; it is not applied by deploys, which never touch nginx config.
- Rate limits are in-memory per process (`lib/rate-limit.ts`): 20 director calls, 12 transcriptions, 20 speaks per client per minute, plus hourly global caps, to protect the paid keys on a public URL. They reset on restart and are not a substitute for auth. The client key comes from nginx's `X-Real-IP`.
- Voice recordings are capped at 30 seconds. Safari (mp4/m4a) and Firefox recording paths are implemented but were only tested in Chromium.
- Microphone permission errors were tested by throwing the same `DOMException` names browsers throw (`NotAllowedError`, `NotFoundError`, `NotReadableError`, `NotSupportedError`), because headless Chromium cannot show a real permission prompt.
- Without Gemini or voice keys, the app runs in demo mode and says so. Demo mode is keyword rules only, so unmatched requests get a clarifying prompt.
- The Tiger MCP connection currently reports stale `tsdbadmin` credentials, but the app's existing server-side `DATABASE_URL` successfully applied and verified the design-principles import. No database credential was rotated.
- `npm run check` passes. A production build is still environment-blocked here: Turbopack hits a worker/process permission panic, while the webpack fallback reaches the existing Google `next/font` Cormorant loader and fails while fetching/parsing the font stylesheet; neither failure points at the knowledge or Gemini changes.
- Fonts use `next/font/google`. Builds need outbound network access to fetch them.
- The poster is fixed at 1080x1350 and long copy is not auto-shrunk (only the headline is fitted).
- The PNG exporter needs the fonts loaded; it awaits `document.fonts` but a slow connection could still produce a fallback font.
- The committed Playwright suite covers the public API contracts, no-database fallback, onboarding, start-to-director-to-editor navigation, mobile workspace, local director edits, a mocked Gemini-to-editor patch, panel switching, JSON export, JPG/PSD export, and warm tooltips. Voice hardware and production Gemini/Whisper flows still need separate integration coverage.
- Anonymous instance cookies identify a workspace but are not authentication. The future auth service must bind authenticated users to these instance records before exposing profile/password operations broadly.
- Instance files are capped at 10 MB and shared library assets at 25 MB. Library writes require `LIBRARY_WRITE_TOKEN` until the auth service exists.

## 10. Where to work next

In priority order, matching the build phases:

1. **Merge and deploy `tldraw-voice-onboarding`.** The branch contains the verified manual editor pass, improved warm Vintage Jazz canvas, transparent mascot container, and randomized five-frame speaking loop. Review the `/home` start flow into the `/app` editor, director, Gemini/TigerData coach, and PNG/JPG/PSD export flows before promoting it to `main`; do not push directly to `main`.
2. **Canonical editor is `/app`.** Keep `/home` as the start screen and do not add another editor route unless the user asks.
3. **Gemini editing quality.** Add more intents (font size, copy rewrites, multi-step requests) and few-shot examples. Consider streaming the reply. The friend implementing the Gemini backend should preserve `data/gemini/system-prompt.md` and the `layerEdits` semantics.
4. **Reference depth.** Replace or supplement the 31 source-linked Pinterest searches with legally usable, verified assets when licensing/attribution requirements are settled.
5. **SVG export, tablet collapsible panels, Auth0** (Auth0 last; the app must stay usable without login).

## Branch log

Newest at the bottom. Status: `in progress`, `PR open`, `merged`, `abandoned`.

| Branch | Created | Purpose | Status | Notes |
| --- | --- | --- | --- | --- |
| `main` | 2026-10-09 | Production. Auto-deploys to the Vultr server | live | Protected by convention: PRs only |
| `app-setup-1` | 2026-10-09 | Curio Labs workspace UI, CI checks, rollback-safe deploy, opencode LSP config | merged | PR #1, squash-merged |
| `handoff-and-env-setup` | 2026-10-09 | Add HANDOFF.md, branch-logging rule and script, and provision Gemini and ElevenLabs env vars | merged | Carried into main by PR #2 (it was the base of `gemini-voice-integration`) |
| `gemini-voice-integration` | 2026-10-09 | Wire Gemini (validated design edits), OpenAI/ElevenLabs speech-to-text, and ElevenLabs spoken replies into the app | merged | PR #2, squash-merged as `3fbdc3c`. Also carried `handoff-and-env-setup`. Deployed and verified live |
| `offline-whisper-stt` | 2026-10-10 | Replace the OpenAI API transcription path with offline Whisper (whisper.cpp) running on the Vultr server; flow is Whisper -> Gemini -> ElevenLabs | merged | PR #3, squash-merged as `1ac666d`; deployed and verified live |
| `handoff-whisper-merged` | 2026-10-10 | Mark the offline Whisper branch merged and record its live deployment | merged | PR #4; deployed and verified live |
| `persist-user-instances` | 2026-10-10 | Persist anonymous user instances, profiles, workspace state, chat history, and associated files in PostgreSQL | merged | PR #5; production database smoke-tested |
| `asset-suggestion-reliability` | 2026-10-10 | Ensure Gemini surfaces exact shared library asset suggestions | merged | PR #6; production Gemini asset suggestion smoke-tested |
| `handoff-database-verified` | 2026-10-10 | Record merged persistence and asset suggestion verification | merged | PR #7 |
| `handoff-asset-library-merged` | 2026-10-10 | Record handoff verification branch merge | merged | PR #8; README and submission documentation deployed |
| `handoff-readme-merged` | 2026-10-10 | Record README architecture and submission documentation merge | merged | PR #9 |
| `committed-browser-api-tests` | 2026-10-10 | Add committed Playwright browser and API coverage | in progress | |
| `user-persistence-refresh` | 2026-10-10 | Add user identity and reliable workspace refresh persistence | merged | PR #11; deployed and production API verification passes |
| `https-mic-access` | 2026-10-10 | Enable HTTPS for production microphone access | merged | Server nginx and Let's Encrypt configured; live HTTPS verified |
| `ssl-cert` | 2026-10-10 | Add HTTPS for the custom domain `idkjustmakeitlookgood.gay` and clean up the duplicate nginx `server_name` entries it introduced | in progress | |
| `tldraw-voice-onboarding` | 2026-10-10 | Add start/director/editor screen states, Compositor-inspired editor chrome, supplied voice keyframes, Gemini-to-editor handoff, and multi-format exports | merged | PR #14 merged to `main`; the first production workflow run exposed stale E2E expectations for the current desktop flow; follow-up fix is on `e2e-current-flow` |
| `e2e-current-flow` | 2026-10-11 | Align production E2E tests with the current home-to-app desktop flow | PR open (#15) | Updated route, desktop workspace, editor-property, and reference-panel assertions; all 17 local E2E tests pass; PR #15 is open and production deploy is pending merge |
<!-- BRANCH-LOG-INSERT -->

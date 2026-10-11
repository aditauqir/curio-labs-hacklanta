# Curio Labs: Handoff

Last updated: 2026-10-11

Latest UI refinement: the editor chat rail uses square outer corners to match the supplied reference, and the bottom toolbar's Layers control is icon-only with a tooltip.

Latest editor behavior: the Layers inspector now supports persistent up/down reordering for non-background layers, and its compact surface uses the same #0c0c0c background as the surrounding inspector.

Latest zoom behavior: pinch/trackpad zoom is scoped to the grid stage; the editor shell prevents browser page zoom outside that stage and remains locked to the viewport height.

Latest editing behavior: Meta/Ctrl Z, Meta/Ctrl Shift Z, and Ctrl Y now use the editor's bounded history, and the left canvas rail includes a reducer-backed color palette picker with four swatch sets.

Latest action behavior: Reset design, project Reset, selected-layer Hide, and Save now open the shared shadcn Dialog surface with action-specific copy, Cancel, and confirm buttons; destructive actions remain reversible where the editor already preserves the layer/project state.

Latest chat alignment: assistant responses sit on the left gutter of the editor chat rail, and user prompts sit on the right gutter with the same bounded message width.

Latest voice composer behavior: the active microphone becomes a white control with a black icon, a separate red stop control cancels recording without transcription, and the composer is reduced to a 2.5rem-high bar.

Latest canvas height behavior: the editor grid now fills the complete working column down to the document status bar; the bottom action tray overlays the grid instead of consuming a separate row, so no detached gray gap appears above the footer.

Latest composer refinement: the quick suggestion is centered with the curved arrow affordance on its left, and the chat composer/footer has a shorter vertical footprint while preserving the working microphone, cancel, and send controls.

Latest toolbar alignment behavior: the floating toolbar highlight is anchored to the tray origin before applying measured button coordinates, keeping the Layers and other pressed/hover states directly aligned with their icons.

Latest CI verification: the desktop E2E suite now follows the canonical `/app` editor landmarks and current canvas action bar; local checks pass all 18 browser tests after the production workflow exposed stale selectors.

Next contributor handoff: [Gemini workflow PR handoff](GEMINI_WORKFLOW_PR_HANDOFF.md) contains the data-grounding/tuning scope, evaluation requirements, safety boundaries, and PR sign-off checklist for the next Gemini-quality pass.

Gemini merge priority: conflicts in the intelligence/data layer must be resolved manually in favor of preserving the server-only Gemini path, structured patch validation, knowledge retrieval, and `data/gemini/*`; UI code should adapt around those contracts rather than deleting or bypassing them.

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

Live verification on 2026-10-11: Gemini and ElevenLabs returned successful responses, Whisper is online on the server, HTTPS is active, and the browser reports a secure context with the microphone control enabled. Local verification also confirmed the wireframe start screen, Gemini coaching tool loop, and the reference-aligned editor chat response actions.

| Area | Status |
| --- | --- |
| Start, director, and full editor screen states | Working locally. The start/home screen gathers an idea at `/home`, the director screen owns the conversation, and the full editor is at `/app` with a dark surface combining the director, live poster, vertical tools, properties drawer, and optional references inspector. |
| Entry route | Working locally. The apex `/` redirects to `/home`; a fresh direct `/app` visit now opens the same start screen before entering the canonical `/app` workspace; the home flow enters the full app at `/app`, `/director` redirects to `/app`, and `/editor` remains a direct alias. The product stays on the apex hostname; the unused `app.` host is no longer generated by navigation. The supplied Curio Labs wordmark image is now the browser/app icon. |
| Onboarding/editor visual workflow | Working locally. The wireframe-led start screen uses `voice_key1.svg` as the mascot, a lighter full-bleed supplied landscape scene with a denser ASCII Magic-inspired character-ramp overlay, a focal-point prompt positioned just below the vertical center, smaller high-contrast typography with local glyph-level blur, and a crisp prompt placeholder with no text shadow. The synthetic white prompt underline and voice waveform bars were removed; microphone activity now keeps only the surrounding glow/orb. Bundled Redaction 35 is used for the main thought heading, with a centered LT Superior Serif Curio Labs wordmark, white Neue Montreal recent-project text, Gemini-backed starter chips with a static fallback, and the `loading-dev` Leap loading shell. The mascot is positioned as part of the hero flow so its speaking animation does not overlap the heading. The white card surface, “Edit and ready” action, and redundant chat/voice button are removed while real home-to-app/editor transitions remain intact; the right rail is limited to recent/demo projects and is vertically centered on the right side. The editor’s Vintage Jazz poster now has a stronger warm composition with a structured accent panel, vertical marker, layered ring motif, and improved spacing. The mascot container is transparent, and all five supplied mascot frames rotate through a randomized timed loop while speaking. |
| Unified editor workspace (director, canvas, optional inspiration) | Working locally at `/app`. The editor now follows the supplied desktop composition: the full-height black Chatbox owns the left `clamp(18rem, 24vw, 24rem)` column, the canvas owns the remaining surface with a centered project header, Phosphor home control aligned over the tool rail, and compact PNG format selector, the default right Reference inspector is open, the extra canvas header/edit strip is hidden, and the expanded icon-only vertical tool rail plus floating icon actions remain visible around the poster. The rail now mirrors the supplied editor reference with selection, lasso, review, resize/properties, layer edit, hide, copy, palette, text, hand, zoom, and reset controls, all with Phosphor icons and tooltips. The vertical tool rail uses stable per-button active/hover backgrounds rather than the shared animated highlight, preventing detached gray blocks when moving between tools. Rectangle and lasso tools now draw live SVG marquees and select intersecting poster layers; Hand pans the scrollable stage; trackpad pinch and two-finger touch pinch now zoom the canvas between 50% and 300%; Resize enters a real non-destructive scale interaction; Eraser hides layers; Dropper samples poster colors; Fill changes the background through the reducer; and the bottom Undo/Redo controls use a bounded 50-step reversible state history. The editor flex chain now keeps the canvas and rail at full available height instead of collapsing into a chopped strip. Tool selection and edits follow a GIMP-style non-destructive layer/undo model without rasterizing the SVG source. Response rows are now bounded to the chat rail so left-aligned assistant cards keep a safe inline gutter instead of clipping at the viewport edge, while user prompts remain right aligned with a fixed gutter. The former stacked panes, workspace tab strip, and freeform board are gone. The surface has a document header without the redundant Curio Labs brand block, artboard grid, left tool rail, inspector, properties drawer, quiet document status bar, user-facing copy that hides provider/database implementation details, a compact Brief → Concept → References → Compose → Refine workflow rail, left-aligned response cards with right-aligned user prompts and compact padding, rounded low-contrast applied-change pills, AICSS thinking/streaming presentation, like/dislike/start-from-here actions, and one low-contrast pulsing suggestion prompt. The chat composer now keeps the `loading-dev` Wave indicator inside the input window instead of rendering it as a chat message, and the microphone has an explicit dark-surface hover highlight. The left chat rail explicitly consumes the full viewport height, and `/director` uses the same continuous dark full-height chat composition. The Reference and Layers inspector panes are independent: either can be shown alone, or both split the right editor column evenly; the bottom toolbar uses the shared FloatingButtonGroup component with a visible Layers label, compact Reference/sidebar actions, reset, undo/redo, editing, inspiration, restyle, shuffle, Save, and export controls. The Save action uses the same validated local/TigerData workspace persistence as autosave. Its morphing highlight sits above the tray surface, follows hover/focus, and returns to the pressed panel after pointer leave. The compact Reference dock is divided into Fonts, References, and Textures, with active font names right-aligned and reference tiles retaining source links. The editor exposes three curated font pairings, and destructive poster actions are represented as reversible layer state: transforms, opacity, visibility, locks, and text edits remain separate from the poster source while Delete hides a layer. Canvas actions use Phosphor icons with tooltips. Internal voice/canvas status copy, provider labels, recording/live dots, and saved-state chrome are hidden from the product surface while accessible announcements and actual controls remain. Decorative editor borders, divider rules, tile strokes, button outlines, and the poster metadata strip are removed so the chat, canvas, inspector, and overlays read as one cohesive surface; functional poster selection handles remain. Manual editor actions now work on the SVG poster: select layers, drag to move, drag corner handles to scale, edit X/Y/scale/rotation/opacity, hide/show, lock/unlock, edit text through the Text tool or double-click, and Delete to hide the selected layer. Exports include the current transforms and visibility in PNG/JPG/PSD/JSON output, and poster edits persist in local/TigerData workspace state. The editor uses fluid columns without a top-level viewport aspect-ratio lock, and all voice mascot frames are rendered white. |
| Image reference import | Working locally. The start screen and editor header expose the Phosphor Import image control; files can be dropped anywhere on the app, are sent to `POST /api/image-import`, analyzed by Gemini, previewed in Reference, and turned into the initial editor prompt plus three actionable suggestions. |
| Poster sizes | Working locally. The editor header offers Social `1080 × 1350`, Letter `2550 × 3300`, and A4 `2480 × 3508`; the choice is reducer-backed, persisted with the design, shown in document metadata, and used for PNG/JPG/PSD export dimensions. |
| Conversation branching | Working locally. Every assistant response stores a validated design, palette, and poster-edit checkpoint. “Start from here” restores that checkpoint, removes all later messages, and uses the selected response as the next request's history anchor. |
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
| Chat replies | **Gemini** when `GEMINI_API_KEY` is set (replies labelled "Gemini"). Otherwise local keyword rules in `lib/demo-director.ts`, labelled "Demo rules". If Gemini fails or returns prose without a usable patch, the UI falls back to the rules and says so, so recognizable requests such as "make it more modern" still update the canvas. Every new assistant reply ends with a direct design question; when ElevenLabs is configured, that full reply is spoken automatically. |
| Gemini integration | Built. `POST /api/creative-director` returns validated reducer patches and receives relevant design-principles clips from TigerData for each request. The server injects `data/gemini/whoami.md` and `taste.json`, sends current poster geometry/transforms, and accepts validated `layerEdits` for exact canvas ids so requests such as “use this font” or “move the headline right” apply through the same reducer as manual editing. `POST /api/creative-coach` performs a Gemini function-call round trip into the TigerData library and receives the same principles context before returning placement feedback. |
| Microphone (speech to text) | Built. The browser converts recordings to 16 kHz mono WAV, then `POST /api/voice/transcribe` uses local **Whisper** (`whisper.cpp`) first and **ElevenLabs** as fallback. Production microphone access is enabled over HTTPS; browsers without `mediaDevices`/`MediaRecorder` now expose the reason through the mic tooltip instead of appearing silently inactive. The dark chat composer has an explicit hover/focus highlight, and active response/voice states use the `loading-dev` Wave indicator instead of the old voice-glow composer animation. |
| Spoken replies (text to speech) | Built. `POST /api/voice/speak`, ElevenLabs. Director replies speak automatically whenever ElevenLabs is configured; voice requests also speak automatically. Browser playback is unlocked on the user's send/microphone gesture and uses a resumed Web Audio context with a media-element fallback. Default voice is `ZoiZ8fuDWInAcwPXaVeq`; `ELEVENLABS_VOICE_ID` can override it. Works over plain HTTP. |
| Visual reference cards | Working locally. 31 distinct Pinterest poster searches are source-linked in the inspiration rail; Curio renders original abstract thumbnails rather than copying remote poster images. |
| Creative pipeline API | Built on `creative-pipeline-backend`, merged with `main` on 2026-10-11. This is the intended backend route for Gemini and data into the app; the UI is unchanged and does not call it yet. `/api/projects/*` runs brief -> concepts -> references -> asset plan -> composition -> render -> critique -> revise -> versions -> SVG/JSON export, with jobs de-duplicated by request hash. `GET /api/pipeline/status` reports which stages are available. Text stages use Gemini through `lib/ai/` when `GEMINI_API_KEY` is set; there is no image generation or vision model, and those capabilities report `false`. Contract: `docs/pipeline-api.yaml`. |
| Raster engine (`curio/`, Python) | On `curio-raster-engine`: layer stack and renderer, 45 deterministic image ops with golden-image tests, font library and text rendering (including hollow type), versioned style loader, a committed CC0 texture library (`curio/assets`: halftone maps, grain, paper, overlays, patterns, vectors, used as `asset:<id>` and by a `halftone_map` op), a compiler from the style-analysis export to presets/layouts/templates, a layout engine, an offline publisher that uploads compiled styles to TigerData as immutable releases and loads them back (`python -m curio publish` / `pull` / `render db`), an end-to-end runner (`python -m curio render`), and **asset packs** (`render --pack`: the poster as separate movable elements plus a manifest, for the freeform editor; format in `curio/docs/ASSET_PACK_SPEC.md`, not yet read by the website) that writes a poster plus a record of every value, fallback, legibility fix and licence. **No generative image models, by design.** A separate Python package, not yet connected to the Next.js app. Not built: asset rights manifest, director, critique loop, scrapers. See `curio/README.md` and `curio/OPEN_ITEMS.md`. |
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
  layout.tsx            Uses the bundled local font faces from globals.css; declares the Curio Labs app icons without a remote next/font build dependency
  icon.png              Supplied 200×200 Curio Labs wordmark used as the browser favicon and app icon
  page.tsx              Apex redirects to /home; proxy.ts rewrites the app-subdomain root to /app
  proxy.ts              Keeps the app-subdomain root at / while rendering the canonical /app home internally
  home/page.tsx          Addressable start/home screen at /home
  app/page.tsx           Canonical full editor at /app
  director/page.tsx      Legacy /director redirect to /app
  editor/page.tsx        Addressable full editor at /editor
  globals.css           Tailwind import, neutral UI palette tokens, bundled font faces, no-scroll onboarding treatment, desktop VoiceBeam styling, and Layers/Reference inspector chrome
components/studio/
  onboarding-studio.tsx Client home prompt, Gemini starter chips, microphone level orb, image import, and onboarding transitions
  image-import.tsx    Real image picker/drop target with Gemini analysis state, preview, and suggestion actions
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
  image-import/route.ts        Gemini image-reference analysis with bounded uploads and rate limits
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
lib/ai/                 provider.ts (capability-based provider interface), gemini-json.ts (structured-JSON Gemini calls for the pipeline), mock.ts (deterministic offline stand-in, labelled provider "mock")
lib/pipeline/           Creative pipeline stages: brief, concepts, references, assets, layout, composition, document, render, critique, revise, validate/validator, store (TigerData), http; pipeline.test.mjs and e2e.test.mjs run under `npm run test:unit`
app/api/projects/       Pipeline REST API (projects, concepts, select, design, evaluate, exports, jobs, preview, references, revise, versions); app/api/pipeline/status reports stage availability
docs/pipeline-api.yaml  OpenAPI contract for the pipeline API
lib/ (server only: db.ts, instance.ts, instance-store.ts, library.ts, password.ts, gemini.ts, whisper.ts, elevenlabs.ts, transcribe.ts, rate-limit.ts, voice-error.ts)
  ai-patch.ts           AiPatch type, validatePatch(), reconcilePatch(), patchToActions(). Shared by server and client
  poster-editor.ts      Bounded non-destructive layer transforms and visibility/lock state for the SVG editor
  knowledge.ts          Search and compact retrieval context for the TigerData design-principles corpus
  director-client.ts    Browser fetch for the director with a timeout
  coach-client.ts       Browser fetch for the Gemini/TigerData coaching route
  image-import-client.ts Browser fetch and validation for Gemini image-reference analysis
components/studio/use-voice.ts, use-capabilities.ts   Mic recording, playback, and server capability detection
curio/                  Python raster engine (separate from the Next.js app): core/, ops/, typography/, style_schema/, styles/, tests/. See curio/README.md
curio/docs/             Offline style ingestion pipeline: analysis-model export spec -> `curio compile` -> `curio publish` to TigerData (tables curio_style_releases, curio_style_documents). Run by hand, never by the website or deploy. See curio/docs/README.md
curio/assets/           CC0 procedural texture library (halftone maps, grain, paper, overlays, patterns, vectors; ~53 MB, committed) used by the engine as asset:<id>. `python -m curio publish-library` copies it into curio_library_assets tagged engine-texture
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
| Domain | `idkjustmakeitlookgood.gay`; apex and `www` are A records pointing at the server. The product uses the apex `/app` route; no separate app subdomain is required. No AAAA record, so Let's Encrypt validates over IPv4 |
| Firewall | ufw: 22, 80, 443 open |

### Pipelines (`.github/workflows/`)

- **`ci.yml`**: runs on pull requests to `main`. Lint (zero warnings), typecheck, build, non-blocking `npm audit`.
- **`deploy.yml`**: runs on push to `main` (every merge) and manually. Job 1 lints, typechecks, and builds. Job 2 SSHes in, fast-forwards the server to `origin/main`, runs `npm ci` and `npm run build`, restarts PM2, and health-checks `127.0.0.1:3000`. If any step fails it restores the previous commit, rebuilds, and restarts. Job 3 checks the public URL. The separately installed `whisper` PM2 process is not rebuilt by application deploys.

### Production microphone access

The live site uses `https://idkjustmakeitlookgood.gay/` (and still `https://155-138-194-120.sslip.io/`), with a Let's Encrypt certificate managed by Certbot. Browsers can now expose `getUserMedia`; users still need to grant microphone permission in the browser. The direct IP remains available over plain HTTP and is deliberately not redirected, because it has no certificate of its own.

### Adding another domain

`scripts/add-domain-ssl.sh` runs on the server, adds the names to nginx and expands the existing certificate rather than issuing a second one. It is a dry run unless given `--apply`; **read the diff before applying**. The product does not require a separate studio host; keep production on the apex domain and do not add an `app.` certificate unless that subdomain is intentionally reinstated later.

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
| `CURIO_DATABASE_URL` | Optional. Connection string for the offline Python style publisher (`curio/`); falls back to `DATABASE_URL`. Only needed on the machine that runs `python -m curio publish`, not on the server | shell environment of that machine |
| `CURIO_TEST_DATABASE_URL` | Optional. Enables the Postgres round-trip test in `curio/tests/test_database.py`; it works in a throwaway schema and drops it | shell environment |
| `LIBRARY_WRITE_TOKEN` | Optional server-only token required to upload shared font/media assets; reads remain available without it | same as above |
| `CURIO_AI_MOCK` | Development and CI only: `1` makes the pipeline answer from the deterministic mock (every response is labelled provider "mock"). **Never set it in production**; that would present mock output as AI | Playwright config; local shell |
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

The Python raster engine has its own environment (Python 3.12 or newer):

```bash
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"
.venv/Scripts/python -m pytest        # about 600 tests; CI does not run them yet
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

- **Gemini's library context is all fonts.** `libraryContext()` takes the first 60 shared rows ordered by kind, and the font import put 628 font rows in `curio_library_assets` (also 2 documents, 4 palettes, 31 references). The context is therefore 2 documents and 58 fonts, and palettes and references never reach Gemini. Fix with a per-kind cap in `libraryContext()` (`lib/library.ts`).
- **Engine textures are waiting on a filter.** `curio/assets` (on `curio-raster-engine`) publishes 42 image rows tagged `engine-texture` into `curio_library_assets` via `python -m curio publish-library`. Branch `library-engine-texture-filter` keeps those rows out of the Gemini context and coach search; merge and deploy it **before** publishing. Nothing has been published yet.
- **Open on the server:** `idkjustmakeitlookgood.gay` and `www.idkjustmakeitlookgood.gay` are each declared in two `:80` blocks and the apex is also in a `:443` catch-all, so `nginx -t` logs `conflicting server name ... ignored`. nginx keeps the first declaration, which puts the apex in certbot's redirect block where it falls through to `return 404`. Effect: **`http://idkjustmakeitlookgood.gay/` returns 404 instead of redirecting.** HTTPS is unaffected and correct on all three names. Fix with `bash scripts/fix-nginx-server-names.sh --apply` on the server; it is not applied by deploys, which never touch nginx config.
- Rate limits are in-memory per process (`lib/rate-limit.ts`): 20 director calls, 12 transcriptions, 20 speaks per client per minute, plus hourly global caps, to protect the paid keys on a public URL. They reset on restart and are not a substitute for auth. The client key comes from nginx's `X-Real-IP`.
- Voice recordings are capped at 30 seconds. Safari (mp4/m4a) and Firefox recording paths are implemented but were only tested in Chromium.
- Microphone permission errors were tested by throwing the same `DOMException` names browsers throw (`NotAllowedError`, `NotFoundError`, `NotReadableError`, `NotSupportedError`), because headless Chromium cannot show a real permission prompt.
- Without Gemini or voice keys, the app runs in demo mode and says so. Demo mode is keyword rules only, so unmatched requests get a clarifying prompt.
- The Tiger MCP connection currently reports stale `tsdbadmin` credentials, but the app's existing server-side `DATABASE_URL` successfully applied and verified the design-principles import. No database credential was rotated.
- `npm run check` passes. A production build is still environment-blocked here: Turbopack hits a worker/process permission panic, while the webpack fallback reaches the existing Google `next/font` Cormorant loader and fails while fetching/parsing the font stylesheet; neither failure points at the knowledge or Gemini changes. On Windows, a checkout under a folder whose name contains `!` (for example `!Programming_Projects`) also fails `npm run build` with `Can't resolve 'tw-animate-css'` even though the package is installed; CI's build passes. Clone to a path without `!` for local builds.
- Fonts use `next/font/google`. Builds need outbound network access to fetch them.
- The poster is fixed at 1080x1350 and long copy is not auto-shrunk (only the headline is fitted).
- The PNG exporter needs the fonts loaded; it awaits `document.fonts` but a slow connection could still produce a fallback font.
- The committed Playwright suite covers the public API contracts, no-database fallback, onboarding, start-to-director-to-editor navigation, mobile workspace, local director edits, a mocked Gemini-to-editor patch, panel switching, JSON export, JPG/PSD export, and warm tooltips. Voice hardware and production Gemini/Whisper flows still need separate integration coverage.
- **The pipeline is the backend route for Gemini and data.** `lib/pipeline/` + `lib/ai/` (`/api/projects/*`) is where Gemini output, the TigerData design data and validation come together and flow into the app; the app UI is intentionally not changed by it. Until the UI is wired to it, the editor keeps calling `lib/gemini.ts` (`/api/creative-director`, `/api/creative-coach`). Both paths are server-only and validate model output before use; when wiring the UI to the pipeline, keep that validation (see the Gemini merge priority above).
- **The pipeline adds 8 tables** (`curio_projects`, `curio_project_briefs`, `curio_project_concepts`, `curio_project_assets`, `curio_design_versions`, `curio_evaluations`, `curio_exports`, `curio_jobs`) to `db/schema.sql`. The app applies that file on its first database use after a deploy, so merging creates them in production. All are `CREATE ... IF NOT EXISTS` and hang off `curio_instances`.
- Anonymous instance cookies identify a workspace but are not authentication. The future auth service must bind authenticated users to these instance records before exposing profile/password operations broadly.
- Instance files are capped at 10 MB and shared library assets at 25 MB. Library writes require `LIBRARY_WRITE_TOKEN` until the auth service exists.

## 10. Where to work next

In priority order, matching the build phases:

1. **Publish the engine textures.** `library-engine-texture-filter` is merged (PR #24); once it is deployed, run `python -m curio publish-library` from `curio-raster-engine`. Consider the per-kind cap for the Gemini library context (section 9) at the same time.
2. **(Done: merged as PR #19, live since #20/#21 deployed green on 2026-10-11) `tldraw-voice-onboarding`.** The branch contains the verified manual editor pass, improved warm Vintage Jazz canvas, transparent mascot container, and randomized five-frame speaking loop. Review the `/home` start flow into the `/app` editor, director, Gemini/TigerData coach, and PNG/JPG/PSD export flows before promoting it to `main`; do not push directly to `main`.
3. **Canonical editor is `/app`.** Keep `/home` as the start screen and do not add another editor route unless the user asks.
4. **Gemini editing quality.** Follow the [Gemini workflow PR handoff](GEMINI_WORKFLOW_PR_HANDOFF.md) to add versioned, permissioned design examples or a supported tuning path, evaluate real requests, and preserve the `layerEdits` semantics.
5. **Reference depth.** Replace or supplement the 31 source-linked Pinterest searches with legally usable, verified assets when licensing/attribution requirements are settled.
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
| `curio-raster-engine` | 2026-10-10 | Python raster engine (curio/): layer stack, deterministic op registry, text and font library, versioned style loader. No generative image models | in progress | Core, ops, typography, style loader, export compiler, layout engine, compiled-style store, poster runner, TigerData style publisher/loader, asset-pack export for the freeform (tldraw) editor, and the CC0 texture library (curio/assets, halftone_map op, website library publisher) done (round trip verified against TigerData in a scratch schema; nothing published to the real tables yet). Pushed 2026-10-11 with `main` merged in |
| `creative-pipeline-backend` | 2026-10-10 | Build the AI creative director backend: brief interpretation, concepts, references, asset and composition planning, rendering, critique, revisions, versions and export | in progress | `main` merged in on 2026-10-11 (conflicts in db/schema.sql, package.json and this log, resolved by keeping both sides) |
| `tldraw-voice-onboarding` | 2026-10-10 | Add start/director/editor screen states, Compositor-inspired editor chrome, supplied voice keyframes, Gemini-to-editor handoff, and multi-format exports | merged | PR #14 merged to `main`; the first production workflow run exposed stale E2E expectations for the current desktop flow; follow-up fix is on `e2e-current-flow` |
| `e2e-current-flow` | 2026-10-11 | Align production E2E tests with the current home-to-app desktop flow | merged | PR #15 merged to `main`; all 17 E2E tests passed, then the server build exposed a separate next/font compatibility issue |
| `server-local-fonts` | 2026-10-11 | Remove remote Google font build dependency from the production bundle | merged | PR #16 merged to `main`; server build, PM2 restart, and the canonical `/app` HTTPS route now pass; the workflow’s raw-host health check was the only remaining false failure |
| `canonical-healthcheck` | 2026-10-11 | Verify production through the canonical HTTPS domain after deployment | merged | PR #17 merged; final workflow passed 17 E2E tests, Vultr deployment, and the canonical public endpoint check |
| `handoff-deploy-verified` | 2026-10-11 | Record the green production deployment and public endpoint verification | merged | PR #18 records the green final production run; apex redirects to `/home`, and `/app` returns 200 over HTTPS |
| `ui-and-feature` | 2026-10-11 | UI and feature work after the production editor deployment | in progress | |
| `codex/e2e-ci-fix` | 2026-10-11 | Fix the stale desktop E2E editor setup after the merged UI release | merged | PR #21; apex-only workspace routing deployed as `d218585` |
| `library-engine-texture-filter` | 2026-10-11 | Keep engine-texture rows out of the Gemini library context so the curio/assets textures can be published to curio_library_assets | merged | Gemini context and coach search skip rows tagged `engine-texture`; `/api/assets` still lists them. Prerequisite for publishing `curio/assets` from `curio-raster-engine`. Merged as PR #24 |
<!-- BRANCH-LOG-INSERT -->

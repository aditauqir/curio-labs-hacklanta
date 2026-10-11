# Curio Labs

**Wireframing your ideas in a flash.**

Curio Labs is a rapid poster prototyping studio with an AI creative director. Talk through an idea, get an editable poster direction in minutes, and hand it off to Photoshop as a layered PSD.

> Talk it out. Lay it out. Take it to Photoshop.

- **Live:** <https://idkjustmakeitlookgood.gay/>
- **Devpost:** CurioLabs (Hacklanta)

## Why Curio

Most posters begin with a vague idea: a restaurant wants something warm and inviting, a festival needs an energetic lineup poster, or an artist wants a direction that feels nothing like their last project. Turning that idea into a clear composition can take hours before the first real design decision is made.

Image generators are fast, but they return a finished-looking picture instead of an editable design. You can't easily adjust the hierarchy, typography, spacing, or individual elements.

Curio offers a different starting point. It is an AI creative director that turns an idea into an **editable visual system**: a structured canvas, meaningful design choices, and direct control over every layer. Its central idea is **Visual Consensus**: the conversation turns unclear preferences into explicit design decisions that you can review, edit, and approve.

## What It Does

Start with a brief such as:

> "Create a cozy late-night poster for a neighborhood kebab shop."

Curio interprets the brief, proposes distinct creative directions, and builds an editable composition. Then keep talking:

> "Make the title more playful."
> "Move the food image into the lower-right corner."
> "Keep the hierarchy, but make the date feel more prominent."

The AI never returns a flat image. It returns **structured design changes** that are validated and applied directly to the canvas. Typography, color, spacing, layout, shapes, image placement, and layer properties can all change independently.

You can:

- Start from a new brief or an existing workspace.
- Generate multiple creative directions to compare.
- Import your own reference images, have Gemini analyze them, and place them on the canvas.
- Apply a reference look (halftone screen, paper, grain) and switch individual textures on or off.
- Edit text, fonts, colors, geometry, and layer order.
- Hide, lock, delete, move, scale, and rotate layers.
- Undo and redo both manual and AI-assisted changes.
- Keep a live creative brief alongside the canvas.
- Talk to the director by voice and hear its replies.
- Export **PNG**, **JPG**, and **layered Photoshop PSD** files, plus the brief as JSON.

Reference assets are treated as inspiration and user-controlled inputs. Curio does not automatically place images from the server's reference library into a design; you decide which imported assets become part of the canvas.

### Why PSD export matters

Curio isn't trying to replace Photoshop. It helps you reach a strong first direction faster. The canvas is a rapid prototyping space for testing hierarchy, typography, imagery, spacing, and tone. Once the direction works, export a layered PSD and keep refining in Photoshop. You get an editable production file, not a screenshot that has to be rebuilt by hand.

## Architecture

```text
Text or voice brief
        │
        ▼
Gemini creative director ── structured design patch
        │                ── optional live research (Google Search grounding)
        │                ── imported-image analysis
        │                ── creative coaching with TigerData tools
        ▼
Validated patch  (validatePatch → reconcilePatch → patchToActions)
        │
        ▼
Shared studio reducer  ◄── manual edits use the same actions
        │
        ▼
Editable SVG canvas ──► PNG · JPG · layered PSD · brief JSON
```

```text
Browser
  StudioWorkspace
    CreativeDirector  <---->  /api/creative-director, /api/creative-coach
    DesignCanvas      <---->  studioReducer and shared poster layout
    InspirationBoard  <---->  /api/assets, /api/image-import
    CreativeBrief, ExportControls
          |
          +---- /api/studio/generate, /api/projects/*  (creative pipeline)
          +---- /api/workspace, /api/instance, /api/files
          +---- /api/voice/transcribe, /api/voice/speak

Next.js App Router server
  API routes       Input validation, rate limiting, cookies, response shaping
  Design layer     studioReducer -> DesignState -> buildPoster -> SVG / PNG / JPG / PSD
  AI layer         Gemini -> validated AiPatch -> reconcilePatch -> StudioAction[]
  Pipeline         brief -> concepts -> references -> composition -> critique -> revise -> versions
  Persistence      Anonymous instance cookie -> PostgreSQL / TigerData (LocalStorage fallback)

Infrastructure
  Google Gemini        Creative direction, structured edits, research, image analysis
  ElevenLabs           Spoken replies and fallback speech-to-text
  whisper.cpp          Self-hosted offline speech-to-text
  TigerData/Timescale  Workspaces, pipeline data, design knowledge, asset library
  Vultr                Production VPS: nginx, PM2, Whisper
  GitHub Actions       CI and deploy with rollback
```

### One poster model

All poster changes go through one reducer, and manual controls and AI edits use the same `StudioAction` contract. `buildPoster()` is the single layout source for the on-screen SVG and every export, so PNG, JPG, and PSD match what you see on the canvas.

### AI output is untrusted

1. `validatePatch()` keeps only supported properties, known fonts, valid palettes and colors, bounded text, and existing layer ids.
2. `reconcilePatch()` enforces the user's intent, including requests to keep the layout unchanged.
3. `patchToActions()` applies the result through the same reducer used by manual editing.
4. The UI reports only changes that were actually applied, not changes the model merely claimed.

So every AI change is editable, reversible, explainable, and limited to what the user asked for.

## Sponsor Technology

### Google Gemini: the creative director

- **Where:** `lib/gemini.ts`, `lib/ai/`, `lib/ai-patch.ts`, `app/api/creative-director`, `app/api/creative-coach`, `app/api/image-import`, `app/api/studio/generate`, `lib/pipeline/`.
- **Structured edits.** The director receives the current canvas state, layer geometry, typography, recent conversation, creative brief, and the latest instruction, and replies through a strict JSON `responseSchema`. It can change font family, size, weight, tracking, and alignment; text and hierarchy; palette, fills, strokes, and contrast; layer position, scale, rotation, and visibility; shapes, rules, and frames; image placement; and mood, direction, and layout strategy.
- **Live research (opt-in).** With `GEMINI_ENABLE_SEARCH=1`, a research pass uses `gemini-2.5-flash-lite` with the Google Search grounding tool, capped at five targeted searches (`GEMINI_SEARCH_MAX_QUERIES`). The notes feed a separate structured generation step. It never copies artwork or attaches web images.
- **Function calling.** The Creative Coach calls `search_library_assets` against TigerData to find real fonts, palettes, textures, and assets before giving feedback.
- **Also:** pipeline brief generation, multiple concept directions, design critique, revision planning, imported-image analysis, and starter prompts.
- **Resilience.** A fallback model chain (`GEMINI_MODEL`) handles retired models, rate limits, and overloads. If Gemini is unavailable, local rules take over and the UI says so.
- **Security.** `GEMINI_API_KEY` is server-side only and never exposed as `NEXT_PUBLIC_*`.

### ElevenLabs: the director's voice

- **Where:** `app/api/voice/speak`, `app/api/voice/transcribe`, `lib/elevenlabs.ts`, `lib/transcribe.ts`.
- Text-to-speech turns the director's feedback into spoken replies, so the workflow feels like working with an art director: describe the direction, hear the response, see the design change.
- ElevenLabs speech-to-text is the fallback when local Whisper is unavailable.

### whisper.cpp: private voice input

- **Where:** `scripts/whisper-setup.sh`, `scripts/whisper-run.sh`, `lib/whisper.ts`, `lib/wav.ts`.
- The browser converts recordings to 16 kHz mono WAV. A self-hosted `whisper.cpp` service on `127.0.0.1:8178` transcribes it, so voice stays on infrastructure the project controls.
- Low-amplitude audio is gated before inference so silence isn't transcribed as words.

### TigerData / Timescale PostgreSQL: memory and design knowledge

- **Where:** `db/schema.sql`, `lib/db.ts`, `lib/instance-store.ts`, `lib/library.ts`, `lib/knowledge.ts`, `lib/pipeline/store.ts`.
- Stores workspaces, briefs, conversations, canvas state, imported files, asset metadata, pipeline concepts, design versions, evaluations, export records, and background jobs. Jobs are de-duplicated by request hash.
- A curated design-principles corpus, searchable by full-text index, gives Gemini specific guidance on hierarchy, contrast, typography, spacing, and composition.
- The schema is applied idempotently on first database use after each deploy. Without `DATABASE_URL`, the app falls back to LocalStorage.

### Vultr: production infrastructure

- Ubuntu VPS with nginx for HTTPS and reverse proxying, Next.js under PM2, the self-hosted Whisper service, and ufw firewall rules.
- HTTPS is what lets browsers grant microphone access in production.

### GitHub Actions: CI/CD

- **`ci.yml`:** secret scanning, ESLint with zero warnings, typechecking, and a production build on every pull request.
- **`deploy.yml`:** every merge to `main` builds, deploys to Vultr over SSH, restarts PM2, health-checks the app, and **rolls back automatically** if any step fails, then verifies the public endpoint.

### Optional Python raster engine

`lib/pipeline/python-engine.ts` can send a composed concept to a separate Python raster renderer when `CURIO_PYTHON_PIPELINE_URL` is set. The renderer's source is not in this repository. When the URL is unset, the pipeline reports the engine as unavailable instead of claiming Python output.

## Project Structure

```text
app/
  app/, editor/, director/, home/     Product routes
  api/
    creative-director/                Gemini design edits
    creative-coach/                   Gemini coaching with TigerData function calls
    image-import/                     Imported-image analysis
    studio/generate/                  One-shot studio pipeline
    projects/[id]/...                 Pipeline REST API (concepts, design, evaluate, revise, versions, exports)
    pipeline/status/                  Stage availability
    voice/transcribe/, voice/speak/   Voice input and spoken replies
    workspace/, instance/, files/     Persistence
    assets/                           Shared asset library

components/studio/
  studio-workspace.tsx                State and persistence orchestration
  creative-director.tsx               Chat and voice controls
  design-canvas.tsx                   Editing surface, tools, properties panel
  poster.tsx                          SVG poster renderer
  inspiration-board.tsx               References and imported images
  creative-brief.tsx, export-controls.tsx

lib/
  design-state.ts, design-types.ts    Reducer, types, persisted-state validation
  ai-patch.ts                         AI output validation and reconciliation
  poster-layout.ts                    Shared SVG/raster/PSD layout model
  export.ts                           PNG, JPG, PSD, and brief JSON export
  gemini.ts, ai/                      Gemini integration and provider interface
  pipeline/                           Creative pipeline stages and store
  knowledge.ts, library.ts            Design-principles corpus and asset library
  whisper.ts, elevenlabs.ts           Voice services
  db.ts, instance-store.ts            PostgreSQL persistence

db/schema.sql                         Database schema
docs/pipeline-api.yaml                OpenAPI contract for the pipeline
data/gemini/                          Director persona, taste rules, schema, corpus
scripts/                              Whisper, imports, secret scan, branch helper
```

## Running Locally

Requirements: Node.js 24 and npm. Optional: Gemini, ElevenLabs, and PostgreSQL credentials, and a local `whisper.cpp` install for voice input.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>.

The app runs without external credentials. In that mode it uses local design rules and LocalStorage, and reports which AI capabilities are unavailable.

### Environment Variables

See [`.env.example`](.env.example) for the full list.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-side Gemini requests |
| `GEMINI_MODEL` | Optional model fallback chain |
| `GEMINI_ENABLE_SEARCH` | `1` enables live research with Google Search grounding (default `0`) |
| `GEMINI_SEARCH_MODEL`, `GEMINI_SEARCH_MAX_QUERIES` | Research model and query cap |
| `ELEVENLABS_API_KEY` | Spoken replies and fallback transcription |
| `WHISPER_URL`, `WHISPER_ENABLED` | Local Whisper service |
| `DATABASE_URL` | PostgreSQL/TigerData persistence |
| `LIBRARY_WRITE_TOKEN` | Optional server-only token for shared asset uploads |
| `CURIO_PYTHON_PIPELINE_URL` | Optional Python raster renderer endpoint |
| `CURIO_AI_MOCK` | Development and CI only: deterministic mock provider, never in production |

Never commit real values. The secret scanner runs in CI.

## Verification

```bash
npm run check        # secret scan, ESLint (zero warnings), typecheck
npm run build        # production build
npm run test:unit    # pipeline and script unit tests
npm run test:e2e     # Playwright browser and API suite
```

## Challenges

- **Changing only what the user asked for.** Early versions changed the palette, layout, and type when the user only asked for a font. The validate → reconcile → reducer pipeline fixed that.
- **Keeping outputs in sync.** SVG, PNG, JPG, and PSD drift apart when separate layout systems produce them, so one shared poster model drives them all.
- **Voice.** Stopping speech recognition from hearing words in silence, and serving HTTPS so browsers allow the microphone.
- **Model availability.** Handling retired Gemini models and rate limits with a fallback chain.
- **Control.** Making AI changes undoable through the same history as manual edits, and keeping imported images editable instead of treating them as final output.

## What We Learned

For creative tools, the most useful AI output is often a structured decision, not a finished image. A small, precise change, like adjusting a title's tracking or moving an image to a specific region, can be worth more than a whole new poster. Users want AI to be ambitious, but they still need control: AI proposes a direction, applies meaningful changes, and leaves an editable system to keep shaping.

## What's Next

- Expand the creative pipeline through critique, revision, and version comparison in the editor.
- Richer PSD support with editable text layers.
- Better image search and licensing metadata for user-selected assets.
- Collaborative workspaces and account-based projects.
- More poster categories, visual grammars, and creative directions.

## Built With

Gemini · Google Search grounding · ElevenLabs · TigerData · TimescaleDB · PostgreSQL · Vultr · whisper.cpp · Next.js · React · TypeScript · Tailwind CSS · Radix UI · ag-psd · nginx · PM2 · GitHub Actions · Playwright

## Contributors

- Adi Tauqir
- Noor

Contributions are welcome through pull requests. Describe the user-facing behavior, keep secrets out of commits, and run the verification commands before opening a PR. Never push directly to `main`: merges deploy to production.

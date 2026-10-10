# Curio Labs

Curio Labs is an AI creative director for small businesses, artists, and designers.

> From vague ideas to visual direction.

Curio Labs does not generate finished artwork. It helps a user explore visual directions, choose typography and color, refine an editable poster, and export the result. Its central idea is **Visual Consensus**: a conversation turns an unclear preference into explicit design decisions that the user can review, edit, and approve.

## What It Does

The core demo flow is:

1. Explore three poster directions: Vintage Jazz, Modern Minimal, and Experimental Editorial.
2. Ask the creative director for a focused change, such as a different font or accent color.
3. Apply only the requested property to the live poster.
4. Keep the creative brief synchronized with the canvas.
5. Export the poster as a PNG or export the brief as JSON.

Current capabilities include:

- Three-panel workspace with director, canvas, and inspiration areas.
- Validated Gemini design edits with deterministic intent reconciliation.
- Local keyword-rule fallback when Gemini is unavailable.
- Browser voice input converted to 16 kHz mono WAV.
- Offline Whisper transcription through `whisper.cpp`, with ElevenLabs as fallback.
- Optional spoken replies through ElevenLabs.
- Anonymous PostgreSQL-backed instances for profiles, hashed passwords, workspace state, chat history, and files.
- Shared font, palette, reference, and media library used as Gemini context.
- LocalStorage fallback when PostgreSQL is unavailable.
- Responsive desktop and mobile layouts.

## Architecture

```text
Browser
  StudioLoader
    StudioWorkspace
      CreativeDirector  <---->  /api/creative-director
      DesignCanvas      <---->  reducer and shared poster layout
      InspirationBoard  <---->  /api/assets
      CreativeBrief
      ExportControls
            |
            +---- /api/workspace, /api/instance, /api/files
            +---- /api/voice/transcribe, /api/voice/speak

Next.js App Router server
  API routes
    Input validation, rate limiting, cookies, and response shaping
  Shared design layer
    studioReducer -> DesignState -> buildPoster -> SVG and PNG output
  AI layer
    Gemini -> validated AiPatch -> reconcilePatch -> StudioAction[]
  Persistence layer
    Anonymous instance cookie -> PostgreSQL / Timescale
    LocalStorage fallback when the database is unavailable

External services and infrastructure
  Google Gemini       Creative direction and structured design edits
  ElevenLabs          Text-to-speech and speech-to-text fallback
  Whisper.cpp          Local offline speech-to-text service
  TigerData/Timescale  PostgreSQL persistence and shared asset library
  Vultr                Production VPS, nginx, and PM2
```

### Design State

All poster changes go through one reducer. Manual controls and AI edits use the same `StudioAction` contract. This prevents unrelated properties from changing when a user asks for a focused edit.

Gemini output is treated as untrusted:

1. `validatePatch()` keeps only approved directions, palettes, fonts, colors, and bounded text.
2. `reconcilePatch()` enforces user intent, including requests to keep the layout unchanged.
3. `patchToActions()` applies the validated result through the same reducer used by manual editing.
4. The UI reports changes that were actually applied, not changes merely claimed by the model.

`buildPoster()` is the single layout source for the on-screen SVG and PNG export, so the exported poster uses the same layout model as the canvas.

### Persistence

The browser receives an HTTP-only `curio_instance_id` cookie. Each anonymous instance has separate database records for its profile, workspace, chat messages, and uploaded files. Passwords are stored as scrypt hashes; the current app has no login UI yet.

The shared asset library is separate from user files. It stores metadata and optional binary content for fonts, palettes, references, images, video, audio, documents, and other assets. Built-in Curio definitions seed the library idempotently. Gemini receives the library metadata and can return exact, validated asset suggestions.

## Technology and Sponsor Usage

The following sponsor and platform technologies are used in the running project:

### Google Gemini

- **Where:** `lib/gemini.ts` and `app/api/creative-director/route.ts`.
- **How:** The server sends the current poster state, recent conversation, user request, and shared library metadata to Gemini.
- **Purpose:** Gemini returns a small structured design patch, such as a font, palette, color, copy, mood, or layout change. The response is validated before it can affect the poster.
- **Security:** `GEMINI_API_KEY` is server-side only and is never exposed as a `NEXT_PUBLIC_*` variable.

### ElevenLabs

- **Where:** `app/api/voice/speak/route.ts`, `app/api/voice/transcribe/route.ts`, `lib/elevenlabs.ts`, and `lib/transcribe.ts`.
- **How:** ElevenLabs generates spoken replies when the user opts in. It is also the fallback speech-to-text provider when local Whisper is unavailable.
- **Purpose:** Make the creative conversation usable through spoken replies and resilient voice input.

### Whisper.cpp

- **Where:** `scripts/whisper-setup.sh`, `scripts/whisper-run.sh`, `lib/whisper.ts`, and `lib/transcribe.ts`.
- **How:** A locally hosted `whisper.cpp` service receives normalized WAV audio at `127.0.0.1:8178`.
- **Purpose:** Keep primary speech-to-text offline and avoid sending the user's voice recording to an external transcription provider.

### TigerData / Timescale PostgreSQL

- **Where:** `db/schema.sql`, `lib/db.ts`, `lib/instance-store.ts`, and `lib/library.ts`.
- **How:** The app initializes its schema on first database use and stores anonymous instance data, chat history, uploaded files, and shared library metadata.
- **Purpose:** Give each anonymous browser a persistent workspace while keeping the creative brief and conversation available across visits.

### Vultr

- **Where:** Production infrastructure, configured through `.github/workflows/deploy.yml`.
- **How:** GitHub Actions fast-forwards the Vultr checkout after a merge, installs dependencies, builds Next.js, restarts PM2, and verifies the public endpoint. nginx forwards public traffic to Next.js on `127.0.0.1:3000`.
- **Purpose:** Host the production application and the local Whisper service.

### GitHub and GitHub Actions

- **Where:** `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`.
- **How:** Pull requests run secret scanning, linting, typechecking, and a production build. Merges to `main` deploy to Vultr.
- **Purpose:** Keep changes reviewable and make production deployment repeatable.

## Project Structure

```text
app/
  layout.tsx                         Application shell and fonts
  page.tsx                           Studio entry point
  globals.css                        UI styles and design tokens
  api/
    creative-director/route.ts       Gemini design edit API
    voice/transcribe/route.ts        Voice input API
    voice/speak/route.ts              Spoken reply API
    workspace/route.ts                Workspace persistence API
    instance/route.ts                 Anonymous profile API
    files/route.ts                    Instance file API
    assets/route.ts                   Shared library API

components/studio/
  studio-workspace.tsx               Main state and persistence orchestration
  creative-director.tsx              Chat and voice controls
  design-canvas.tsx                  Poster editing surface
  poster.tsx                          SVG poster renderer
  creative-brief.tsx                 Live creative brief
  inspiration-board.tsx              Inspiration panel

lib/
  design-types.ts                    Shared design and chat types
  design-presets.ts                  Directions, fonts, palettes, and references
  design-state.ts                    Reducer and persisted-state validation
  ai-patch.ts                        AI output validation and reconciliation
  poster-layout.ts                   Shared SVG/PNG layout model
  export.ts                          PNG and JSON export
  gemini.ts                           Gemini integration
  whisper.ts                          Local Whisper integration
  elevenlabs.ts                       ElevenLabs integration
  db.ts, instance-store.ts            PostgreSQL persistence
  library.ts                          Shared asset library

db/schema.sql                         Database schema and seed support
scripts/whisper-*.sh                  Whisper setup and runtime scripts
```

## Running Locally

Requirements:

- Node.js 24
- npm
- Optional: Gemini, ElevenLabs, and PostgreSQL credentials
- Optional: a local `whisper.cpp` installation for voice input

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The application can run without external credentials. In that mode it uses local design rules, LocalStorage persistence, and reports which AI capabilities are unavailable. Database-backed persistence is enabled when `DATABASE_URL` is configured.

### Environment Variables

See [`.env.example`](.env.example) for the complete list. Important variables are:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-side Gemini requests |
| `ELEVENLABS_API_KEY` | Speech generation and fallback transcription |
| `WHISPER_URL` | Optional local Whisper service URL |
| `WHISPER_ENABLED` | Enable or disable local Whisper |
| `DATABASE_URL` | PostgreSQL/Timescale persistence |
| `LIBRARY_WRITE_TOKEN` | Optional server-only token for shared asset uploads |

Never commit real environment values. The secret scanner is part of CI.

## Verification

```bash
npm run check
npm run build
npm run check:secrets
```

`npm run check` runs secret scanning, ESLint with zero warnings, and Next.js typechecking. `npm run build` verifies the production build.

## Live Demo

The current demo is deployed at:

<http://155.138.194.120/>

The deployment currently uses HTTP. Browser microphone access requires HTTPS or localhost, so voice input should be tested locally until a hostname and TLS certificate are configured. Gemini chat, spoken replies, and the server-side Whisper API remain available independently.

## Contributors

- Adi Tauqir
- Noor

Contributions are welcome through pull requests. Please describe the user-facing behavior, keep secrets out of commits, and run the verification commands before opening a PR.

## Hacklanta Submission

Curio Labs is submitted to Hacklanta as an AI-assisted creative tooling project. The submission demonstrates how AI can help a person move from an uncertain creative idea to a concrete, editable visual direction without replacing the person's authorship or judgment.

The project is intended for small businesses, artists, and designers who need a practical starting point for a poster or visual identity. The submission focuses on:

- Human-controlled iteration instead of opaque one-shot image generation.
- Explicit design decisions that can be approved, rejected, or edited.
- A live canvas and creative brief driven by the same state.
- Voice and text interaction for a more natural creative workflow.
- Sponsor technologies used in a real end-to-end application rather than isolated demos.

Curio Labs is not intended to claim that it creates finished artwork autonomously. It is a collaborative direction-finding tool.

## Status and Roadmap

Working now:

- Three poster directions and editable canvas.
- Gemini design edits with safe patch validation.
- Whisper-first speech-to-text and ElevenLabs spoken replies.
- Anonymous PostgreSQL persistence and shared asset context.
- PNG and creative brief JSON export.

Next:

- Add HTTPS and a hostname for production microphone access.
- Add browser and API tests to the repository.
- Connect a future authentication service to anonymous instances.
- Replace placeholder inspiration cards with verified, legally usable references.
- Add SVG export and tablet-specific panel controls.

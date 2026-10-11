# Gemini workflow PR handoff

Status: ready for the next contributor

This document is the implementation and PR sign-off brief for the next person working on Curio Labs' Gemini workflow. The goal is to replace unreliable demo-style behavior with a measurable, data-grounded creative-direction workflow that still produces safe, editable poster changes.

## Scope

The next PR owns the Gemini quality path only:

- improve intent recognition and patch selection using real, versioned design examples and the approved design-principles corpus;
- make requests such as “make it more modern,” “keep the layout,” font changes, copy changes, palette changes, and layer movement resolve consistently;
- keep the existing structured `AiPatch` contract and the reducer as the only path that can change the canvas;
- preserve the current image-reference analysis, asset suggestions, conversation history, and question-ending replies;
- document whether the improvement uses retrieval/few-shot examples, Gemini tuning, or both.

Do not describe prompt edits or keyword rules as model training. If a tuned model is not available, use the Gemini API with a versioned retrieval/few-shot dataset and label the approach accurately in the PR.

## Existing workflow to preserve

The main request path is:

1. `components/studio/creative-director.tsx` sends the user's request and current design state.
2. `app/api/creative-director/route.ts` validates the request and calls the server-only Gemini client.
3. `lib/gemini.ts` loads `data/gemini/whoami.md`, `data/gemini/taste.json`, design-principles context, and shared library context.
4. Gemini returns structured JSON.
5. `lib/ai-patch.ts` validates and reconciles the response.
6. `lib/design-state.ts` applies the resulting `StudioAction[]` to the live poster.

The following safety boundaries are non-negotiable:

- never apply raw model JSON directly to the design;
- preserve `validatePatch()` and `reconcilePatch()` or add tests before changing their rules;
- keep exact current layer ids for `layerEdits`; never let the model invent ids or target the background;
- keep secrets server-side; only variable names may appear in this document or a PR;
- keep the local/demo fallback clearly labelled if it remains enabled;
- do not fabricate citations, library assets, training examples, or model capabilities.

## Data and evaluation plan

Build a small, reviewable dataset of real design requests paired with the intended patch and the expected “no change” fields. Each record should include:

- the user request;
- the starting direction, palette, font pair, copy, and relevant layer geometry;
- the expected `AiPatch` or an explicit clarifying-question result;
- constraints such as “keep the layout” or “change only the headline”;
- a short human rationale for the expected edit;
- a source label and license/permission note when the example is not authored for this project.

The evaluation set must cover at least:

- broad direction changes;
- modern/minimal/warmer/vintage language;
- palette and font requests;
- headline and subtitle rewrites;
- exact layer movement and scale requests;
- “keep the layout” constraints;
- vague requests that should ask one question and apply no patch;
- unsafe, unrelated, invalid, or unknown-layer requests;
- image-reference suggestions and library asset ids;
- multi-turn requests where the second request builds on the first.

The PR must include a reproducible evaluation command or script and report results for schema validity, intent accuracy, constraint preservation, and patch safety. Set the baseline before changing the workflow; do not claim improvement without comparing against it.

## Implementation requirements

- Keep model selection configurable through the existing server-side model configuration.
- Keep the response schema bounded and versioned.
- Prefer a small structured patch over prose parsing.
- Use retrieved principles and examples as grounding context, not as unverified authority.
- Make failures observable by category without logging prompts, responses, keys, or user files.
- Add regression tests for every failure found during evaluation.
- Keep latency within the existing client/server timeout budget, or document and test any intentional change.
- Preserve the existing spoken-reply question behavior; a response must still end with a useful design question when appropriate.

## PR sign-off checklist

Before requesting review:

- [ ] The PR links this document and states the chosen data-grounding or tuning approach.
- [ ] The dataset is versioned, permissioned, reproducible, and contains no secrets or private user data.
- [ ] The evaluation set and baseline results are included or linked from the PR.
- [ ] `AiPatch` validation, reconciliation, layer ids, and reducer behavior remain covered.
- [ ] Gemini-unavailable behavior remains honest and clearly labelled.
- [ ] `npm run check:secrets` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes in the CI/deployment environment.
- [ ] `npm run test:unit` passes.
- [ ] `npm run test:e2e` passes, including the home → app → Gemini edit flow.
- [ ] A real API smoke test was run with configured server-only credentials, without exposing values.
- [ ] `HANDOFF.md` has the new branch row, current status, next step, and a link back here.
- [ ] The PR does not push directly to `main`; merge approval is explicit.

## Merge and deployment handoff

Production is deployed by `.github/workflows/deploy.yml` after a PR merges into `main`. The workflow builds and tests the app, fast-forwards `/var/www/curiolabs`, runs the production build, restarts PM2, checks localhost health, and verifies `https://idkjustmakeitlookgood.gay/`.

After merge, record the workflow run, deployed commit, public endpoint check, and any remaining Gemini limitations in `HANDOFF.md`. Never add API keys, database URLs, SSH material, or private training data to the repository.

## Sign-off

| Role | Name | Decision | Notes |
| --- | --- | --- | --- |
| Gemini/data owner |  | Pending | Dataset, grounding/tuning method, and evaluation results |
| Product/design reviewer |  | Pending | Intent fidelity and visual edit quality |
| Security reviewer |  | Pending | Secrets, privacy, validation, and logging |
| Deployment owner |  | Pending | CI, production workflow, and public endpoint |

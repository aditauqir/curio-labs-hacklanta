<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:curio-handoff-rules -->

## Project handoff rules (Curio Labs)

Read `HANDOFF.md` at the start of every session. It is the source of truth for project state, infrastructure, and next steps.

**Branch rule (mandatory):** whenever you create a new git branch, you must update `HANDOFF.md` on that same branch before you do other work.

- Preferred: `npm run branch -- <branch-name> "<what the branch is for>"`. It branches from up-to-date `main`, adds a row to the Branch log, and commits it.
- If you create the branch by hand, add the row to the Branch log yourself (the table above the `BRANCH-LOG-INSERT` marker) and commit it.
- When a branch's status changes (PR opened, merged, abandoned), update its row.
- If your work changes the project's state, infra, env vars, or next steps, update those sections and the `Last updated` date in the same branch.

**Safety rules:**

- Never commit or push directly to `main`. Merging to `main` auto-deploys to production.
- Never print, log, commit, or write secrets into `HANDOFF.md`, code, or PR text. Only variable names belong in docs.
- Do not present simulated behavior (demo chat replies, fake voice) as real AI or real features.

<!-- END:curio-handoff-rules -->

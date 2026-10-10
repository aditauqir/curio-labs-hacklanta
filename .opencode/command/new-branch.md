---
description: Create a new branch from up-to-date main and log it in HANDOFF.md.
---

Create a new branch for this work: $ARGUMENTS

Use `npm run branch -- <branch-name> "<one-line purpose>"`. Derive a short kebab-case branch name and a clear purpose from
the arguments. This creates the branch from up-to-date `main`, adds a row to the Branch log in `HANDOFF.md`, and commits it.

Afterwards, confirm the new row appears in `HANDOFF.md`. Do not push, open a PR, or touch `main`.

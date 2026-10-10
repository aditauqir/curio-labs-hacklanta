---
description: Run lint, typecheck, and production build, then report any failures.
---

Run `npm run lint`, `npm run typecheck`, and `npm run build` in order from the repository root.
Report each result. If any step fails, read the errors, fix the root cause in the source, and re-run
the failing step until all three pass. Do not push, commit, or touch `.github/workflows/` as part of this check.

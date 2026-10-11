#!/usr/bin/env node
// Creates a branch from up-to-date main and logs it in HANDOFF.md.
// Usage: npm run branch -- <branch-name> "<what the branch is for>"
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const MARKER = "<!-- BRANCH-LOG-INSERT -->";
const HANDOFF = "HANDOFF.md";
const PR_HANDOFF = "GEMINI_WORKFLOW_PR_HANDOFF.md";

const [name, ...purposeParts] = process.argv.slice(2);
const purpose = purposeParts.join(" ").trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!name || !purpose) {
  fail('Usage: npm run branch -- <branch-name> "<what the branch is for>"');
}
if (!existsSync(PR_HANDOFF)) {
  fail(`${PR_HANDOFF} is missing. Restore the PR handoff brief before creating a branch.`);
}
if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(name)) {
  fail(`Invalid branch name: ${name}`);
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

const branches = git("branch", "--list", name);
if (branches) fail(`Branch ${name} already exists locally.`);

git("fetch", "origin", "main");
if (git("branch", "--show-current") !== "main") git("switch", "main");
git("pull", "--ff-only", "origin", "main");
git("switch", "-c", name);

// en-CA formats as YYYY-MM-DD in the local timezone (toISOString would use UTC).
const today = new Date().toLocaleDateString("en-CA");
const safePurpose = purpose.replaceAll("|", "/");
const row = `| \`${name}\` | ${today} | ${safePurpose} | in progress | |`;

let doc = readFileSync(HANDOFF, "utf8");
if (!doc.includes(MARKER)) {
  fail(`${HANDOFF} is missing the ${MARKER} marker. Add the row by hand.`);
}
doc = doc.replace(MARKER, `${row}\n${MARKER}`);
doc = doc.replace(/^Last updated: .*$/m, `Last updated: ${today}`);
writeFileSync(HANDOFF, doc);

git("add", HANDOFF);
git("commit", "-m", `Log branch ${name} in HANDOFF`);
console.log(`Created branch ${name} and logged it in ${HANDOFF}. Review ${PR_HANDOFF} for the next Gemini workflow PR.`);

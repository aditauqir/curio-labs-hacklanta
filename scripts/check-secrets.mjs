#!/usr/bin/env node
// Fails if anything that looks like a real credential is in a file git would commit.
// Gitignored files (like .env.local) are skipped on purpose: that is where secrets belong.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  { name: "Google API key", regex: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "ElevenLabs-style secret key", regex: /\bsk_[a-f0-9]{40,}\b/ },
  { name: "GitHub token", regex: /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}\b/ },
  { name: "GitHub fine-grained token", regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: "Private key block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const MAX_BYTES = 1_000_000;

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const findings = [];

for (const file of files) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    continue; // deleted but still listed
  }
  if (size > MAX_BYTES) continue;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue; // binary

  text.split("\n").forEach((line, index) => {
    for (const { name, regex } of PATTERNS) {
      if (regex.test(line)) findings.push(`${file}:${index + 1}  ${name}`);
    }
  });
}

if (findings.length > 0) {
  console.error("Possible secrets found in files that would be committed:\n");
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    "\nMove the value into .env.local (gitignored) and read it from process.env. Values are intentionally not printed.",
  );
  process.exit(1);
}

console.log(`No secrets detected in ${files.length} files.`);

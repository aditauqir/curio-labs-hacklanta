#!/usr/bin/env node
// Rewrites an nginx site config so each custom domain is declared in exactly
// one server block per port. Reads the config on stdin, writes the rewritten
// config on stdout, and reports what it changed on stderr.
//
// Usage: node scripts/nginx-server-names.mjs <domain> [<domain> ...] < config
//
// Driven by scripts/fix-nginx-server-names.sh, which supplies the sudo, nginx
// reload and verification around it. Kept separate so the rewrite is pure and
// testable: it only transforms text and never touches the filesystem.
//
// Three rules, applied per top level `server { ... }` block:
//   1. A catch-all block (its server_name list contains a bare `_`) keeps only
//      `_` and any name that is not one of ours. Catch-alls must stay generic;
//      giving them concrete names makes nginx log "conflicting server name
//      ... ignored" and silently drop the later declaration.
//   2. A named block listening on 443 gains any of our domains it is missing,
//      so TLS is served by the real block rather than the catch-all.
//   3. A named block listening on 80 that already lists one of our domains has
//      its `return 404;` turned into a 301 to HTTPS. Certbot writes per-host
//      `if` guards above that line but only for hosts it redirected, so any
//      other name in the block would otherwise fall through to the 404.
import { pathToFileURL } from "node:url";

const SERVER_NAME = /^(\s*)server_name\s+([^;]*);(.*)$/;
const LISTEN = /^\s*listen\s+([^;]*);/;
const RETURN_404 = /^(\s*)return\s+404\s*;(.*)$/;

// nginx treats everything after # as a comment, so match against code only.
const code = (line) => line.split("#", 1)[0];

// ...but keep the comment when rewriting. Certbot marks the directives it owns
// with "# managed by Certbot" and we must not strip that off.
const comment = (line) => {
  const at = line.indexOf("#");
  return at === -1 ? "" : ` ${line.slice(at).trim()}`;
};

export function rewrite(source, domains) {
  const lines = source.split("\n");
  const changes = [];

  const blocks = [];
  let depth = 0;
  let start = null;
  for (const [i, line] of lines.entries()) {
    const text = code(line);
    for (const ch of text) {
      if (ch === "{") {
        if (depth === 0 && /^\s*server\b/.test(text)) start = i;
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0 && start !== null) {
          blocks.push([start, i]);
          start = null;
        }
      }
    }
  }

  for (const [from, to] of blocks) {
    let nameIndex = null;
    let names = [];
    const ports = new Set();

    for (let i = from; i <= to; i += 1) {
      const text = code(lines[i]);
      const name = SERVER_NAME.exec(text);
      if (name && nameIndex === null) {
        nameIndex = i;
        names = name[2].split(/\s+/).filter(Boolean);
      }
      const listen = LISTEN.exec(text);
      if (listen) {
        // Matches "80", "[::]:80", "443 ssl" and "0.0.0.0:443 ssl ipv6only=on".
        const port = /(?:^|[\s[\]:])(\d+)(?:\s|$)/.exec(listen[1]);
        if (port) ports.add(port[1]);
      }
    }

    if (nameIndex === null) continue;
    const [, indent] = SERVER_NAME.exec(code(lines[nameIndex]));
    const nameComment = comment(lines[nameIndex]);

    if (names.includes("_")) {
      const kept = names.filter((n) => !domains.includes(n));
      if (kept.length !== names.length) {
        lines[nameIndex] = `${indent}server_name ${kept.join(" ")};${nameComment}`;
        changes.push(`line ${nameIndex + 1}: catch-all restored to "${kept.join(" ")}"`);
      }
      continue;
    }

    if (ports.has("443")) {
      const missing = domains.filter((d) => !names.includes(d));
      if (missing.length > 0) {
        const merged = [...names, ...missing];
        lines[nameIndex] = `${indent}server_name ${merged.join(" ")};${nameComment}`;
        changes.push(`line ${nameIndex + 1}: added ${missing.join(" ")} to the :443 block`);
      }
    }

    if (ports.has("80") && domains.some((d) => names.includes(d))) {
      for (let i = from; i <= to; i += 1) {
        const found = RETURN_404.exec(code(lines[i]));
        if (found) {
          // Deliberately not labelled "managed by Certbot": this replaces
          // Certbot's 404 fallthrough and Certbot no longer owns the line.
          lines[i] = `${found[1]}return 301 https://$host$request_uri; # redirect names Certbot left unguarded`;
          changes.push(`line ${i + 1}: return 404 -> return 301 to HTTPS`);
          break;
        }
      }
    }
  }

  return { output: lines.join("\n"), changes };
}

async function main() {
  const domains = process.argv.slice(2);
  if (domains.length === 0) {
    console.error("Usage: node scripts/nginx-server-names.mjs <domain> [<domain> ...] < config");
    process.exit(1);
  }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { output, changes } = rewrite(Buffer.concat(chunks).toString("utf8"), domains);

  for (const change of changes) console.error(`    ${change}`);
  if (changes.length === 0) console.error("    nothing to change");
  process.stdout.write(output);
}

// Only run when invoked directly, so tests can import rewrite().
// pathToFileURL handles the Windows drive letter and slash direction, which a
// hand built "file://" + path string gets wrong.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

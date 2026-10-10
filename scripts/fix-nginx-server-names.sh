#!/usr/bin/env bash
# Repairs duplicate nginx server_name entries for the custom domain, so each
# name is declared in exactly one block per port.
#
# Background: an earlier version of scripts/add-domain-ssl.sh appended the
# domains to every server_name directive in the site, including the two
# catch-all (`server_name _;`) blocks. nginx keeps the first declaration of a
# name on a given port and logs "conflicting server name ... ignored" for the
# rest, which left http://<apex>/ being answered by certbot's redirect block
# and falling through to its `return 404`.
#
# Run this ON THE SERVER as a user with sudo:
#
#   bash scripts/fix-nginx-server-names.sh              # dry run, changes nothing
#   bash scripts/fix-nginx-server-names.sh --apply      # make the change
#
# Environment overrides:
#   DOMAINS    space separated names to normalise
#              (default: idkjustmakeitlookgood.gay www.idkjustmakeitlookgood.gay)
#   SITE       nginx site config (default: /etc/nginx/sites-available/curiolabs)
#
# The rewrite itself lives in scripts/nginx-server-names.mjs; this script is the
# sudo, backup, reload and verification harness around it. See that file for
# the three rules it applies.
#
# It does not touch ssl_certificate lines or request a certificate, so it
# cannot affect Let's Encrypt rate limits. Safe to re-run.
set -euo pipefail

DOMAINS="${DOMAINS:-idkjustmakeitlookgood.gay www.idkjustmakeitlookgood.gay}"
SITE="${SITE:-/etc/nginx/sites-available/curiolabs}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

log() { printf '==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

for tool in nginx node curl; do
  command -v "$tool" >/dev/null 2>&1 || die "Missing required tool: $tool"
done
[ -f "$SITE" ] || die "nginx site config not found: $SITE"

REWRITE="$(dirname "$0")/nginx-server-names.mjs"
[ -f "$REWRITE" ] || die "Missing $REWRITE"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

log "Conflicting server names currently reported by nginx"
sudo nginx -t 2>&1 | grep 'conflicting server name' || echo "    none"

log "Planned changes"
# shellcheck disable=SC2086
sudo cat "$SITE" | node "$REWRITE" $DOMAINS > "$TMP"

log "Diff"
if diff -u "$SITE" "$TMP"; then
  log "Config already correct; nothing to do."
  exit 0
fi

if [ "$APPLY" -ne 1 ]; then
  echo
  log "DRY RUN. Nothing was changed. Re-run with --apply to proceed."
  log "Review the diff above before applying."
  exit 0
fi

BACKUP="$SITE.bak.$(date +%Y%m%d%H%M%S)"
log "Backing up to $BACKUP"
sudo cp -a "$SITE" "$BACKUP"
sudo cp "$TMP" "$SITE"
sudo chmod 644 "$SITE"

if ! sudo nginx -t; then
  log "nginx config test FAILED, restoring backup"
  sudo cp -a "$BACKUP" "$SITE"
  sudo nginx -t
  die "nginx rejected the new config; original restored"
fi

log "Reloading nginx"
sudo systemctl reload nginx

log "Conflicting server names after the fix"
sudo nginx -t 2>&1 | grep 'conflicting server name' || echo "    none"

log "Verifying the named hosts"
for d in $DOMAINS 155-138-194-120.sslip.io; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$d/" || echo FAIL)"
  redirect="$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 15 "http://$d/" || true)"
  echo "    https://$d/ -> $code"
  echo "    http://$d/  -> ${redirect:-<no redirect>}"
done

log "Plain HTTP on the bare IP should still be served, not redirected"
curl -sS -o /dev/null -w '    http://155.138.194.120/ -> %{http_code} %{redirect_url}\n' \
  --max-time 15 http://155.138.194.120/ || true

log "Done."

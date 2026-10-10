#!/usr/bin/env bash
# Adds a custom domain to the production nginx site and expands the existing
# Let's Encrypt certificate to cover it, so the domain serves valid HTTPS.
#
# Run this ON THE SERVER as a user with sudo:
#
#   bash scripts/add-domain-ssl.sh                     # dry run, changes nothing
#   bash scripts/add-domain-ssl.sh --apply             # make the change
#
# Environment overrides:
#   DOMAINS    space separated names to add
#              (default: idkjustmakeitlookgood.gay www.idkjustmakeitlookgood.gay)
#   SITE       nginx site config (default: /etc/nginx/sites-available/curiolabs)
#
# Safe to re-run: names already present are skipped, and certbot renews rather
# than reissues if the certificate already covers everything.
#
# Before running, each name in DOMAINS must already resolve to this server.
# Let's Encrypt validates over HTTP on port 80, which ufw already allows.
#
# Catch-all blocks are deliberately left alone. A `server_name _;` block is the
# default for its port; adding real names to it makes nginx report "conflicting
# server name ... ignored" and silently drop whichever copy it sees second.
# See scripts/fix-nginx-server-names.sh if that has already happened.
set -euo pipefail

DOMAINS="${DOMAINS:-idkjustmakeitlookgood.gay www.idkjustmakeitlookgood.gay}"
SITE="${SITE:-/etc/nginx/sites-available/curiolabs}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

log() { printf '==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

for tool in nginx certbot curl; do
  command -v "$tool" >/dev/null 2>&1 || die "Missing required tool: $tool"
done
[ -f "$SITE" ] || die "nginx site config not found: $SITE"

for d in $DOMAINS; do
  if ! [[ "$d" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$ ]]; then
    die "Invalid domain name: $d"
  fi
done

# ---------------------------------------------------------------- 1. inspect

log "Public IP of this server"
SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org || echo unknown)"
echo "    $SERVER_IP"

log "Checking that each domain resolves here"
for d in $DOMAINS; do
  resolved="$(getent ahostsv4 "$d" | awk '{print $1}' | sort -u | paste -sd, -)"
  echo "    $d -> ${resolved:-<no A record>}"
  if [ "$SERVER_IP" != unknown ] && [[ ",$resolved," != *",$SERVER_IP,"* ]]; then
    die "$d does not resolve to $SERVER_IP. Fix DNS first; Let's Encrypt will fail otherwise."
  fi
done

log "Existing certificates"
sudo certbot certificates

CERT_NAME="$(sudo certbot certificates 2>/dev/null \
  | awk '/Certificate Name:/{print $3; exit}')"
[ -n "$CERT_NAME" ] || die "No existing certbot certificate found. Issue one first."
log "Will expand certificate: $CERT_NAME"

EXISTING_DOMAINS="$(sudo certbot certificates 2>/dev/null \
  | awk '/Domains:/{ $1=""; print; exit }')"
log "Currently covers:$EXISTING_DOMAINS"

# ------------------------------------------------- 2. add names to server_name

ADD=""
for d in $DOMAINS; do
  if grep -Eq "(^|[[:space:]])$(printf '%s' "$d" | sed 's/\./\\./g')([[:space:];])" "$SITE"; then
    echo "    $d already in $SITE"
  else
    ADD="$ADD $d"
  fi
done
ADD="${ADD# }"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if [ -n "$ADD" ]; then
  log "Adding to named (non catch-all) server_name directives in $SITE:$ADD"
  sudo awk -v add="$ADD" '
    # Only touch real, uncommented server_name directives. A directive whose
    # names include a bare "_" is a catch-all and must keep matching everything
    # else, so it is skipped rather than given concrete names.
    /^[[:space:]]*server_name[[:space:]]/ && !/^[[:space:]]*#/ {
      names = $0
      sub(/^[[:space:]]*server_name[[:space:]]+/, "", names)
      sub(/[[:space:]]*;.*$/, "", names)
      catchall = 0
      n = split(names, parts, /[[:space:]]+/)
      for (i = 1; i <= n; i++) if (parts[i] == "_") catchall = 1
      if (!catchall) {
        sub(/;[[:space:]]*$/, " " add ";")
        touched++
      }
    }
    { print }
    END {
      if (!touched) print "No non catch-all server_name directive found." > "/dev/stderr"
    }
  ' "$SITE" > "$TMP"

  log "Diff"
  diff -u <(sudo cat "$SITE") "$TMP" || true
else
  log "All domains already present in $SITE; no config edit needed"
  sudo cat "$SITE" > "$TMP"
fi

if [ "$APPLY" -ne 1 ]; then
  echo
  log "DRY RUN. Nothing was changed. Re-run with --apply to proceed."
  log "Review the diff above before applying."
  exit 0
fi

# ------------------------------------------------------------- 3. apply nginx

if [ -n "$ADD" ]; then
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
fi

# ---------------------------------------------------------------- 4. certbot

CERT_ARGS=()
for d in $(echo "$EXISTING_DOMAINS" $DOMAINS | tr ' ' '\n' | sed '/^$/d' | sort -u); do
  CERT_ARGS+=(-d "$d")
done

log "Requesting certificate for: ${CERT_ARGS[*]}"
sudo certbot --nginx --expand --cert-name "$CERT_NAME" \
  "${CERT_ARGS[@]}" \
  --redirect --non-interactive --agree-tos --keep-until-expiring

log "Testing renewal (dry run)"
sudo certbot renew --dry-run

log "Reloading nginx"
sudo nginx -t && sudo systemctl reload nginx

# ----------------------------------------------------------------- 5. verify

log "Checking for duplicate server names"
if sudo nginx -t 2>&1 | grep -q 'conflicting server name'; then
  sudo nginx -t 2>&1 | grep 'conflicting server name' || true
  log "WARNING: a name is declared in more than one block for the same port."
  log "nginx keeps the first and ignores the rest. Run scripts/fix-nginx-server-names.sh"
else
  echo "    none"
fi

log "Verifying"
for d in $DOMAINS; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$d/" || echo FAIL)"
  redirect="$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 15 "http://$d/" || true)"
  echo "    https://$d/ -> $code"
  echo "    http://$d/  -> ${redirect:-<no redirect>}"
done

log "Certificate now presented for ${DOMAINS%% *}"
echo | openssl s_client -servername "${DOMAINS%% *}" \
  -connect 127.0.0.1:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -enddate -ext subjectAltName

log "Done."

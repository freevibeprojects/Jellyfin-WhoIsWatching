#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Prepares a fresh Jellyfin server (startup wizard not yet run) with the e2e fixture users.
set -euo pipefail
B=${JF_URL:-http://127.0.0.1:8096}
H='Authorization: MediaBrowser Client="e2e", Device="setup", DeviceId="e2e-setup", Version="1"'
json() { curl -sf -H "$H${TOK:+, Token=\"$TOK\"}" -H 'Content-Type: application/json' "$@"; }
J() { node -pe "const d=JSON.parse(require('fs').readFileSync(0));$1"; }

json "$B/Startup/User" >/dev/null
json -d '{"UICulture":"en-US","MetadataCountryCode":"US","PreferredMetadataLanguage":"en"}' "$B/Startup/Configuration"
json -d '{"Name":"Alice","Password":"alicepw"}' "$B/Startup/User"
json -X POST "$B/Startup/Complete"
TOK=$(json -d '{"Username":"Alice","Pw":"alicepw"}' "$B/Users/AuthenticateByName" | J 'd.AccessToken')
for u in Kid: Bob:bobpw Hidden:; do
  json -d "{\"Name\":\"${u%%:*}\",\"Password\":\"${u#*:}\"}" "$B/Users/New" >/dev/null
done
# Jellyfin 12 hides new users from login screens by default; show all but "Hidden".
for id in $(json "$B/Users" | J 'd.filter(u=>u.Name!=="Hidden").map(u=>u.Id).join(" ")'); do
  json -d "$(json "$B/Users/$id" | J 'd.Policy.IsHidden=false;JSON.stringify(d.Policy)')" "$B/Users/$id/Policy"
done
# Bob gets an avatar (8x8 PNG), so e2e covers the avatar image path.
BOB=$(json "$B/Users" | J 'd.find(u=>u.Name==="Bob").Id')
curl -sf -H "$H, Token=\"$TOK\"" -H 'Content-Type: image/png' "$B/Users/$BOB/Images/Primary" \
  -d 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mOoll+EFTEMLQkA1MpPAZO6ZYYAAAAASUVORK5CYII='
json "$B/Users/Public" | J 'd.map(u=>u.Name).join(", ")'

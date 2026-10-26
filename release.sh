#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Builds releases/who-is-watching_<version>.zip for the version in the .csproj and lists it in
# manifest.json, the plugin repository Jellyfin reads. The catalog text comes from build.yaml.
# Then commit releases/ and manifest.json and push: servers pick the update up from GitHub.
set -euo pipefail
cd "$(dirname "$0")"
version=$(sed -n 's#.*<Version>\(.*\)</Version>.*#\1#p' Jellyfin.Plugin.WhoIsWatching/Jellyfin.Plugin.WhoIsWatching.csproj)
grep -q "^version: \"$version\"" build.yaml || { echo "build.yaml version differs from the .csproj ($version)" >&2; exit 1; }
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
# A full rebuild without a PDB, so the DLL carries no local build paths.
dotnet build Jellyfin.Plugin.WhoIsWatching -c Release -o "$out" --no-incremental -p:DebugType=none -p:ContinuousIntegrationBuild=true \
  -p:AllowMissingPrunePackageData=true >/dev/null
mkdir -p releases
zip="releases/who-is-watching_$version.zip"
rm -f "$zip"
# Zip times are local time; UTC keeps the build machine's time zone out of the release.
(cd "$out" && TZ=UTC python3 -I -m zipfile -c "$OLDPWD/$zip" Jellyfin.Plugin.WhoIsWatching.dll)
node - "$version" "$zip" <<'EOF'
const fs = require('fs');
const crypto = require('crypto');
const [version, zip] = process.argv.slice(2);
const raw = 'https://raw.githubusercontent.com/freevibeprojects/Jellyfin-WhoIsWatching/main';
const yaml = fs.readFileSync('build.yaml', 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout has CRLF
const field = key => yaml.match(new RegExp(`^${key}: "(.*)"$`, 'm'))[1];
const block = key => yaml.match(new RegExp(`^${key}: >\\n((?: {2}.*\\n?)+)`, 'm'))[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ');
const old = fs.existsSync('manifest.json') ? JSON.parse(fs.readFileSync('manifest.json', 'utf8'))[0].versions : [];
const manifest = [{
  guid: field('guid'),
  name: field('name'),
  description: block('description'),
  overview: field('overview'),
  owner: field('owner'),
  category: field('category'),
  versions: [{
    version,
    changelog: block('changelog'),
    targetAbi: field('targetAbi'),
    sourceUrl: `${raw}/${zip}`,
    checksum: crypto.createHash('md5').update(fs.readFileSync(zip)).digest('hex'),
    timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  }, ...old.filter(v => v.version !== version)]
}];
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`${zip} listed in manifest.json`);
EOF

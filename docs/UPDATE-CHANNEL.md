# Update Channel Runbook

How HiveMatrix self-updates, how to cut a release, and how to manage the
signing key and access token. The daemon checks a **release-channel manifest**,
verifies the payload (SHA-256 **and** Ed25519 signature, fail-closed), backs up
the SQLite DB, installs, restarts via launchd, health-probes, and rolls back on
a failed probe.

The reference channel is **GitHub Releases on `irvencassio/hivematrix`**.

## Trust model

- **Integrity + authenticity**: every release tarball has a SHA-256 recorded in
  the manifest, and the manifest carries an **Ed25519 signature over that
  SHA-256 hex**. The daemon refuses any update if the hash mismatches or the
  signature doesn't verify against the configured public key — and refuses
  entirely if no public key is configured (fail-closed).
- **Agents never hot-patch** the running system; updates only flow through this
  signed channel. Agents propose changes as PRs into the release repo.

## Keys

Generated locally by `scripts/release-sign.mts` on first run:

- Private key: `~/.hivematrix/keys/updater-ed25519-private.pem` (mode `600`).
  **Never commit or upload this.** It signs releases.
- Public key: `~/.hivematrix/keys/updater-ed25519-public.pem`. Baked into
  `config.updater.publicKeyPem` (or `publicKeyPath`) on every client.

### Key rotation

1. Move the old keypair aside: `mv ~/.hivematrix/keys/updater-ed25519-*.pem /tmp/`.
2. Re-run `release-sign.mts` — it generates a fresh keypair.
3. **Re-sign the current (and any still-served) release** with the new key, and
   re-upload the manifests.
4. Push the new `publicKeyPem` to every client's `config.updater` **before** they
   next check, or they'll (correctly) reject the re-signed manifest. For a fleet,
   ship the new public key in a release signed by the *old* key first, then cut
   over (standard two-step key rollover).
5. Destroy the old private key once no client trusts it any longer.

## Cutting a release

```bash
# 1. Build + notarize the app (see README)
cargo tauri build
bash scripts/build-app.sh
bash scripts/build-dmg.sh

# 2. Tar + sign → manifest.json + tarball (reuses or generates the keypair)
npx tsx scripts/release-sign.mts <version> \
  src-tauri/target/release/bundle/macos/HiveMatrix.app /tmp/hm-release

# 3. Publish the GitHub release with the assets
gh release create v<version> \
  /tmp/hm-release/HiveMatrix-<version>-macos.tar.gz \
  /tmp/hm-release/manifest.json \
  src-tauri/target/release/bundle/HiveMatrix-<version>.dmg \
  --title "HiveMatrix <version>" --notes "…"
```

`release-sign.mts` prints the public key — confirm it matches what clients trust.

## Client config (`config.updater`)

**Public repo** — the plain release download URL works, no token:

```json
{ "updater": {
  "channelUrl": "https://github.com/irvencassio/hivematrix/releases/download/v0.1.0/manifest.json",
  "channel": "stable",
  "publicKeyPath": "~/.hivematrix/keys/updater-ed25519-public.pem"
} }
```

**Private repo** — public download URLs 404; use the GitHub **API asset URL**
with a token. The daemon resolves the tarball's API asset URL automatically at
apply time.

```json
{ "updater": {
  "channelUrl": "https://api.github.com/repos/irvencassio/hivematrix/releases/assets/<MANIFEST_ASSET_ID>",
  "channel": "stable",
  "accept": "application/octet-stream",
  "authTokenPath": "~/.hivematrix/keys/github-token",
  "publicKeyPath": "~/.hivematrix/keys/updater-ed25519-public.pem"
} }
```

Get the manifest asset id:
`gh api repos/irvencassio/hivematrix/releases/tags/v<version> --jq '.assets[]|select(.name=="manifest.json").id'`

### PAT scoping (private channel)

The token only needs to **read release assets** — scope it minimally:

- **Fine-grained PAT** (recommended): repository access limited to
  `irvencassio/hivematrix`, permission **Contents: Read-only**. Nothing else.
- Classic PAT: `repo` scope (broader — avoid if a fine-grained token works).
- Store at `~/.hivematrix/keys/github-token`, mode `600`. Rotate by replacing
  the file; set a calendar reminder before the PAT expiry.
- The demo currently uses the local `gh` CLI token — **replace it with a
  fine-grained Contents:Read PAT** for an unattended deployment.

## Verify

```bash
curl -s http://127.0.0.1:3747/update/check | python3 -m json.tool
# → configured:true, latestVersion:"<v>", signatureReady:true
```

`available:true` appears only when the channel advertises a version newer than
the running one. Apply is staged, DB-backed-up, and rolls back on a failed probe
(`scripts/update-apply-proof.mts` exercises the full cycle safely).

import assert from "node:assert/strict";
import test from "node:test";

const { isTailnetAddress, hostOnMesh, parseTailscaleStatusJSON, filterStunOnly } =
  await import(`./tailscale.ts?case=${Date.now()}`);

test("isTailnetAddress accepts the 100.64.0.0/10 CGNAT range only", () => {
  assert.equal(isTailnetAddress("100.64.0.1"), true);
  assert.equal(isTailnetAddress("100.101.102.103"), true);
  assert.equal(isTailnetAddress("100.127.255.255"), true);
  assert.equal(isTailnetAddress("100.63.255.255"), false);
  assert.equal(isTailnetAddress("100.128.0.1"), false);
  assert.equal(isTailnetAddress("10.0.0.1"), false);
  assert.equal(isTailnetAddress("192.168.1.1"), false);
  assert.equal(isTailnetAddress("not-an-ip"), false);
});

test("hostOnMesh: tailnet IP or *.ts.net host, port-agnostic", () => {
  assert.equal(hostOnMesh("100.101.102.103:3747"), true);
  assert.equal(hostOnMesh("100.101.102.103"), true);
  assert.equal(hostOnMesh("mac.tail1234.ts.net"), true);
  assert.equal(hostOnMesh("mac.tail1234.ts.net:3747"), true);
  assert.equal(hostOnMesh("hivey.cassio.io"), false);
  assert.equal(hostOnMesh("127.0.0.1:3747"), false);
  assert.equal(hostOnMesh("localhost"), false);
  assert.equal(hostOnMesh(undefined), false);
  assert.equal(hostOnMesh(""), false);
});

test("parseTailscaleStatusJSON extracts running + ipv4 + magicDNS + pairingUrl", () => {
  const raw = JSON.stringify({
    BackendState: "Running",
    Self: {
      TailscaleIPs: ["100.101.102.103", "fd7a:115c:a1e0::1234"],
      DNSName: "mac.tail1234.ts.net.",
    },
  });
  const s = parseTailscaleStatusJSON(raw, 3747);
  assert.equal(s.running, true);
  assert.equal(s.ipv4, "100.101.102.103");
  assert.equal(s.magicDNSName, "mac.tail1234.ts.net"); // trailing dot stripped
  // Reachable via `tailscale serve` as HTTPS on the MagicDNS name, not raw IP:port.
  assert.equal(s.pairingUrl, "https://mac.tail1234.ts.net");
});

test("parseTailscaleStatusJSON is safe on malformed input and stopped backend", () => {
  const bad = parseTailscaleStatusJSON("not json", 3747);
  assert.deepEqual(bad, { running: false, ipv4: null, magicDNSName: null, pairingUrl: null });

  const stopped = parseTailscaleStatusJSON(JSON.stringify({ BackendState: "Stopped", Self: {} }), 3747);
  assert.equal(stopped.running, false);
  assert.equal(stopped.ipv4, null);
  assert.equal(stopped.pairingUrl, null);

  // Running with an IP but no MagicDNS name → no reliable serve URL.
  const noDns = parseTailscaleStatusJSON(
    JSON.stringify({ BackendState: "Running", Self: { TailscaleIPs: ["100.64.0.9"] } }),
    3747,
  );
  assert.equal(noDns.ipv4, "100.64.0.9");
  assert.equal(noDns.pairingUrl, null);
});

test("filterStunOnly drops any entry containing a turn/turns url", () => {
  const servers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:turn.cloudflare.com:3478", username: "u", credential: "c" },
    { urls: ["stun:a.example:3478", "turns:b.example:5349"] }, // mixed → dropped
    { urls: ["stun:c.example:3478", "stun:d.example:3478"] },  // all stun → kept
  ];
  const out = filterStunOnly(servers);
  assert.deepEqual(out, [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: ["stun:c.example:3478", "stun:d.example:3478"] },
  ]);
});

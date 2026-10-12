import assert from "node:assert/strict";
import test from "node:test";
import {
  clientIpRateLimitKey,
  getClientIp,
  readTrustedProxyMode,
} from "../security/client-ip.js";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://store.example/api/v1/orders", { method: "POST", headers });
}

const spoofedHeaders = {
  "X-Forwarded-For": "203.0.113.7, 198.51.100.1",
  "CF-Connecting-IP": "203.0.113.8",
  "X-Real-IP": "192.0.2.10",
};

test("trusted proxy mode is read from env and defaults to none", () => {
  assert.equal(readTrustedProxyMode({}), "none");
  assert.equal(readTrustedProxyMode({ TRUSTED_PROXY: "" }), "none");
  assert.equal(readTrustedProxyMode({ TRUSTED_PROXY: "nginx" }), "nginx");
  assert.equal(readTrustedProxyMode({ TRUSTED_PROXY: " Cloudflare " }), "cloudflare");
  assert.equal(readTrustedProxyMode({ TRUSTED_PROXY: "none" }), "none");
  assert.throws(() => readTrustedProxyMode({ TRUSTED_PROXY: "x-forwarded-for" }), /TRUSTED_PROXY/);
});

test("nginx mode reads only X-Real-IP set by nginx", () => {
  assert.equal(getClientIp(requestWithHeaders(spoofedHeaders), "nginx"), "192.0.2.10");
  // Spoofed CF-Connecting-IP / X-Forwarded-For are ignored when nginx did not set X-Real-IP.
  assert.equal(
    getClientIp(
      requestWithHeaders({ "CF-Connecting-IP": "203.0.113.8", "X-Forwarded-For": "203.0.113.7" }),
      "nginx",
    ),
    null,
  );
  assert.equal(getClientIp(requestWithHeaders({ "X-Real-IP": "2001:db8::1" }), "nginx"), "2001:db8::1");
});

test("cloudflare mode reads only CF-Connecting-IP", () => {
  assert.equal(getClientIp(requestWithHeaders(spoofedHeaders), "cloudflare"), "203.0.113.8");
  assert.equal(
    getClientIp(requestWithHeaders({ "X-Real-IP": "192.0.2.10", "X-Forwarded-For": "203.0.113.7" }), "cloudflare"),
    null,
  );
});

test("none mode never trusts client headers", () => {
  assert.equal(getClientIp(requestWithHeaders(spoofedHeaders), "none"), null);
});

test("malformed or list-valued addresses are rejected", () => {
  for (const value of ["unknown", "203.0.113.7, 198.51.100.1", "999.1.1.1", "fe80::1%eth0", "1.2.3.4 ", "<script>"]) {
    assert.equal(getClientIp(requestWithHeaders({ "X-Real-IP": value }), "nginx"), value === "1.2.3.4 " ? "1.2.3.4" : null, value);
  }
});

test("rate limit key groups IPv6 by /64 and unwraps IPv4-mapped addresses", () => {
  assert.equal(clientIpRateLimitKey(null), null);
  assert.equal(clientIpRateLimitKey("203.0.113.7"), "203.0.113.7");
  assert.equal(clientIpRateLimitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(clientIpRateLimitKey("2001:db8:1:2::1"), "2001:db8:1:2::/64");
  assert.equal(clientIpRateLimitKey("2001:DB8:1:2:ffff::"), "2001:db8:1:2::/64");
  assert.equal(clientIpRateLimitKey("::1"), "0:0:0:0::/64");
  assert.equal(clientIpRateLimitKey("::ffff:198.51.100.4"), "198.51.100.4");
  assert.equal(clientIpRateLimitKey("::ffff:c633:6404"), "198.51.100.4");
  assert.equal(clientIpRateLimitKey("not-an-ip"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { DELETE } from "../../app/api/auth/session/route.js";

// Read at call time: without a database sign-out only clears the cookie
// (revocation needs PostgreSQL), and the request origin is the store origin.
delete process.env.DATABASE_URL;
delete process.env.NEXT_PUBLIC_SITE_URL;

function logoutRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/session", {
    method: "DELETE",
    headers: { cookie: "apex_session=token-value", ...headers },
  });
}

function clearsSessionCookie(response: Response): boolean {
  const cookie = response.headers.get("set-cookie") ?? "";
  return /apex_session=;/.test(cookie) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(cookie);
}

test("sign-out from a store page (same-origin fetch) works", async () => {
  const sameOrigin: Array<Record<string, string>> = [
    { origin: "http://localhost:3000" },
    { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
    { "sec-fetch-site": "same-origin" },
  ];
  for (const headers of sameOrigin) {
    const response = await DELETE(logoutRequest(headers));
    assert.equal(response.status, 200, JSON.stringify(headers));
    assert.deepEqual(await response.json(), { ok: true });
    assert.ok(clearsSessionCookie(response), "the session cookie is cleared");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("sign-out from another site or without browser headers is refused and changes nothing", async () => {
  const foreign: Array<Record<string, string>> = [
    { origin: "https://evil.example" },
    { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "cross-site" },
    {},
  ];
  for (const headers of foreign) {
    const response = await DELETE(logoutRequest(headers));
    assert.equal(response.status, 403, JSON.stringify(headers));
    const body = (await response.json()) as { code?: string };
    assert.equal(body.code, "UNTRUSTED_ORIGIN");
    assert.equal(response.headers.get("set-cookie"), null, "the session cookie stays");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { readSessionToken } from "../security/request-auth.js";
import { roleHasAccess } from "../services/auth-service.js";

test("session token is read only from the named cookie", () => {
  assert.equal(
    readSessionToken("theme=dark; apex_session=secure%20token; locale=ru"),
    "secure token",
  );
  assert.equal(readSessionToken("theme=dark"), null);
  assert.equal(readSessionToken("apex_session=%invalid"), null);
});

test("manager and admin roles can be checked explicitly", () => {
  assert.equal(roleHasAccess("manager", ["manager", "admin"]), true);
  assert.equal(roleHasAccess("customer", ["manager", "admin"]), false);
});

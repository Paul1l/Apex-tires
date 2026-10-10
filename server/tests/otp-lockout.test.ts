import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AuthRepository } from "../repositories/auth-repository.js";
import { AuthService } from "../services/auth-service.js";
import { ApplicationError } from "../utils/errors.js";

interface ChallengeRow {
  id: string;
  destination_hash: string;
  requester_hash: string;
  intent: "login" | "register";
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

function createHarness(options: { maximumFailures?: number } = {}) {
  let now = Date.UTC(2026, 9, 10, 9, 0, 0);
  const challenges = new Map<string, ChallengeRow>();
  const users = new Map<string, { id: string; email: string; phone: null; name: string; role: "admin"; status: "active" }>();
  let lastCode = "";
  const repository = {
    async findMostRecentChallenge(_database: unknown, destinationHash: string) {
      return [...challenges.values()]
        .filter((challenge) => challenge.destination_hash === destinationHash)
        .sort((left, right) => right.created_at.getTime() - left.created_at.getTime())[0] ?? null;
    },
    async countChallengesSince(_database: unknown, field: "destination_hash" | "requester_hash", digest: string, since: Date) {
      return [...challenges.values()].filter((challenge) => challenge[field] === digest && challenge.created_at >= since).length;
    },
    async listFailedAttemptsSince(_database: unknown, destinationHash: string, since: Date) {
      return [...challenges.values()]
        .filter((challenge) => challenge.destination_hash === destinationHash && challenge.created_at >= since && challenge.attempts > 0)
        .sort((left, right) => left.created_at.getTime() - right.created_at.getTime())
        .map((challenge) => ({ created_at: challenge.created_at, attempts: challenge.attempts }));
    },
    async lockDestinationForVerification() {},
    async createChallenge(_database: unknown, challenge: { id: string; destinationHash: string; requesterHash: string; intent: "login" | "register"; codeHash: string; expiresAt: Date }) {
      challenges.set(challenge.id, {
        id: challenge.id,
        destination_hash: challenge.destinationHash,
        requester_hash: challenge.requesterHash,
        intent: challenge.intent,
        code_hash: challenge.codeHash,
        attempts: 0,
        expires_at: challenge.expiresAt,
        consumed_at: null,
        created_at: new Date(now),
      });
    },
    async deleteChallenge(_database: unknown, id: string) { challenges.delete(id); },
    async findChallengeForUpdate(_database: unknown, id: string) {
      const challenge = challenges.get(id);
      return challenge ? { ...challenge } : null;
    },
    async incrementChallengeAttempts(_database: unknown, id: string) { challenges.get(id)!.attempts += 1; },
    async consumeChallenge(_database: unknown, id: string) { challenges.get(id)!.consumed_at = new Date(now); },
    async findUserByEmail(_database: unknown, email: string) { return users.get(email) ?? null; },
    async createSession() {},
    async findUserBySessionTokenHash() { return null; },
    async deleteSessionByTokenHash() {},
  };
  const database = { async query() { return { rows: [] }; }, release() {} };
  const pool = { async connect() { return database; } } as unknown as Pool;
  const service = new AuthService({
    pool,
    repository: repository as unknown as AuthRepository,
    securitySecret: "x".repeat(40),
    emailEnvironment: {},
    sendCode: async (_environment, _email, code) => { lastCode = code; },
    maximumFailedAttemptsPerDestination: options.maximumFailures,
  });
  users.set("admin@shop.ru", { id: "u-admin", email: "admin@shop.ru", phone: null, name: "Admin", role: "admin", status: "active" });
  return {
    service,
    advance(milliseconds: number) { now += milliseconds; },
    now: () => now,
    lastCode: () => lastCode,
  };
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return error instanceof ApplicationError ? error.code : String(error);
  }
}

test("failed codes are limited per email across challenges and lock even the correct code", async (context) => {
  const harness = createHarness();
  context.mock.method(Date, "now", () => harness.now());
  const verify = (challengeId: string, code: string) =>
    harness.service.verifyEmailCode({
      challengeId,
      rawEmail: "admin@shop.ru",
      code,
      personalDataConsent: false,
      termsAccepted: false,
      requesterAddress: null,
      userAgent: null,
    });
  const wrongCode = () => (harness.lastCode() === "123456" ? "654321" : "123456");

  const responses: Record<string, number> = {};
  let incorrect = 0;
  // An attacker keeps requesting codes (3 per 10 minutes) and guessing for 24 hours.
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    harness.advance(60_000);
    const requested = await errorCode(
      harness.service.requestEmailCode({ rawEmail: "admin@shop.ru", intent: "login", requesterAddress: `198.51.100.${minute % 250}` }).then((challenge) => {
        (harness as { challengeId?: string }).challengeId = challenge.challengeId;
      }),
    );
    if (requested !== "OK") {
      responses[requested] = (responses[requested] ?? 0) + 1;
      continue;
    }
    const challengeId = (harness as { challengeId?: string }).challengeId!;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = await errorCode(verify(challengeId, wrongCode()));
      responses[code] = (responses[code] ?? 0) + 1;
      if (code === "CODE_INCORRECT") incorrect += 1;
    }
  }
  assert.equal(incorrect, 15, JSON.stringify(responses));

  // While locked, a new code cannot be requested and even the right code is refused.
  const lockedRequest = await errorCode(
    harness.service.requestEmailCode({ rawEmail: "admin@shop.ru", intent: "login", requesterAddress: "203.0.113.1" }),
  );
  assert.equal(lockedRequest, "RATE_LIMIT_EXCEEDED");
});

test("the correct code is refused while the email is locked and accepted after the window", async (context) => {
  const harness = createHarness({ maximumFailures: 3 });
  context.mock.method(Date, "now", () => harness.now());
  const first = await harness.service.requestEmailCode({ rawEmail: "admin@shop.ru", intent: "login", requesterAddress: "a" });
  const correctCode = harness.lastCode();
  const wrong = correctCode === "123456" ? "654321" : "123456";
  const verify = (code: string) =>
    harness.service.verifyEmailCode({
      challengeId: first.challengeId,
      rawEmail: "admin@shop.ru",
      code,
      personalDataConsent: false,
      termsAccepted: false,
      requesterAddress: null,
      userAgent: null,
    });
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal(await errorCode(verify(wrong)), "CODE_INCORRECT");

  await assert.rejects(
    verify(correctCode),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "RATE_LIMIT_EXCEEDED" &&
      error.statusCode === 429 &&
      /24 ч\.|заблокирован/.test(error.message),
  );

  harness.advance(24 * 60 * 60 * 1_000 + 60_000);
  const second = await harness.service.requestEmailCode({ rawEmail: "admin@shop.ru", intent: "login", requesterAddress: "a" });
  const session = await harness.service.verifyEmailCode({
    challengeId: second.challengeId,
    rawEmail: "admin@shop.ru",
    code: harness.lastCode(),
    personalDataConsent: false,
    termsAccepted: false,
    requesterAddress: null,
    userAgent: null,
  });
  assert.equal(session.user.email, "admin@shop.ru");
});

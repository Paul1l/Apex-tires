import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { SessionAuthMethod } from "../../lib/auth/session.js";
import type { AuthRepository, UserRole } from "../repositories/auth-repository.js";
import type {
  StaffLoginCandidateRow,
  StaffMemberRow,
  StaffRepository,
  StaffTrustedDeviceRow,
  StaffUserRow,
  UserStatus,
} from "../repositories/staff-repository.js";
import {
  MAXIMUM_DEVICE_TOKENS_PER_COOKIE,
  nextStaffDeviceTokens,
  parseStaffDeviceCookie,
  serializeStaffDeviceCookie,
  STAFF_DEVICE_COOKIE_PATH,
  STAFF_DEVICE_LIFETIME_SECONDS,
  staffDeviceCookieOptions,
} from "../security/staff-devices.js";
import { decryptStaffSecret, deriveStaffSecretKey } from "../security/staff-secret-box.js";
import { decodeBase32, generateHotp, totpTimeStep } from "../security/totp.js";
import {
  STAFF_LOGIN_FAILED_MESSAGE,
  STAFF_LOGIN_LOCK_SECONDS,
  StaffAuthService,
} from "../services/staff-auth-service.js";
import { StaffManagementService } from "../services/staff-management-service.js";
import type { ApplicationLogger, JsonValue } from "../types/common.js";
import { ApplicationError } from "../utils/errors.js";

const PEPPER = "x".repeat(48);
const ENCRYPTION_KEY = deriveStaffSecretKey(PEPPER);

interface UserRecord extends StaffUserRow {
  created_at: Date;
}

interface DeviceRecord {
  id: string;
  user_id: string;
  token_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  expires_at: Date;
  last_used_at: Date;
}

interface CredentialRecord {
  secret_ciphertext: string;
  confirmed_at: Date | null;
  last_used_step: string | null;
  failed_attempts: number;
  locked_until: Date | null;
}

/** In-memory StaffRepository with the same rules as the SQL (migration 010). */
function createHarness() {
  let now = Date.UTC(2026, 9, 11, 9, 0, 10);
  const users = new Map<string, UserRecord>();
  const credentials = new Map<string, CredentialRecord>();
  const sessions: Array<{ userId: string; authMethod: SessionAuthMethod; expiresAt: Date; tokenHash: string }> = [];
  const audit: Array<{ actorUserId: string | null; action: string; entityId: string; details: JsonValue }> = [];
  const devices = new Map<string, DeviceRecord>();
  const liveDevice = (userId: string | undefined, tokenHashes: readonly string[]): StaffTrustedDeviceRow | null => {
    const device = [...devices.values()]
      .filter((item) => item.user_id === userId && tokenHashes.includes(item.token_hash) && item.expires_at.getTime() > now)
      .sort((left, right) => right.last_used_at.getTime() - left.last_used_at.getTime())[0];
    return device ? { ...device } : null;
  };
  const logs: Array<{ context: Record<string, unknown>; message: string }> = [];

  const memberRow = (user: UserRecord): StaffMemberRow => {
    const credential = credentials.get(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      created_at: user.created_at,
      enrolled: Boolean(credential),
      confirmed_at: credential?.confirmed_at ?? null,
      locked_until: credential?.locked_until ?? null,
    };
  };
  const findByEmail = (email: string) => [...users.values()].find((user) => user.email === email) ?? null;

  const repository = {
    async findLoginCandidateForUpdate(_database: unknown, email: string): Promise<StaffLoginCandidateRow | null> {
      const user = findByEmail(email);
      const credential = user && credentials.get(user.id);
      if (!user || !credential) return null;
      return { ...user, ...credential };
    },
    async recordLoginFailure(_database: unknown, userId: string, limits: { maximumFailures: number; lockSeconds: number }) {
      const credential = credentials.get(userId)!;
      credential.failed_attempts += 1;
      const locked = credential.failed_attempts >= limits.maximumFailures;
      if (locked) credential.locked_until = new Date(now + limits.lockSeconds * 1_000);
      return { failed_attempts: credential.failed_attempts, locked };
    },
    async recordLoginSuccess(
      _database: unknown,
      userId: string,
      step: number,
      options: { resetAccountLockout: boolean } = { resetAccountLockout: true },
    ) {
      const credential = credentials.get(userId)!;
      if (credential.last_used_step !== null && Number(credential.last_used_step) >= step) return false;
      if (options.resetAccountLockout) {
        credential.failed_attempts = 0;
        credential.locked_until = null;
      }
      credential.last_used_step = String(step);
      credential.confirmed_at ??= new Date(now);
      return true;
    },
    async findTrustedDeviceByEmail(_database: unknown, email: string, tokenHashes: readonly string[]) {
      return liveDevice(findByEmail(email)?.id, tokenHashes);
    },
    async findTrustedDeviceForUpdate(_database: unknown, userId: string, tokenHashes: readonly string[]) {
      return liveDevice(userId, tokenHashes);
    },
    async recordDeviceFailure(_database: unknown, deviceId: string, limits: { maximumFailures: number; lockSeconds: number }) {
      const device = devices.get(deviceId)!;
      device.failed_attempts += 1;
      const locked = device.failed_attempts >= limits.maximumFailures;
      if (locked) device.locked_until = new Date(now + limits.lockSeconds * 1_000);
      return { failed_attempts: device.failed_attempts, locked };
    },
    async rotateTrustedDevice(_database: unknown, deviceId: string, tokenHash: string, lifetimeSeconds: number) {
      Object.assign(devices.get(deviceId)!, {
        token_hash: tokenHash,
        last_used_at: new Date(now),
        expires_at: new Date(now + lifetimeSeconds * 1_000),
        failed_attempts: 0,
        locked_until: null,
      });
    },
    async createTrustedDevice(
      _database: unknown,
      device: { userId: string; tokenHash: string; lifetimeSeconds: number; maximumDevices: number },
    ) {
      const id = crypto.randomUUID();
      devices.set(id, {
        id,
        user_id: device.userId,
        token_hash: device.tokenHash,
        failed_attempts: 0,
        locked_until: null,
        expires_at: new Date(now + device.lifetimeSeconds * 1_000),
        last_used_at: new Date(now),
      });
      const own = [...devices.values()]
        .filter((item) => item.user_id === device.userId)
        .sort((left, right) => right.last_used_at.getTime() - left.last_used_at.getTime());
      own.forEach((item, index) => {
        if (index >= device.maximumDevices || item.expires_at.getTime() <= now) devices.delete(item.id);
      });
    },
    async deleteTrustedDevicesForUser(_database: unknown, userId: string) {
      let removed = 0;
      for (const device of [...devices.values()]) {
        if (device.user_id === userId) {
          devices.delete(device.id);
          removed += 1;
        }
      }
      return removed;
    },
    async listStaff() {
      return [...users.values()].filter((user) => user.role !== "customer").map(memberRow);
    },
    async findStaffMember(_database: unknown, userId: string) {
      const user = users.get(userId);
      return user ? memberRow(user) : null;
    },
    async lockStaffChanges() {},
    async findUserByEmailForUpdate(_database: unknown, email: string) {
      const user = findByEmail(email);
      return user ? { ...user } : null;
    },
    async findUserByIdForUpdate(_database: unknown, userId: string) {
      const user = users.get(userId);
      return user ? { ...user } : null;
    },
    async createUser(_database: unknown, user: { id: string; email: string; name: string; role: UserRole }) {
      const record: UserRecord = { ...user, phone: null, status: "active", created_at: new Date(now) };
      users.set(user.id, record);
      return { ...record };
    },
    async updateUser(_database: unknown, userId: string, changes: { name?: string; role: UserRole; status: UserStatus }) {
      const user = users.get(userId)!;
      if (changes.name) user.name = changes.name;
      user.role = changes.role;
      user.status = changes.status;
      return { ...user };
    },
    async countActiveAdministratorsExcept(_database: unknown, userId: string) {
      return [...users.values()].filter(
        (user) => user.role === "admin" && user.status === "active" && user.id !== userId,
      ).length;
    },
    async replaceCredential(_database: unknown, userId: string, secretCiphertext: string) {
      credentials.set(userId, {
        secret_ciphertext: secretCiphertext,
        confirmed_at: null,
        last_used_step: null,
        failed_attempts: 0,
        locked_until: null,
      });
    },
    async deleteCredential(_database: unknown, userId: string) {
      credentials.delete(userId);
    },
    async deleteSessionsForUser(_database: unknown, userId: string) {
      let removed = 0;
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (sessions[index].userId === userId) {
          sessions.splice(index, 1);
          removed += 1;
        }
      }
      return removed;
    },
    async recordAudit(_database: unknown, event: { actorUserId: string | null; action: string; entityId: string; details: JsonValue }) {
      audit.push(event);
    },
  };
  const authRepository = {
    async createSession(
      _database: unknown,
      session: { id: string; userId: string; tokenHash: string; expiresAt: Date; authMethod?: SessionAuthMethod },
    ) {
      sessions.push({
        userId: session.userId,
        authMethod: session.authMethod ?? "customer_otp",
        expiresAt: session.expiresAt,
        tokenHash: session.tokenHash,
      });
    },
  };
  const client = {
    async query() {
      return { rows: [] };
    },
    release() {},
    on() {},
    removeListener() {},
  };
  const pool = { async connect() { return client; } } as unknown as Pool;
  const logger: ApplicationLogger = {
    error(context, message) { logs.push({ context, message }); },
    warn(context, message) { logs.push({ context, message }); },
  };
  const management = new StaffManagementService({
    pool,
    repository: repository as unknown as StaffRepository,
    encryptionKey: ENCRYPTION_KEY,
    issuer: "APEX WHEELS",
    now: () => now,
  });
  const auth = new StaffAuthService({
    pool,
    repository: repository as unknown as StaffRepository,
    authRepository: authRepository as unknown as AuthRepository,
    securitySecret: PEPPER,
    encryptionKey: ENCRYPTION_KEY,
    now: () => now,
    logger,
  });

  function addUser(user: { email: string; role: UserRole; status?: UserStatus; name?: string }) {
    const id = crypto.randomUUID();
    users.set(id, {
      id,
      email: user.email,
      phone: null,
      name: user.name ?? "Сотрудник",
      role: user.role,
      status: user.status ?? "active",
      created_at: new Date(now),
    });
    return id;
  }

  return {
    management,
    auth,
    users,
    credentials,
    sessions,
    audit,
    logs,
    devices,
    addUser,
    now: () => now,
    advance(milliseconds: number) { now += milliseconds; },
    addSession(userId: string, authMethod: SessionAuthMethod = "customer_otp") {
      sessions.push({ userId, authMethod, expiresAt: new Date(now + 3_600_000), tokenHash: crypto.randomUUID() });
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

function currentCode(harness: Harness, secretBase32: string, stepOffset = 0): string {
  return generateHotp(decodeBase32(secretBase32), totpTimeStep(harness.now()) + stepOffset);
}

function wrongCode(harness: Harness, secretBase32: string): string {
  const valid = new Set([-1, 0, 1].map((offset) => currentCode(harness, secretBase32, offset)));
  let candidate = 0;
  while (valid.has(String(candidate).padStart(6, "0"))) candidate += 1;
  return String(candidate).padStart(6, "0");
}

async function assertApplicationError(promise: Promise<unknown>, statusCode: number, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApplicationError, String(error));
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    return true;
  });
}

async function assertLoginRefused(harness: Harness, email: string, code: string) {
  await assert.rejects(harness.auth.login({ email, code }), (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.statusCode, 401);
    assert.equal(error.code, "STAFF_LOGIN_FAILED");
    assert.equal(error.message, STAFF_LOGIN_FAILED_MESSAGE);
    return true;
  });
}

async function createEnrolledStaff(harness: Harness, email = "manager@shop.ru", role: "manager" | "admin" = "manager") {
  const actorId = harness.addUser({ email: `boss-${crypto.randomUUID()}@shop.ru`, role: "admin" });
  const created = await harness.management.createStaff(actorId, { email, name: "Мария", role });
  return { actorId, ...created };
}

// --- Sign-in ---

test("a correct code opens a 12-hour staff session and confirms the key", async () => {
  const harness = createHarness();
  const { member, enrollment } = await createEnrolledStaff(harness);
  assert.equal(member.confirmed, false);

  const session = await harness.auth.login({ email: "manager@shop.ru", code: currentCode(harness, enrollment.secret) });
  assert.equal(session.user.role, "manager");
  assert.equal(session.expiresInSeconds, 12 * 60 * 60);
  assert.match(session.token, /^[0-9a-f]{64}$/);

  const staffSessions = harness.sessions.filter((item) => item.userId === member.id);
  assert.equal(staffSessions.length, 1);
  assert.equal(staffSessions[0].authMethod, "staff_totp");
  assert.equal(staffSessions[0].expiresAt.getTime(), harness.now() + 12 * 3_600_000);
  assert.notEqual(staffSessions[0].tokenHash, session.token, "only the HMAC of the token is stored");
  assert.ok(harness.credentials.get(member.id)?.confirmed_at);
  assert.ok(harness.audit.some((event) => event.action === "staff.login" && event.entityId === member.id));
});

test("one code cannot be used twice, and an older code after a newer one is refused", async () => {
  const harness = createHarness();
  const { enrollment } = await createEnrolledStaff(harness);
  const code = currentCode(harness, enrollment.secret);
  await harness.auth.login({ email: "manager@shop.ru", code });
  await assertLoginRefused(harness, "manager@shop.ru", code);

  harness.advance(30_000);
  await harness.auth.login({ email: "manager@shop.ru", code: currentCode(harness, enrollment.secret) });
  // The code of the previous step is still inside the ±1 window but already superseded.
  await assertLoginRefused(harness, "manager@shop.ru", currentCode(harness, enrollment.secret, -1));
  assert.ok(harness.logs.some((log) => log.context.reason === "replayed_code"));
});

test("5 wrong codes lock the account for 15 minutes, even for a correct code", async () => {
  const harness = createHarness();
  const { member, enrollment } = await createEnrolledStaff(harness);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assertLoginRefused(harness, "manager@shop.ru", wrongCode(harness, enrollment.secret));
  }
  assert.equal(harness.credentials.get(member.id)?.failed_attempts, 5);
  assert.ok(harness.audit.some((event) => event.action === "staff.login_locked"));

  await assertLoginRefused(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  assert.ok(harness.logs.some((log) => log.context.reason === "locked"));
  assert.equal(harness.sessions.filter((item) => item.userId === member.id).length, 0);

  harness.advance(STAFF_LOGIN_LOCK_SECONDS * 1_000 + 1_000);
  await harness.auth.login({ email: "manager@shop.ru", code: currentCode(harness, enrollment.secret) });
  assert.equal(harness.credentials.get(member.id)?.failed_attempts, 0);
  assert.equal(harness.credentials.get(member.id)?.locked_until, null);
});

test("unknown, blocked, customer and non-enrolled accounts get the same answer", async () => {
  const harness = createHarness();
  const { member, enrollment, actorId } = await createEnrolledStaff(harness);
  const code = currentCode(harness, enrollment.secret);

  await assertLoginRefused(harness, "nobody@shop.ru", code);

  await harness.management.updateStaff(actorId, member.id, { status: "blocked" });
  await assertLoginRefused(harness, "manager@shop.ru", code);

  const customerId = harness.addUser({ email: "customer@shop.ru", role: "customer" });
  harness.credentials.set(customerId, { ...harness.credentials.get(member.id)! });
  await assertLoginRefused(harness, "customer@shop.ru", code);

  harness.addUser({ email: "legacy-admin@shop.ru", role: "admin" });
  await assertLoginRefused(harness, "legacy-admin@shop.ru", code);

  const reasons = harness.logs.map((log) => log.context.reason);
  assert.deepEqual(reasons, ["unknown_account", "blocked", "not_staff", "unknown_account"]);
  for (const log of harness.logs) {
    const text = JSON.stringify(log);
    assert.ok(!text.includes("@"), "no email in logs");
    assert.ok(!text.includes(code), "no code in logs");
  }
});

test("a key that cannot be decrypted (pepper rotated) refuses the sign-in and is logged", async () => {
  const harness = createHarness();
  const { member, enrollment } = await createEnrolledStaff(harness);
  const credential = harness.credentials.get(member.id)!;
  const [version, iv, data, tag] = credential.secret_ciphertext.split(".");
  credential.secret_ciphertext = [version, iv, `${data.slice(0, -4)}AAAA`, tag].join(".");
  await assertLoginRefused(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  assert.ok(harness.logs.some((log) => log.context.reason === "key_unreadable"));
});

// --- Staff management rules ---

test("adding staff stores only an encrypted key and returns it once", async () => {
  const harness = createHarness();
  const { member, enrollment, promoted, actorId } = await createEnrolledStaff(harness, "new@shop.ru", "admin");
  assert.equal(promoted, false);
  assert.equal(member.role, "admin");
  assert.equal(member.enrolled, true);
  const stored = harness.credentials.get(member.id)!.secret_ciphertext;
  assert.ok(!stored.includes(enrollment.secret));
  assert.deepEqual(decryptStaffSecret(stored, ENCRYPTION_KEY, member.id), decodeBase32(enrollment.secret));
  assert.ok(enrollment.otpauthUri.startsWith("otpauth://totp/APEX%20WHEELS:new%40shop.ru?"));
  const event = harness.audit.find((item) => item.action === "staff.created");
  assert.equal(event?.actorUserId, actorId);
  assert.ok(!JSON.stringify(harness.audit).includes(enrollment.secret), "no key in the audit log");

  await assertApplicationError(
    harness.management.createStaff(actorId, { email: "new@shop.ru", name: "Дубль", role: "manager" }),
    409,
    "STAFF_ALREADY_EXISTS",
  );
});

test("an existing customer is promoted and signed out", async () => {
  const harness = createHarness();
  const actorId = harness.addUser({ email: "boss@shop.ru", role: "admin" });
  const customerId = harness.addUser({ email: "buyer@shop.ru", role: "customer", name: "Покупатель" });
  harness.addSession(customerId);
  const result = await harness.management.createStaff(actorId, { email: "buyer@shop.ru", name: "Иван", role: "manager" });
  assert.equal(result.promoted, true);
  assert.equal(result.member.id, customerId);
  assert.equal(harness.users.get(customerId)?.role, "manager");
  assert.equal(harness.sessions.filter((item) => item.userId === customerId).length, 0);
  assert.ok(harness.audit.some((event) => event.action === "staff.promoted"));
});

test("nobody changes their own role or status", async () => {
  const harness = createHarness();
  const actorId = harness.addUser({ email: "boss@shop.ru", role: "admin" });
  harness.addUser({ email: "second@shop.ru", role: "admin" });
  for (const changes of [{ role: "manager" as const }, { role: "customer" as const }, { status: "blocked" as const }]) {
    await assertApplicationError(
      harness.management.updateStaff(actorId, actorId, changes),
      409,
      "STAFF_SELF_CHANGE_FORBIDDEN",
    );
  }
  assert.equal(harness.users.get(actorId)?.role, "admin");
});

test("the last active administrator cannot be demoted, revoked or blocked", async () => {
  const harness = createHarness();
  const lastAdmin = harness.addUser({ email: "last@shop.ru", role: "admin" });
  // The actor here is a manager row only to reach the rule (the API itself
  // requires an admin); a blocked admin does not count as active.
  const actor = harness.addUser({ email: "manager@shop.ru", role: "manager" });
  harness.addUser({ email: "blocked-admin@shop.ru", role: "admin", status: "blocked" });
  for (const changes of [{ role: "manager" as const }, { role: "customer" as const }, { status: "blocked" as const }]) {
    await assertApplicationError(
      harness.management.updateStaff(actor, lastAdmin, changes),
      409,
      "LAST_ADMIN_REQUIRED",
    );
  }
  assert.equal(harness.users.get(lastAdmin)?.role, "admin");
  assert.equal(harness.users.get(lastAdmin)?.status, "active");
});

test("with another active administrator, role changes and blocks apply and end sessions", async () => {
  const harness = createHarness();
  const actorId = harness.addUser({ email: "boss@shop.ru", role: "admin" });
  const otherAdmin = harness.addUser({ email: "other@shop.ru", role: "admin" });
  harness.addSession(otherAdmin, "staff_totp");
  harness.addSession(otherAdmin, "customer_otp");

  const demoted = await harness.management.updateStaff(actorId, otherAdmin, { role: "manager" });
  assert.equal(demoted?.role, "manager");
  assert.equal(harness.sessions.filter((item) => item.userId === otherAdmin).length, 0);

  harness.addSession(otherAdmin, "staff_totp");
  const blocked = await harness.management.updateStaff(actorId, otherAdmin, { status: "blocked" });
  assert.equal(blocked?.status, "blocked");
  assert.equal(harness.sessions.filter((item) => item.userId === otherAdmin).length, 0);

  const unblocked = await harness.management.updateStaff(actorId, otherAdmin, { status: "active" });
  assert.equal(unblocked?.status, "active");

  await harness.management.reissueKey(actorId, otherAdmin);
  assert.ok(harness.credentials.has(otherAdmin));
  harness.addSession(otherAdmin, "staff_totp");
  const revoked = await harness.management.updateStaff(actorId, otherAdmin, { role: "customer" });
  assert.equal(revoked, null);
  assert.equal(harness.users.get(otherAdmin)?.role, "customer");
  assert.equal(harness.credentials.has(otherAdmin), false, "the key is deleted with the role");
  assert.equal(harness.sessions.filter((item) => item.userId === otherAdmin).length, 0);

  const actions = harness.audit.map((event) => event.action);
  assert.deepEqual(actions, ["staff.updated", "staff.updated", "staff.updated", "staff.key_reissued", "staff.revoked"]);
  assert.ok(harness.audit.every((event) => event.actorUserId === actorId));

  await assertApplicationError(
    harness.management.updateStaff(actorId, otherAdmin, { role: "manager" }),
    404,
    "STAFF_NOT_FOUND",
  );
});

test("a new key replaces the old one, resets the lockout and ends sessions", async () => {
  const harness = createHarness();
  const { member, enrollment, actorId } = await createEnrolledStaff(harness);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assertLoginRefused(harness, "manager@shop.ru", wrongCode(harness, enrollment.secret));
  }
  harness.addSession(member.id, "staff_totp");
  const reissued = await harness.management.reissueKey(actorId, member.id);
  assert.notEqual(reissued.enrollment.secret, enrollment.secret);
  assert.equal(reissued.member.locked, false);
  assert.equal(harness.sessions.filter((item) => item.userId === member.id).length, 0);

  await assertLoginRefused(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  harness.advance(30_000);
  await harness.auth.login({ email: "manager@shop.ru", code: currentCode(harness, reissued.enrollment.secret) });
});

test("the server command creates, re-activates and re-keys the last administrator", async () => {
  const harness = createHarness();
  const first = await harness.management.provisionFromCommandLine({
    email: "owner@shop.ru",
    name: "Владелец",
    role: "admin",
  });
  assert.equal(first.created, true);
  assert.equal(first.member.role, "admin");
  assert.equal(harness.audit[0].actorUserId, null);
  assert.equal(harness.audit[0].action, "staff.provisioned_by_command");

  harness.users.get(first.member.id)!.status = "blocked";
  harness.addSession(first.member.id, "staff_totp");
  const again = await harness.management.provisionFromCommandLine({ email: "owner@shop.ru", role: "admin" });
  assert.equal(again.created, false);
  assert.equal(again.member.status, "active");
  assert.equal(again.member.name, "Владелец");
  assert.notEqual(again.enrollment.secret, first.enrollment.secret);
  assert.equal(harness.sessions.length, 0);

  await assertApplicationError(
    harness.management.provisionFromCommandLine({ email: "new@shop.ru", role: "manager" }),
    422,
    "STAFF_NAME_REQUIRED",
  );
  await assertApplicationError(
    harness.management.provisionFromCommandLine({ email: "owner@shop.ru", role: "manager" }),
    409,
    "LAST_ADMIN_REQUIRED",
  );
});

// --- Trusted devices (QA-28, OWASP "device cookies") ---

/** Browser cookie jar of the trusted-device cookie. */
function createBrowser() {
  let tokens: string[] = [];
  return {
    get tokens() {
      return tokens;
    },
    async login(harness: Harness, email: string, code: string) {
      const session = await harness.auth.login({ email, code, deviceTokens: tokens });
      tokens = nextStaffDeviceTokens(tokens, session.replacedDeviceToken, session.deviceToken);
      return session;
    },
  };
}

test("a stranger without the device cookie locks the account, the employee's browser still signs in", async () => {
  const harness = createHarness();
  const { member, enrollment } = await createEnrolledStaff(harness);
  const employee = createBrowser();
  const first = await employee.login(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  assert.equal(first.replacedDeviceToken, undefined, "a new device is trusted after the first sign-in");
  assert.equal(employee.tokens.length, 1);
  assert.equal(harness.devices.size, 1);
  assert.ok(
    ![...harness.devices.values()].some((device) => device.token_hash === employee.tokens[0]),
    "only the HMAC of the device token is stored",
  );
  assert.ok(await harness.auth.findTrustedDeviceId("manager@shop.ru", employee.tokens));
  assert.equal(await harness.auth.findTrustedDeviceId("other@shop.ru", employee.tokens), null);

  // The stranger has no device cookie: failures count on the account.
  harness.advance(30_000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assertLoginRefused(harness, "manager@shop.ru", wrongCode(harness, enrollment.secret));
  }
  assert.ok(harness.credentials.get(member.id)?.locked_until, "account locked for devices without a token");
  await assertLoginRefused(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));

  // The employee's browser is not affected.
  const previousToken = employee.tokens[0];
  const second = await employee.login(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  assert.equal(second.user.role, "manager");
  assert.equal(second.replacedDeviceToken, previousToken);
  assert.notEqual(employee.tokens[0], previousToken, "the device token is rotated");
  assert.equal(employee.tokens.length, 1);
  assert.equal(harness.devices.size, 1);
  const login = harness.audit.filter((event) => event.action === "staff.login").at(-1);
  assert.deepEqual(login?.details, { method: "totp", firstSignIn: false, trustedDevice: true });

  // The account lockout still guards devices without a token, and a copied
  // old device token no longer counts as trusted.
  assert.ok(harness.credentials.get(member.id)?.locked_until);
  harness.advance(30_000);
  await assertLoginRefused(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  await assert.rejects(
    harness.auth.login({
      email: "manager@shop.ru",
      code: currentCode(harness, enrollment.secret),
      deviceTokens: [previousToken],
    }),
    ApplicationError,
  );
  assert.ok(harness.logs.filter((log) => log.context.reason === "locked").length >= 3);
});

test("5 wrong codes from a trusted device lock only that device", async () => {
  const harness = createHarness();
  const { member, enrollment } = await createEnrolledStaff(harness);
  const laptop = createBrowser();
  await laptop.login(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  harness.advance(30_000);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      harness.auth.login({ email: "manager@shop.ru", code: wrongCode(harness, enrollment.secret), deviceTokens: laptop.tokens }),
      (error: unknown) => error instanceof ApplicationError && error.message === STAFF_LOGIN_FAILED_MESSAGE,
    );
  }
  const [device] = [...harness.devices.values()];
  assert.equal(device.failed_attempts, 5);
  assert.ok(device.locked_until && device.locked_until.getTime() > harness.now());
  assert.equal(harness.credentials.get(member.id)?.failed_attempts, 0, "the account counter is untouched");
  assert.equal(harness.credentials.get(member.id)?.locked_until, null);
  assert.ok(harness.audit.some((event) => event.action === "staff.device_locked"));
  assert.ok(!harness.audit.some((event) => event.action === "staff.login_locked"));

  // Even a correct code is refused on the locked device…
  await assert.rejects(
    harness.auth.login({ email: "manager@shop.ru", code: currentCode(harness, enrollment.secret), deviceTokens: laptop.tokens }),
    ApplicationError,
  );
  assert.ok(harness.logs.some((log) => log.context.reason === "device_locked" && log.context.trustedDevice === true));
  // …while another browser signs in normally and becomes trusted itself.
  const phone = createBrowser();
  await phone.login(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  assert.equal(harness.devices.size, 2);

  // After 15 minutes the laptop works again and its counter is reset.
  harness.advance(STAFF_LOGIN_LOCK_SECONDS * 1_000 + 30_000);
  await laptop.login(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  assert.ok([...harness.devices.values()].every((item) => item.failed_attempts === 0));
});

test("a new key, a block and a role change forget the trusted devices", async () => {
  const harness = createHarness();
  const { member, enrollment, actorId } = await createEnrolledStaff(harness);
  const browser = createBrowser();
  await browser.login(harness, "manager@shop.ru", currentCode(harness, enrollment.secret));
  assert.equal(harness.devices.size, 1);

  const reissued = await harness.management.reissueKey(actorId, member.id);
  assert.equal(harness.devices.size, 0, "new key → devices forgotten");
  // The old cookie is now an untrusted attempt: failures count on the account.
  harness.advance(30_000);
  await assert.rejects(
    harness.auth.login({ email: "manager@shop.ru", code: wrongCode(harness, reissued.enrollment.secret), deviceTokens: browser.tokens }),
    ApplicationError,
  );
  assert.equal(harness.credentials.get(member.id)?.failed_attempts, 1);

  await browser.login(harness, "manager@shop.ru", currentCode(harness, reissued.enrollment.secret));
  assert.equal(harness.devices.size, 1);
  await harness.management.updateStaff(actorId, member.id, { status: "blocked" });
  assert.equal(harness.devices.size, 0, "block → devices forgotten");

  await harness.management.updateStaff(actorId, member.id, { status: "active" });
  harness.advance(30_000);
  await browser.login(harness, "manager@shop.ru", currentCode(harness, reissued.enrollment.secret));
  assert.equal(harness.devices.size, 1);
  await harness.management.updateStaff(actorId, member.id, { role: "admin" });
  assert.equal(harness.devices.size, 0, "role change → devices forgotten");
  const update = harness.audit.filter((event) => event.action === "staff.updated").at(-1);
  assert.equal((update?.details as { devicesForgotten?: number }).devicesForgotten, 1);

  harness.advance(30_000);
  await browser.login(harness, "manager@shop.ru", currentCode(harness, reissued.enrollment.secret));
  await harness.management.updateStaff(actorId, member.id, { role: "customer" });
  assert.equal(harness.devices.size, 0, "revoke → devices forgotten");
});

test("one browser keeps trusted devices of several employees", async () => {
  const harness = createHarness();
  const manager = await createEnrolledStaff(harness, "manager@shop.ru");
  const cashier = await harness.management.createStaff(manager.actorId, {
    email: "cashier@shop.ru",
    name: "Кассир",
    role: "manager",
  });
  const sharedBrowser = createBrowser();
  await sharedBrowser.login(harness, "manager@shop.ru", currentCode(harness, manager.enrollment.secret));
  await sharedBrowser.login(harness, "cashier@shop.ru", currentCode(harness, cashier.enrollment.secret));
  assert.equal(sharedBrowser.tokens.length, 2);
  assert.ok(await harness.auth.findTrustedDeviceId("manager@shop.ru", sharedBrowser.tokens));
  assert.ok(await harness.auth.findTrustedDeviceId("cashier@shop.ru", sharedBrowser.tokens));
  harness.advance(30_000);
  const again = await sharedBrowser.login(harness, "manager@shop.ru", currentCode(harness, manager.enrollment.secret));
  assert.ok(again.replacedDeviceToken, "the manager's own token is replaced, the cashier's stays");
  assert.equal(sharedBrowser.tokens.length, 2);
  assert.ok(await harness.auth.findTrustedDeviceId("cashier@shop.ru", sharedBrowser.tokens));
});

test("device cookie: format, rotation and options", () => {
  const token = (character: string) => character.repeat(64);
  assert.deepEqual(parseStaffDeviceCookie(undefined), []);
  assert.deepEqual(parseStaffDeviceCookie(`${token("a")}.bad.${token("A")}.${token("b")}.${token("a")}`), [
    token("a"),
    token("b"),
  ]);
  assert.deepEqual(parseStaffDeviceCookie("x".repeat(2_000)), []);
  const many = ["1", "2", "3", "4", "5", "6", "7"].map(token);
  assert.deepEqual(parseStaffDeviceCookie(many.join(".")), many.slice(-MAXIMUM_DEVICE_TOKENS_PER_COOKIE));

  assert.deepEqual(nextStaffDeviceTokens([token("a"), token("b")], token("a"), token("c")), [token("b"), token("c")]);
  assert.deepEqual(nextStaffDeviceTokens([token("a")], undefined, token("c")), [token("a"), token("c")]);
  assert.equal(nextStaffDeviceTokens(many.slice(0, 5), undefined, token("c")).length, MAXIMUM_DEVICE_TOKENS_PER_COOKIE);
  assert.equal(serializeStaffDeviceCookie([token("a"), token("b")]), `${token("a")}.${token("b")}`);

  const options = staffDeviceCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "strict");
  assert.equal(options.path, STAFF_DEVICE_COOKIE_PATH);
  assert.equal(options.path, "/api/auth/staff/login");
  assert.equal(options.maxAge, STAFF_DEVICE_LIFETIME_SECONDS);
  assert.equal(STAFF_DEVICE_LIFETIME_SECONDS, 90 * 24 * 60 * 60);
  assert.equal(options.secure, process.env.NODE_ENV === "production");
});

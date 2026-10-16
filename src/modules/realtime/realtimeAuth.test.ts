import test from "node:test";
import assert from "node:assert/strict";
import JWT from "jsonwebtoken";
import {
  authenticateHandshake,
  readHandshakeToken,
  RealtimeAuthError,
  scheduleExpiryDisconnect,
  type LoadRealtimeUser,
} from "./realtimeAuth";

const SECRET = "test-secret";

const activeMember: LoadRealtimeUser = async (id) => ({
  id,
  is_active: true,
  is_guest: false,
  branch_id: 2,
});

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    assert.ok(error instanceof RealtimeAuthError);
    return (error as RealtimeAuthError).data.code;
  }
};

test("readHandshakeToken: strips Bearer, rejects non-strings and blanks", () => {
  assert.equal(readHandshakeToken({ token: "Bearer abc" }), "abc");
  assert.equal(readHandshakeToken({ token: "  abc  " }), "abc");
  assert.equal(readHandshakeToken({ token: "" }), null);
  assert.equal(readHandshakeToken({ token: 5 }), null);
  assert.equal(readHandshakeToken(undefined), null);
});

test("missing token", async () => {
  assert.equal(await codeOf(authenticateHandshake(null, { secret: SECRET, loadUser: activeMember })), "TOKEN_MISSING");
});

test("bad signature", async () => {
  const token = JWT.sign({ id: 1 }, "other-secret");
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: activeMember })), "TOKEN_INVALID");
});

test("expired token", async () => {
  const token = JWT.sign({ id: 1, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: activeMember })), "TOKEN_EXPIRED");
});

test("purpose-scoped tokens (e.g. the SSE stream token) are refused", async () => {
  const token = JWT.sign({ id: 1, purpose: "notifications_stream" }, SECRET);
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: activeMember })), "TOKEN_INVALID");
});

test("token without a usable id", async () => {
  const token = JWT.sign({ id: "abc" }, SECRET);
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: activeMember })), "TOKEN_INVALID");
});

test("inactive or missing user", async () => {
  const token = JWT.sign({ id: 1 }, SECRET);
  const inactive: LoadRealtimeUser = async (id) => ({ id, is_active: false, is_guest: false, branch_id: null });
  const missing: LoadRealtimeUser = async () => null;
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: inactive })), "ACCOUNT_INACTIVE");
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: missing })), "ACCOUNT_INACTIVE");
});

test("active member: user and expiry returned; null is_active counts as active", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = JWT.sign({ id: 9, exp }, SECRET);
  const nullActive: LoadRealtimeUser = async (id) => ({ id, is_active: null, is_guest: null, branch_id: null });
  const result = await authenticateHandshake(token, { secret: SECRET, loadUser: nullActive });
  assert.deepEqual(result.user, { userId: 9, isGuest: false, branchId: null });
  assert.equal(result.expiresAtMs, exp * 1000);
});

test("guest accepted and flagged", async () => {
  const token = JWT.sign({ id: 4 }, SECRET);
  const guest: LoadRealtimeUser = async (id) => ({ id, is_active: true, is_guest: true, branch_id: 1 });
  const result = await authenticateHandshake(token, { secret: SECRET, loadUser: guest });
  assert.equal(result.user.isGuest, true);
  assert.equal(result.expiresAtMs, null);
});

test("scheduleExpiryDisconnect: fires at expiry, cleared on disconnect", () => {
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const clock = {
    now: () => 1_000,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t: any) => {
      t.cleared = true;
    },
  };
  let disconnected = false;
  let onDisconnect: () => void = () => undefined;
  const socket = {
    disconnect: () => {
      disconnected = true;
    },
    once: (_event: "disconnect", fn: () => void) => {
      onDisconnect = fn;
    },
  };

  scheduleExpiryDisconnect(socket, 6_000, clock);
  assert.equal(timers[0].ms, 5_000);
  timers[0].fn();
  assert.equal(disconnected, true);

  scheduleExpiryDisconnect(socket, 9_000, clock);
  onDisconnect();
  assert.equal(timers[1].cleared, true);
});

test("scheduleExpiryDisconnect: no expiry, no timer", () => {
  let created = 0;
  scheduleExpiryDisconnect(
    { disconnect: () => undefined, once: () => undefined },
    null,
    { now: () => 0, setTimer: () => (created += 1), clearTimer: () => undefined },
  );
  assert.equal(created, 0);
});

test("tokens signed with another algorithm are refused", async () => {
  const token = JWT.sign({ id: 1 }, SECRET, { algorithm: "HS512" });
  assert.equal(await codeOf(authenticateHandshake(token, { secret: SECRET, loadUser: activeMember })), "TOKEN_INVALID");
});

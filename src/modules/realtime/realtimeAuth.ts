import JWT from "jsonwebtoken";

/**
 * Socket handshake auth. The session JWT travels in `socket.handshake.auth.token`
 * — the first packet, never the URL, so it stays out of proxy logs.
 *
 * Rejections carry `err.data.code`; clients act on the code:
 * TOKEN_MISSING / TOKEN_INVALID / TOKEN_EXPIRED stop retrying, ACCOUNT_INACTIVE
 * logs out (it is how an offline device learns of a revocation it missed).
 */

export type RealtimeAuthErrorCode =
  | "TOKEN_MISSING"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "ACCOUNT_INACTIVE";

export class RealtimeAuthError extends Error {
  data: { code: RealtimeAuthErrorCode };

  constructor(code: RealtimeAuthErrorCode) {
    super(code);
    this.name = "RealtimeAuthError";
    this.data = { code };
  }
}

export type RealtimeUser = {
  userId: number;
  isGuest: boolean;
  branchId: number | null;
};

export type LoadRealtimeUser = (userId: number) => Promise<{
  id: number;
  is_active: boolean | null;
  is_guest: boolean | null;
  branch_id: number | null;
} | null>;

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const readHandshakeToken = (auth: unknown): string | null => {
  const raw = (auth as { token?: unknown } | undefined)?.token;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const token = trimmed.toLowerCase().startsWith("bearer ") ? trimmed.slice(7).trim() : trimmed;
  return token || null;
};

export const authenticateHandshake = async (
  token: string | null,
  deps: { secret: string; loadUser: LoadRealtimeUser },
): Promise<{ user: RealtimeUser; expiresAtMs: number | null }> => {
  if (!token) throw new RealtimeAuthError("TOKEN_MISSING");

  let payload: JWT.JwtPayload;
  try {
    const decoded = JWT.verify(token, deps.secret);
    if (!decoded || typeof decoded === "string") throw new RealtimeAuthError("TOKEN_INVALID");
    payload = decoded;
  } catch (error) {
    if (error instanceof RealtimeAuthError) throw error;
    if ((error as Error)?.name === "TokenExpiredError") throw new RealtimeAuthError("TOKEN_EXPIRED");
    throw new RealtimeAuthError("TOKEN_INVALID");
  }

  // Purpose-scoped tokens (the SSE stream token, …) are not session tokens.
  if (payload.purpose !== undefined) throw new RealtimeAuthError("TOKEN_INVALID");

  const userId = toPositiveInt(payload.id);
  if (!userId) throw new RealtimeAuthError("TOKEN_INVALID");

  const row = await deps.loadUser(userId);
  if (!row || row.is_active === false) throw new RealtimeAuthError("ACCOUNT_INACTIVE");

  return {
    user: { userId, isGuest: row.is_guest === true, branchId: row.branch_id ?? null },
    expiresAtMs: typeof payload.exp === "number" ? payload.exp * 1000 : null,
  };
};

type Clock = {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (timer: any) => void;
};

const MAX_TIMER_MS = 2 ** 31 - 1;

const systemClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return timer;
  },
  clearTimer: (timer) => clearTimeout(timer),
};

/** Drops the socket when its token expires, so an expired session cannot linger. */
export const scheduleExpiryDisconnect = (
  socket: { disconnect(close: boolean): unknown; once(event: "disconnect", fn: () => void): unknown },
  expiresAtMs: number | null,
  clock: Clock = systemClock,
) => {
  if (expiresAtMs === null) return;
  const delay = Math.min(MAX_TIMER_MS, Math.max(0, expiresAtMs - clock.now()));
  const timer = clock.setTimer(() => socket.disconnect(true), delay);
  socket.once("disconnect", () => clock.clearTimer(timer));
};

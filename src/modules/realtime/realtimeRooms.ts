import type { RealtimeUser } from "./realtimeAuth";
import { userRoom } from "./realtimeEmit";

/**
 * Audience rooms. `user:` carries personal events, `branch:` / `dept:` carry
 * feed-level events, `all` carries broadcasts (live stream). Guests only get
 * `user:` and `all`. Topic rooms (`post:`, `offer:`, …) are managed by
 * realtimeTopics.ts and never touched here.
 */

export const ALL_ROOM = "all";

export const branchRoom = (branchId: number) => `branch:${branchId}`;
export const departmentRoom = (departmentId: number) => `dept:${departmentId}`;

export const MAX_SOCKETS_PER_USER = 10;

const MANAGED_PREFIXES = ["user:", "branch:", "dept:"];

const isManagedRoom = (room: string) =>
  room === ALL_ROOM || MANAGED_PREFIXES.some((prefix) => room.startsWith(prefix));

export const roomsFor = (user: RealtimeUser, departmentIds: number[]): string[] => {
  if (user.isGuest) return [userRoom(user.userId), ALL_ROOM];
  return [
    userRoom(user.userId),
    ...(user.branchId ? [branchRoom(user.branchId)] : []),
    ...Array.from(new Set(departmentIds)).map(departmentRoom),
    ALL_ROOM,
  ];
};

export type RoomSocket = {
  id: string;
  rooms: Set<string>;
  join(room: string): unknown;
  leave(room: string): unknown;
};

/** Brings a socket's managed rooms in line with `desired`; topic rooms are left alone. */
export const syncRooms = (socket: RoomSocket, desired: string[]) => {
  const wanted = new Set(desired);
  for (const room of Array.from(socket.rooms)) {
    if (room === socket.id) continue;
    if (isManagedRoom(room) && !wanted.has(room)) socket.leave(room);
  }
  for (const room of Array.from(wanted)) {
    if (!socket.rooms.has(room)) socket.join(room);
  }
};

/** Ids of the oldest sockets beyond `cap`, oldest first. */
export const socketsToDrop = (sockets: { id: string; issued: number }[], cap: number): string[] => {
  if (sockets.length <= cap) return [];
  return [...sockets]
    .sort((a, b) => a.issued - b.issued)
    .slice(0, sockets.length - cap)
    .map((socket) => socket.id);
};

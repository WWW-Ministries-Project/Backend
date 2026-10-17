import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ROOM, roomsFor, socketsToDrop, syncRooms } from "./realtimeRooms";

test("member rooms: user, branch, each department, all", () => {
  assert.deepEqual(roomsFor({ userId: 3, isGuest: false, branchId: 2 }, [7, 8]), [
    "user:3",
    "branch:2",
    "dept:7",
    "dept:8",
    ALL_ROOM,
  ]);
});

test("member without a branch", () => {
  assert.deepEqual(roomsFor({ userId: 3, isGuest: false, branchId: null }, []), ["user:3", ALL_ROOM]);
});

test("guest: user and all only, departments ignored", () => {
  assert.deepEqual(roomsFor({ userId: 4, isGuest: true, branchId: 2 }, [7]), ["user:4", ALL_ROOM]);
});

test("duplicate department ids collapse", () => {
  assert.deepEqual(roomsFor({ userId: 1, isGuest: false, branchId: null }, [7, 7]), ["user:1", "dept:7", ALL_ROOM]);
});

test("syncRooms leaves stale managed rooms, joins new ones, keeps topics and the socket's own room", () => {
  const rooms = new Set(["sock-1", "user:3", "dept:7", "branch:1", "post:5", ALL_ROOM]);
  const joined: string[] = [];
  const left: string[] = [];
  const socket = {
    id: "sock-1",
    rooms,
    join: (room: string) => {
      joined.push(room);
    },
    leave: (room: string) => {
      left.push(room);
    },
  };
  syncRooms(socket, ["user:3", "branch:2", "dept:8", ALL_ROOM]);
  assert.deepEqual(left.sort(), ["branch:1", "dept:7"]);
  assert.deepEqual(joined.sort(), ["branch:2", "dept:8"]);
});

test("socketsToDrop keeps the newest `cap`", () => {
  const sockets = [
    { id: "a", issued: 1 },
    { id: "b", issued: 3 },
    { id: "c", issued: 2 },
  ];
  assert.deepEqual(socketsToDrop(sockets, 2), ["a"]);
  assert.deepEqual(socketsToDrop(sockets, 3), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  disconnectUser,
  setRealtimeServer,
  toRoom,
  toTopic,
  toUser,
  userRoom,
  type RealtimeIo,
} from "./realtimeEmit";

type Sent = { target: string | string[]; event: string; body: any };

const fakeIo = () => {
  const sent: Sent[] = [];
  const disconnected: string[] = [];
  const io: RealtimeIo = {
    to: (target) => ({
      emit: (event, body) => {
        sent.push({ target, event, body });
        return true;
      },
    }),
    in: (room) => ({
      disconnectSockets: () => {
        disconnected.push(room);
      },
    }),
  };
  return { io, sent, disconnected };
};

test("userRoom", () => {
  assert.equal(userRoom(7), "user:7");
});

test("no io attached: every helper is a silent no-op", () => {
  setRealtimeServer(null);
  assert.doesNotThrow(() => toUser(1, "unread_count", { unreadCount: 1 }));
  assert.doesNotThrow(() => toRoom("all", "unread_count", { unreadCount: 1 }));
  assert.doesNotThrow(() => toTopic("post:1", "unread_count", { unreadCount: 1 }));
  assert.doesNotThrow(() => disconnectUser(1));
});

test("toUser targets user rooms, drops invalid ids, wraps the body", () => {
  const { io, sent } = fakeIo();
  setRealtimeServer(io);
  toUser([3, 0, -1, 3.5, 4], "session.changed", { reasons: ["profile"] });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].target, ["user:3", "user:4"]);
  assert.equal(sent[0].event, "session.changed");
  assert.deepEqual(sent[0].body.reasons, ["profile"]);
  assert.equal(sent[0].body.v, 1);
  assert.equal(typeof sent[0].body.at, "string");
  setRealtimeServer(null);
});

test("toUser with no valid ids emits nothing", () => {
  const { io, sent } = fakeIo();
  setRealtimeServer(io);
  toUser([], "unread_count", { unreadCount: 0 });
  toUser(0, "unread_count", { unreadCount: 0 });
  assert.equal(sent.length, 0);
  setRealtimeServer(null);
});

test("toRoom and toTopic pass the room through", () => {
  const { io, sent } = fakeIo();
  setRealtimeServer(io);
  toRoom("all", "unread_count", { unreadCount: 1 });
  toTopic("post:9", "unread_count", { unreadCount: 1 });
  assert.deepEqual(sent.map((s) => s.target), ["all", "post:9"]);
  setRealtimeServer(null);
});

test("a throwing io never escapes", () => {
  setRealtimeServer({
    to: () => {
      throw new Error("boom");
    },
    in: () => {
      throw new Error("boom");
    },
  });
  assert.doesNotThrow(() => toUser(1, "unread_count", { unreadCount: 1 }));
  assert.doesNotThrow(() => disconnectUser(1));
  setRealtimeServer(null);
});

test("disconnectUser targets the user room", () => {
  const { io, disconnected } = fakeIo();
  setRealtimeServer(io);
  disconnectUser(5);
  assert.deepEqual(disconnected, ["user:5"]);
  setRealtimeServer(null);
});

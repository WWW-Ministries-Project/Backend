/**
 * Read-only realtime smoke test. Connects, prints every event, optionally
 * subscribes to one topic. Never writes anything.
 *
 *   REALTIME_URL=https://api.example.org REALTIME_TOKEN=<jwt> \
 *     npx ts-node --transpile-only scripts/realtime-smoke.ts [topic]
 */
import { io } from "socket.io-client";

const url = process.env.REALTIME_URL;
const token = process.env.REALTIME_TOKEN;
const topic = process.argv[2];

if (!url || !token) {
  console.error("Set REALTIME_URL and REALTIME_TOKEN.");
  process.exit(1);
}

const socket = io(url, { path: "/socket.io", transports: ["websocket"], auth: { token } });

socket.on("connect", () => {
  console.log(`connected id=${socket.id} transport=${socket.io.engine.transport.name} recovered=${socket.recovered}`);
  if (topic) socket.emit("subscribe", { topic }, (ack: unknown) => console.log("subscribe ack", ack));
});
socket.on("connect_error", (error: any) => console.log("connect_error", error.message, error.data));
socket.on("disconnect", (reason) => console.log("disconnect", reason));
socket.onAny((event, body) => console.log(new Date().toISOString(), event, JSON.stringify(body)));

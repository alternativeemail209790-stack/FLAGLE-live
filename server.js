// ===================================================================
// PLATFORM ENTRY POINT
// One always-on server hosting multiple independent games. Each game
// keeps its own files (public/<game>/) and its own Socket.IO namespace
// (/<game>), so they never share state or event names — this file just
// wires up Express + Socket.IO once and lets each game register itself.
// ===================================================================

import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

import { registerFlagle } from "./server/flagle.js";
import { registerTravle } from "./server/travle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Safety net shared by every game on this server: one bad event handler
// or library-internal bug should never take down the whole process (which
// would disconnect every host currently live across every game).
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (kept server alive):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (kept server alive):", err);
});

// Serves /public/index.html at "/", and transparently serves
// /public/flagle/* at /flagle/* and /public/travle/* at /travle/* —
// one static middleware covers the whole platform.
app.use(express.static(path.join(__dirname, "public")));

registerFlagle(io);
registerTravle(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game platform running on port ${PORT}`);
});

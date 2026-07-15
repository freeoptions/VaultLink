import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";

const [, , identifier, optionsFile] = process.argv;

if (!identifier || !optionsFile) {
  console.error("Missing identifier or options file path.");
  process.exit(1);
}

const options = JSON.parse(fs.readFileSync(optionsFile, "utf8"));
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

wss.on("listening", () => {
  const address = wss.address();
  if (!address || typeof address === "string") {
    console.error("Failed to get local address.");
    process.exit(1);
  }

  const addrPath = path.join(os.tmpdir(), `${identifier}-server-addr`);
  fs.writeFileSync(addrPath, `127.0.0.1:${address.port}`, "utf8");
});

wss.on("connection", (socket) => {
  socket.once("message", (payload) => {
    const request = JSON.parse(payload.toString("utf8"));
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        result: options,
        id: request.id ?? null,
      }),
    );
    setTimeout(() => {
      socket.close();
      wss.close(() => process.exit(0));
    }, 150);
  });
});

wss.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

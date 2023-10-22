import { createServer } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { promisify } from "node:util";
import childProcess from "node:child_process";

const exec = promisify(childProcess.exec);
const socketPath = "/etc/revpanel/bridge.sock";

if (existsSync(socketPath)) {
  unlinkSync(socketPath);
}

const server = createServer((connection) => {
  console.log("Client connected");

  connection.on("data", (data) => {
    const command = data.toString();
    exec(command).then((result) => {
      connection.write("[stdout]" + result.stdout);
      connection.write("[stderr]" + result.stderr);
    });
  });

  connection.on("end", () => {
    console.log("Client disconnected");
  });
});

server.listen(socketPath, () => {
  console.log("Server is listening on", socketPath);
});

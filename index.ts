import { Socket, createServer } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { promisify } from "node:util";
import childProcess, {
  ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID } from "node:crypto";

const exec = promisify(childProcess.exec);
const socketPath = "/etc/revpanel/bridge.sock";

if (existsSync(socketPath)) {
  unlinkSync(socketPath);
}

const map: Map<string, ChildProcessWithoutNullStreams> = new Map();

const server = createServer(
  {
    allowHalfOpen: true,
  },
  (connection) => {
    console.log("Client connected");

    setInterval(() => {
      exec("ps -eo pid,%cpu,%mem,command,args --sort=-%cpu").then((out) => {
        const parse = getProcesses(out.stdout);
        connection.write(
          "[command][ps]" + JSON.stringify(parse) + "[/command]"
        );
      });
    }, 60000);

    connection.on("data", (data) => {
      // the commands are in the form of [command]${command}[/command], one buffer can contain multiple commands
      const commands = data.toString().split("[/command]");
      for (const command of commands) {
        if (!command.startsWith("[command]")) {
          continue;
        }

        const cmd = command.substring(9);
        handleCommand(cmd, connection);
      }
    });

    connection.on("end", () => {
      console.log("Client disconnected");
    });
  }
);

server.listen(socketPath, () => {
  console.log("Server is listening on", socketPath);
});

function handleCommand(command: string, connection: Socket) {
  console.log("Command received", command);
  if (command.startsWith("[spawn]")) {
    const uuid = randomUUID();
    const terminal = childProcess.spawn("/bin/sh");
    connection.write(`[command][spawn:${uuid}][/command]`);
    map.set(uuid, terminal);
    terminal.stdout.on("data", (data) => {
      connection.write(`[command][stdout:${uuid}]` + data + "[/command]");
    });
    terminal.stderr.on("data", (data) => {
      connection.write(`[command][stderr:${uuid}]` + data + "[/command]");
    });
  } else if (command.startsWith("[exec:")) {
    // Syntax [exec:${uuid}]${command}
    const uuid = command.split("]")[0].split(":")[1];
    const commandToExec = command.split("]")[1];
    const terminal = map.get(uuid);
    if (terminal) {
      terminal.stdin.write(commandToExec + "\n");
    }
  } else if (command.startsWith("[kill:")) {
    // Syntax [kill:${uuid}]
    const uuid = command.split("]")[0].split(":")[1];
    const terminal = map.get(uuid);
    if (terminal) {
      terminal.kill();
      map.delete(uuid);
    }
  } else {
    console.log("Unknown command", command);
  }
}

type ProcessInfo = {
  pid: number;
  cpu: number;
  memory: number;
  command: string;
};

function getProcesses(out: string): ProcessInfo[] {
  const lines = out.trim().split("\n").slice(1);

  const processes: ProcessInfo[] = lines.map((line) => {
    const [pid, cpu, memory, command, ...args] = line.trim().split(/\s+/);

    let totalArgs = args.join(" ");
    if (totalArgs === command) {
      totalArgs = "";
    }

    return {
      pid: parseInt(pid),
      cpu: parseFloat(cpu),
      memory: parseFloat(memory),
      command: command + (totalArgs.length > 0 ? " " + totalArgs : ""),
    };
  });

  return processes;
}

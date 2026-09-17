import { spawn } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, role] = process.argv.slice(2);
const spawnRole = (role, detached) => {
  const child = spawn(process.execPath, [process.argv[1], dir, role], {
    detached,
    stdio: "ignore",
    // Model applications that deliberately strip extension-owned environment.
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  child.unref();
};
if (role === "root") {
  spawnRole("same-group", false);
  spawnRole("detached", true);
  process.on("SIGTERM", () => {
    appendFileSync(join(dir, "root-terms"), "term\n");
    if (existsSync(join(dir, "spawn-on-stop"))) spawnRole("late", true);
    setTimeout(() => process.exit(0), 800);
  });
}
if (role === "detached") {
  spawnRole("nested", false);
  process.on("SIGTERM", () => {});
}
writeFileSync(join(dir, `${role}.json`), JSON.stringify({ pid: process.pid }));
setInterval(() => {
  if (existsSync(join(dir, "stop")) || (role === "root" && existsSync(join(dir, "exit-root")))) process.exit(0);
}, 10);
setTimeout(() => process.exit(0), 15000);

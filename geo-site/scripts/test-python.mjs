import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const virtualEnvPython = process.platform === "win32"
  ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
  : path.join(projectRoot, ".venv", "bin", "python");
const python = fs.existsSync(virtualEnvPython)
  ? virtualEnvPython
  : process.platform === "win32" ? "python.exe" : "python3";

const result = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", "tests_py", "-v"],
  { cwd: projectRoot, stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

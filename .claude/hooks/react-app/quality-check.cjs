#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

function ensureTool(tool) {
  const result = spawnSync(tool, ["--version"], {
    stdio: "ignore",
    shell: false
  });
  return result.status === 0;
}

function run(command) {
  const cwd = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const execution = spawnSync(command.bin, command.args, {
    cwd,
    stdio: "inherit",
    shell: false
  });
  if (execution.status !== 0) {
    throw new Error(`Command failed: ${command.bin} ${command.args.join(" ")}`);
  }
}

const candidates = [
  { bin: "pnpm", args: ["lint"] },
  { bin: "npm", args: ["run", "lint"] },
  { bin: "yarn", args: ["lint"] }
];

const available = candidates.find((candidate) => ensureTool(candidate.bin));

if (!available) {
  console.error("No supported package manager found (pnpm, npm, yarn).");
  process.exit(1);
}

try {
  run(available);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

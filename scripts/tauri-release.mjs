#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const inputVersion = process.argv[2];
if (!inputVersion) {
  console.error('Usage: pnpm tauri:release <version>');
  process.exit(1);
}

const tag = inputVersion.startsWith('v') ? inputVersion : `v${inputVersion}`;
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('Version must be in the form v0.0.0 or 0.0.0');
  process.exit(1);
}

const run = (command, args, { capture = false } = {}) => {
  const result = spawnSync(command, args, {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: capture ? 'utf8' : undefined
  });
  if (result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
  return result;
};

try {
  const status = run('git', ['status', '--porcelain'], { capture: true }).stdout.trim();
  if (status) {
    console.error('Working tree must be clean before releasing.');
    process.exit(1);
  }

  const tagExists = spawnSync('git', ['rev-parse', '--verify', tag], { stdio: 'ignore' });
  if (tagExists.status === 0) {
    console.error(`Tag ${tag} already exists.`);
    process.exit(1);
  }

  run('pnpm', ['tauri', 'build']);

  const bundleDir = join('src-tauri', 'target', 'release', 'bundle', 'nsis');
  let artifact = null;
  if (existsSync(bundleDir)) {
    const candidates = readdirSync(bundleDir).filter((file) => file.endsWith('.exe'));
    if (candidates.length > 0) {
      artifact = join(bundleDir, candidates[0]);
    }
  }

  if (!artifact || !existsSync(artifact)) {
    console.error('Windows installer not found after build.');
    process.exit(1);
  }

  run('git', ['tag', tag]);

  try {
    run('git', ['push', 'origin', tag]);
  } catch (error) {
    run('git', ['tag', '-d', tag]);
    throw error;
  }

  run('gh', ['release', 'create', tag, artifact, '--generate-notes', '--title', tag]);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
}

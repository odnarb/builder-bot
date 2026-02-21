#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const sourceCoreDir = path.resolve(repoRoot, 'apps/core');

const coreTargets = [
  path.resolve(repoRoot, 'apps/api/core'),
  path.resolve(repoRoot, 'apps/functions/stripe-api/core'),
];

const includeSharedUtils = process.argv.includes('--include-shared-utils');
const includePromptParser = process.argv.includes('--include-prompt-parser');

/**
 * Remove destination dir and copy source tree.
 * @param {{ source: string, destination: string }} params
 */
async function restageDirectory({ source, destination }) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
}

/**
 * Ensure a directory exists.
 * @param {string} dir
 */
async function assertDirectory(dir) {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Missing directory: ${dir}`);
  }
}

async function main() {
  await assertDirectory(sourceCoreDir);

  for (const target of coreTargets) {
    await restageDirectory({ source: sourceCoreDir, destination: target });
    // eslint-disable-next-line no-console
    console.log(`[stage-shared-core] staged apps/core -> ${path.relative(repoRoot, target)}`);
  }

  if (includeSharedUtils) {
    const sharedUtilsSource = path.resolve(repoRoot, 'apps/shared-utils');
    const sharedUtilsTarget = path.resolve(repoRoot, 'apps/api/shared-utils');
    await assertDirectory(sharedUtilsSource);
    await restageDirectory({ source: sharedUtilsSource, destination: sharedUtilsTarget });
    // eslint-disable-next-line no-console
    console.log('[stage-shared-core] staged apps/shared-utils -> apps/api/shared-utils');
  }

  if (includePromptParser) {
    const parserSource = path.resolve(repoRoot, 'packages/prompt-parser');
    const parserTarget = path.resolve(repoRoot, 'apps/api/packages/prompt-parser');
    await assertDirectory(parserSource);
    await restageDirectory({ source: parserSource, destination: parserTarget });
    // eslint-disable-next-line no-console
    console.log('[stage-shared-core] staged packages/prompt-parser -> apps/api/packages/prompt-parser');
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[stage-shared-core] failed: ${error.stack || error}`);
  process.exit(1);
});

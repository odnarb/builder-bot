#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const CHECK_DIRS = [
  'apps/api',
  'apps/functions/stripe-api',
  'apps/core',
];

const IGNORED_SUBPATHS = [
  'apps/api/core/',
  'apps/functions/stripe-api/core/',
];

const FIRESTORE_IMPORT_RE = /from\s+['"]@google-cloud\/firestore['"]/;
const DYNAMIC_FIRESTORE_IMPORT_RE = /import\(['"]@google-cloud\/firestore['"]\)/;
const RELATIVE_IMPORT_RE = /from\s+['"](\.\.\/[^'"]+)['"]/g;

const ALLOWED_FIRESTORE_FILES = new Set([
  'apps/core/firestore/users.js',
  'apps/core/db/firestore/economics-persistence.js',
]);

const boundaryErrors = [];
const boundaryWarnings = [];

/**
 * List all JS source files under a directory.
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listJsFiles(directory) {
  const absolute = path.resolve(repoRoot, directory);
  const output = [];

  /**
   * @param {string} current
   */
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = toRelative(fullPath);
      if (IGNORED_SUBPATHS.some((prefix) => relativePath.startsWith(prefix))) {
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) {
        continue;
      }

      output.push(fullPath);
    }
  }

  await walk(absolute);
  return output;
}

/**
 * Convert absolute file path to repo-relative path.
 * @param {string} absolutePath
 * @returns {string}
 */
function toRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
}

/**
 * Validate Firestore imports are limited to allowed adapter files.
 * @param {string} relativePath
 * @param {string} content
 */
function checkFirestoreImportBoundary(relativePath, content) {
  const hasDirectFirestore = FIRESTORE_IMPORT_RE.test(content) || DYNAMIC_FIRESTORE_IMPORT_RE.test(content);
  if (!hasDirectFirestore) {
    return;
  }

  if (!ALLOWED_FIRESTORE_FILES.has(relativePath)) {
    boundaryErrors.push(
      `${relativePath}: direct Firestore import outside approved DB adapter files`,
    );
  }
}

/**
 * Validate function app imports do not escape app root.
 * @param {string} relativePath
 * @param {string} content
 */
function checkFunctionImportBoundary(relativePath, content) {
  if (!relativePath.startsWith('apps/functions/stripe-api/')) {
    return;
  }

  let match;
  while ((match = RELATIVE_IMPORT_RE.exec(content)) !== null) {
    if (match[1].startsWith('../')) {
      boundaryErrors.push(
        `${relativePath}: import escapes function app root (${match[1]})`,
      );
    }
  }
}

/**
 * Warn when API imports escape app root (until staging import cutover is complete).
 * @param {string} relativePath
 * @param {string} content
 */
function warnApiEscapeImports(relativePath, content) {
  if (!relativePath.startsWith('apps/api/')) {
    return;
  }

  let match;
  while ((match = RELATIVE_IMPORT_RE.exec(content)) !== null) {
    const specifier = match[1];
    if (specifier.startsWith('../core/') || specifier.startsWith('../shared-utils/') || specifier.startsWith('../../packages/')) {
      boundaryWarnings.push(
        `${relativePath}: app-root escaping import currently allowed during migration (${specifier})`,
      );
    }
  }
}

async function main() {
  for (const dir of CHECK_DIRS) {
    const files = await listJsFiles(dir);
    for (const file of files) {
      const relativePath = toRelative(file);
      const content = await fs.readFile(file, 'utf8');

      checkFirestoreImportBoundary(relativePath, content);
      checkFunctionImportBoundary(relativePath, content);
      warnApiEscapeImports(relativePath, content);
    }
  }

  if (boundaryWarnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[check-architecture-boundaries] warnings:');
    for (const warning of boundaryWarnings) {
      // eslint-disable-next-line no-console
      console.warn(`- ${warning}`);
    }
  }

  if (boundaryErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('[check-architecture-boundaries] errors:');
    for (const error of boundaryErrors) {
      // eslint-disable-next-line no-console
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('[check-architecture-boundaries] OK');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[check-architecture-boundaries] failed: ${error.stack || error}`);
  process.exit(1);
});

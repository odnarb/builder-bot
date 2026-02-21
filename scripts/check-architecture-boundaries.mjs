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
  'apps/api/shared-utils/',
  'apps/api/packages/prompt-parser/',
  'apps/functions/stripe-api/core/',
];

const FIRESTORE_IMPORT_RE = /from\s+['"]@google-cloud\/firestore['"]/;
const DYNAMIC_FIRESTORE_IMPORT_RE = /import\(['"]@google-cloud\/firestore['"]\)/;
const STATIC_RELATIVE_IMPORT_RE = /from\s+['"](\.{1,2}\/[^'"]+)['"]/g;
const DYNAMIC_RELATIVE_IMPORT_RE = /import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

const ALLOWED_FIRESTORE_FILES = new Set([
  'apps/core/firestore/users.js',
  'apps/core/db/firestore/economics-persistence.js',
]);

const boundaryErrors = [];
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
 * Collect relative module specifiers from static + dynamic imports.
 * @param {string} content
 * @returns {string[]}
 */
function collectRelativeImportSpecifiers(content) {
  const specifiers = [];
  STATIC_RELATIVE_IMPORT_RE.lastIndex = 0;
  DYNAMIC_RELATIVE_IMPORT_RE.lastIndex = 0;

  let match;
  while ((match = STATIC_RELATIVE_IMPORT_RE.exec(content)) !== null) {
    specifiers.push(match[1]);
  }

  while ((match = DYNAMIC_RELATIVE_IMPORT_RE.exec(content)) !== null) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

/**
 * Validate app imports do not escape deploy source root.
 * @param {{ relativePath: string, absolutePath: string, content: string, appRootRelative: string }} params
 */
function checkDeployRootImportBoundary({ relativePath, absolutePath, content, appRootRelative }) {
  if (!relativePath.startsWith(`${appRootRelative}/`)) {
    return;
  }

  const appRootAbsolute = path.resolve(repoRoot, appRootRelative);
  const sourceDir = path.dirname(absolutePath);
  const specifiers = collectRelativeImportSpecifiers(content);
  for (const specifier of specifiers) {
    const resolvedPath = path.resolve(sourceDir, specifier);
    const withinRoot = resolvedPath === appRootAbsolute || resolvedPath.startsWith(`${appRootAbsolute}${path.sep}`);
    if (!withinRoot) {
      boundaryErrors.push(
        `${relativePath}: import escapes app deploy root "${appRootRelative}" (${specifier})`,
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
      checkDeployRootImportBoundary({
        relativePath,
        absolutePath: file,
        content,
        appRootRelative: 'apps/api',
      });
      checkDeployRootImportBoundary({
        relativePath,
        absolutePath: file,
        content,
        appRootRelative: 'apps/functions/stripe-api',
      });
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

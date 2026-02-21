import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const secretPatterns = [
  { id: 'private_key_block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'aws_access_key', regex: /AKIA[0-9A-Z]{16}/g },
  { id: 'github_token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: 'google_api_key', regex: /AIza[0-9A-Za-z\-_]{35}/g },
  { id: 'slack_token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { id: 'stripe_live_key', regex: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g },
];

const ignoreExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.mp4', '.mov', '.webm', '.zip', '.gz', '.tgz', '.jar', '.pdf',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
]);

function isBinaryBuffer(buffer) {
  const sampleSize = Math.min(buffer.length, 4096);
  for (let i = 0; i < sampleSize; i += 1) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

function getLineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

const trackedRaw = execSync('git ls-files -z', {
  cwd: repoRoot,
  encoding: 'utf8',
});
const trackedFiles = trackedRaw.split('\u0000').filter(Boolean);

const findings = [];

for (const relativePath of trackedFiles) {
  const extension = path.extname(relativePath).toLowerCase();
  if (ignoreExtensions.has(extension)) {
    continue;
  }

  const fullPath = path.join(repoRoot, relativePath);
  let buffer;
  try {
    buffer = fs.readFileSync(fullPath);
  } catch {
    continue;
  }

  if (buffer.length > 2_000_000 || isBinaryBuffer(buffer)) {
    continue;
  }

  const text = buffer.toString('utf8');

  for (const pattern of secretPatterns) {
    pattern.regex.lastIndex = 0;
    let match = pattern.regex.exec(text);
    while (match) {
      const line = getLineNumber(text, match.index);
      findings.push({
        path: relativePath,
        line,
        id: pattern.id,
      });
      match = pattern.regex.exec(text);
    }
  }
}

if (findings.length > 0) {
  console.error('Potential secrets detected in tracked files:');
  for (const finding of findings) {
    console.error(`- ${finding.path}:${finding.line} (${finding.id})`);
  }
  process.exit(1);
}

console.log('Secret scan passed (no high-confidence tracked secret patterns found).');

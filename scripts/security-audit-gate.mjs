import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

const ROOT_HIGH_ALLOWLIST = Object.freeze([
  {
    name: '@xboxreplay/xboxlive-auth',
    reviewBy: '2026-04-01',
    reason: 'Transitive dependency of mineflayer auth chain; awaiting upstream prismarine-auth/minecraft-protocol remediation.',
  },
  {
    name: 'axios',
    reviewBy: '2026-04-01',
    reason: 'Transitive via @xboxreplay/xboxlive-auth in mineflayer auth chain; no safe in-place patch in current upstream graph.',
  },
  {
    name: 'minecraft-protocol',
    reviewBy: '2026-04-01',
    reason: 'Reported via mineflayer advisory chain; tracked for upstream fix/validated alternative.',
  },
  {
    name: 'mineflayer',
    reviewBy: '2026-04-01',
    reason: 'Direct root dependency with audit advisory requiring incompatible semver-major rollback.',
  },
  {
    name: 'prismarine-auth',
    reviewBy: '2026-04-01',
    reason: 'Transitive mineflayer auth dependency with no patched upgrade path in current dependency graph.',
  },
]);

function toAllowlistMap(entries, targetName) {
  const allowlist = new Map();
  for (const entry of entries) {
    const name = String(entry?.name || '').trim();
    const reviewBy = String(entry?.reviewBy || '').trim();
    const reason = String(entry?.reason || '').trim();
    const reviewDate = new Date(`${reviewBy}T00:00:00Z`);

    if (!name || !reviewBy || !reason || Number.isNaN(reviewDate.getTime())) {
      throw new Error(`Invalid allowlist entry in ${targetName}: ${JSON.stringify(entry)}`);
    }

    allowlist.set(name, {
      name,
      reviewBy,
      reviewDate,
      reason,
    });
  }
  return allowlist;
}

const audits = [
  {
    name: 'root',
    cwd: REPO_ROOT,
    allowlistedHighVulns: toAllowlistMap(ROOT_HIGH_ALLOWLIST, 'root'),
  },
  { name: 'apps/api', cwd: path.join(REPO_ROOT, 'apps/api'), allowlistedHighVulns: new Map() },
  { name: 'apps/functions/stripe-api', cwd: path.join(REPO_ROOT, 'apps/functions/stripe-api'), allowlistedHighVulns: new Map() },
  { name: 'apps/webui', cwd: path.join(REPO_ROOT, 'apps/webui'), allowlistedHighVulns: new Map() },
];

function runAudit({ cwd }) {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd,
    encoding: 'utf8',
  });

  const stdout = String(result.stdout || '').trim();
  if (!stdout) {
    throw new Error(`npm audit produced no JSON output in ${cwd}`);
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse npm audit JSON in ${cwd}: ${error.message}`);
  }

  return report;
}

function collectBlockingVulns({ report, allowlistedHighVulns }) {
  const vulnerabilities = report?.vulnerabilities || {};
  const blocking = [];
  const allowlisted = [];
  const presentHighOrCritical = new Set();

  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    const severity = String(vuln?.severity || '').toLowerCase();
    if (severity !== 'high' && severity !== 'critical') {
      continue;
    }
    presentHighOrCritical.add(name);

    if (allowlistedHighVulns.has(name)) {
      const entry = allowlistedHighVulns.get(name);
      if (entry.reviewDate < TODAY) {
        blocking.push({
          name,
          severity,
          reason: `allowlist expired on ${entry.reviewBy}; review/update required`,
        });
        continue;
      }

      allowlisted.push({
        name,
        severity,
        reviewBy: entry.reviewBy,
        reason: entry.reason,
      });
      continue;
    }

    blocking.push({ name, severity, reason: 'not allowlisted' });
  }

  const staleAllowlist = [];
  for (const [name, entry] of allowlistedHighVulns.entries()) {
    if (!presentHighOrCritical.has(name)) {
      staleAllowlist.push({
        name,
        reviewBy: entry.reviewBy,
      });
    }
  }

  return { blocking, allowlisted, staleAllowlist };
}

let hasErrors = false;

for (const auditTarget of audits) {
  const report = runAudit(auditTarget);
  const counts = report?.metadata?.vulnerabilities || {};
  const { blocking, allowlisted, staleAllowlist } = collectBlockingVulns({
    report,
    allowlistedHighVulns: auditTarget.allowlistedHighVulns,
  });

  const high = Number(counts.high || 0);
  const critical = Number(counts.critical || 0);
  const moderate = Number(counts.moderate || 0);

  console.log(`\n[audit] ${auditTarget.name}: high=${high} critical=${critical} moderate=${moderate}`);

  if (allowlisted.length > 0) {
    for (const entry of allowlisted) {
      console.log(`[audit] ${auditTarget.name}: temporary allowlist -> ${entry.name} (reviewBy=${entry.reviewBy})`);
    }
  }

  if (staleAllowlist.length > 0) {
    console.log(`[audit] ${auditTarget.name}: stale allowlist entries (consider pruning) -> ${staleAllowlist.map((entry) => entry.name).join(', ')}`);
  }

  if (blocking.length > 0) {
    hasErrors = true;
    for (const entry of blocking) {
      console.error(`[audit][ERROR] ${auditTarget.name}: ${entry.name} (${entry.severity}) -> ${entry.reason}`);
    }
  }
}

if (hasErrors) {
  console.error('\nSecurity audit gate failed.');
  process.exit(1);
}

console.log('\nSecurity audit gate passed.');

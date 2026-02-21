import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();

const audits = [
  {
    name: 'root',
    cwd: REPO_ROOT,
    allowlistedHighVulns: new Set([
      '@xboxreplay/xboxlive-auth',
      'axios',
      'minecraft-protocol',
      'mineflayer',
      'prismarine-auth',
    ]),
  },
  { name: 'apps/api', cwd: path.join(REPO_ROOT, 'apps/api'), allowlistedHighVulns: new Set() },
  { name: 'apps/functions/stripe-api', cwd: path.join(REPO_ROOT, 'apps/functions/stripe-api'), allowlistedHighVulns: new Set() },
  { name: 'apps/webui', cwd: path.join(REPO_ROOT, 'apps/webui'), allowlistedHighVulns: new Set() },
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

  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    const severity = String(vuln?.severity || '').toLowerCase();
    if (severity !== 'high' && severity !== 'critical') {
      continue;
    }

    if (allowlistedHighVulns.has(name)) {
      allowlisted.push({ name, severity });
      continue;
    }

    blocking.push({ name, severity });
  }

  return { blocking, allowlisted };
}

let hasErrors = false;

for (const auditTarget of audits) {
  const report = runAudit(auditTarget);
  const counts = report?.metadata?.vulnerabilities || {};
  const { blocking, allowlisted } = collectBlockingVulns({
    report,
    allowlistedHighVulns: auditTarget.allowlistedHighVulns,
  });

  const high = Number(counts.high || 0);
  const critical = Number(counts.critical || 0);
  const moderate = Number(counts.moderate || 0);

  console.log(`\n[audit] ${auditTarget.name}: high=${high} critical=${critical} moderate=${moderate}`);

  if (allowlisted.length > 0) {
    console.log(`[audit] ${auditTarget.name}: allowed temporary high vulnerabilities -> ${allowlisted.map((entry) => entry.name).join(', ')}`);
  }

  if (blocking.length > 0) {
    hasErrors = true;
    for (const entry of blocking) {
      console.error(`[audit][ERROR] ${auditTarget.name}: ${entry.name} (${entry.severity}) is not allowlisted`);
    }
  }
}

if (hasErrors) {
  console.error('\nSecurity audit gate failed.');
  process.exit(1);
}

console.log('\nSecurity audit gate passed.');

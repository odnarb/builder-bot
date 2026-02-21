import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const routesDir = path.join(repoRoot, 'apps/api/routes');
const indexPath = path.join(repoRoot, 'apps/api/index.js');

const publicRouteExceptions = new Set([
  '/community/marketplace/listings',
  '/config/skus',
  '/config/localization',
]);

function requiresJwt(pathname) {
  if (publicRouteExceptions.has(pathname)) {
    return false;
  }
  if (pathname.startsWith('/admin')) {
    return false;
  }
  if (pathname.startsWith('/user')) {
    return true;
  }
  if (pathname.startsWith('/stripe')) {
    return true;
  }
  if (pathname.startsWith('/community')) {
    return true;
  }
  if (pathname === '/ai-get-structure') {
    return true;
  }
  if (pathname.startsWith('/analytics/')) {
    return true;
  }
  return false;
}

const errors = [];

const indexSource = fs.readFileSync(indexPath, 'utf8');
const adminGuard = "app.use('/admin', jwtCheck, requireAdminAccess);";
const adminGuardIndex = indexSource.indexOf(adminGuard);
const registerAdminRoutesIndex = indexSource.indexOf('registerAdminRoutes(app, deps);');

if (adminGuardIndex < 0) {
  errors.push(`Missing admin guard middleware in ${path.relative(repoRoot, indexPath)}.`);
} else if (registerAdminRoutesIndex >= 0 && adminGuardIndex > registerAdminRoutesIndex) {
  errors.push('Admin guard middleware is registered after admin routes.');
}

const routeFiles = fs.readdirSync(routesDir)
  .filter((entry) => entry.endsWith('.js'))
  .map((entry) => path.join(routesDir, entry));

const routeLineRegex = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'\s*,\s*(.+)$/;

for (const filePath of routeFiles) {
  const relativePath = path.relative(repoRoot, filePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const match = routeLineRegex.exec(line);
    if (!match) {
      return;
    }

    const routePath = match[2];
    const handlerPrefix = match[3];
    if (!requiresJwt(routePath)) {
      return;
    }

    if (!handlerPrefix.includes('jwtCheck')) {
      errors.push(`${relativePath}:${index + 1} -> ${routePath} is missing jwtCheck middleware.`);
    }
  });
}

if (errors.length > 0) {
  console.error('Protected route checks failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Protected route checks passed.');

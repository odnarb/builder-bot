import { runPreScaleSimulation } from '../utils/pre-scale-simulation.js';

/**
 * Parse CLI args in `--key=value` shape.
 * @returns {{ seed?: number, concurrentUsers?: number, requestsPerUser?: number }}
 */
function parseArgs() {
    const params = {};
    for (const arg of process.argv.slice(2)) {
        const [rawKey, rawValue] = String(arg).split('=');
        if (!rawKey?.startsWith('--') || rawValue === undefined) {
            continue;
        }

        const key = rawKey.slice(2);
        const num = Number(rawValue);
        params[key] = Number.isFinite(num) ? num : rawValue;
    }

    return params;
}

const params = parseArgs();
const report = runPreScaleSimulation({
    seed: params.seed,
    concurrentUsers: params.concurrentUsers,
    requestsPerUser: params.requestsPerUser,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

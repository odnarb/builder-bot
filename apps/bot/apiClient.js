import 'dotenv/config.js';

const API_URL = process.env.API_URL || 'http://localhost:3001'
const AUTH_TOKEN = String(process.env.AUTH_TOKEN || '').trim()
const SESSION_ID = process.env.SESSION_ID || '123-123-1234'

function authHeaders() {
    const headers = {
        'Content-Type': 'application/json',
    };

    if (AUTH_TOKEN) {
        headers.Authorization = `Bearer ${AUTH_TOKEN}`;
    }

    return headers;
}

function handleApiError(res, context = '') {
    return res.text().then((msg) => {
        const body = msg || '{}';
        const status = Number(res.status || 0);
        const authHint = (status === 401 || status === 403)
            ? ' Set AUTH_TOKEN to a fresh access token for local bot runs.'
            : '';
        throw new Error(`❌ ${context} failed: ${status} - ${body}${authHint}`);
    });
}

// 🧠 Ask ChatGPT for block structure
export async function getStructureAndTagsFromAI(payload) {
    const requestPayload = typeof payload === 'string'
        ? { message: payload }
        : payload;

    if (!requestPayload?.message || typeof requestPayload.message !== 'string') {
        throw new Error('Missing message for getStructureAndTagsFromAI');
    }

    const res = await fetch(`${API_URL}/api/ai-get-structure`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(requestPayload),
    });

    if (!res.ok) return handleApiError(res, 'Generate structure');

    const data = await res.json();
    return data.instructionPlan || data.blocksAndTags;
}

// Get user tier
export async function getUserTier() {
    const res = await fetch(`${API_URL}/api/user/tier`, {
        headers: authHeaders(),
    });

    if (!res.ok) return handleApiError(res, 'Get user tier');

    return res.json();
}

// Create session
export async function createSession({ session }) {
    if (!session) {
        throw new Error('Missing session');
    }

    const res = await fetch(`${API_URL}/api/user/session/${SESSION_ID}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ session }),
    });

    if (!res.ok) return handleApiError(res, 'Create session');

    return res.json();
}

// Create build
export async function createUserBuild({ build }) {
    const res = await fetch(`${API_URL}/api/user/session/${SESSION_ID}/build`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ build }),
    });

    if (!res.ok) return handleApiError(res, 'Update build');

    const { buildId } = await res.json()
    return buildId
}

// Update build
export async function updateUserBuild({ buildId, build }) {
    if (!buildId || !build) {
        throw new Error('Missing buildId or build data for updateUserBuild');
    }

    const res = await fetch(`${API_URL}/api/user/session/${SESSION_ID}/build/${buildId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ build }),
    });

    if (!res.ok) return handleApiError(res, 'Update build');

    return true;
}

// Upload steps
export async function uploadBuildSteps({ buildId, steps }) {
    if (!buildId || !steps) {
        throw new Error('Missing buildId or build data for uploadBuildSteps');
    }

    const res = await fetch(`${API_URL}/api/user/session/${SESSION_ID}/build/${buildId}/steps`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ steps }),
    });

    if (!res.ok) return handleApiError(res, 'Update build');

    return res.json();
}

// Upload build logs
export async function uploadBuildLogs({ buildId, logs }) {
    if (!buildId || !logs) {
        throw new Error('Missing buildId or logs for uploadBuildLogs');
    }

    const res = await fetch(`${API_URL}/api/user/session/${SESSION_ID}/build/${buildId}/logs`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ logs }),
    });

    if (!res.ok) return handleApiError(res, 'Upload build logs');

    return res.json();
}


// Add log entry
export async function addLogEntry(log) {
    if (!log) {
        throw new Error('Missing log');
    }

    const res = await fetch(`${API_URL}/api/user/session/${SESSION_ID}/log`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ log }),
    });

    if (!res.ok) return handleApiError(res, 'Add log entry');

    return res.json();
}

// End session
// This is special because all the vars are coming from outside the bot process and therefore have no process.env context
export async function endSession({ envVars, session }) {
    if (!session) {
        throw new Error('Missing session');
    }

    const res = await fetch(`${envVars.API_URL}/api/user/session/${envVars.SESSION_ID}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${envVars.AUTH_TOKEN}`,
        },
        body: JSON.stringify({ session }),
    });

    if (!res.ok) return handleApiError(res, 'End session');

    return res.json();
}

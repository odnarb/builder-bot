const API_URL = process.env.API_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const USER_ID = process.env.USER_ID;

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUTH_TOKEN}`,
    };
}

function handleApiError(res, context = '') {
    return res.text().then(msg => {
        throw new Error(`❌ ${context} failed: ${res.status} - ${msg}`);
    });
}

// Get user tier
export async function getUserTier() {
    const res = await fetch(`${API_URL}/api/user/tier?userId=${encodeURIComponent(USER_ID)}`, {
        headers: authHeaders(),
    });

    if (!res.ok) return handleApiError(res, 'Update build');

    return res.json();
}

// Create build
export async function createUserBuild(build) {
    const res = await fetch(`${API_URL}/api/user/build`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ build }),
    });

    if (!res.ok) return handleApiError(res, 'Update build');

    return res.json(); // returns { buildId }
}

// Update build
export async function updateUserBuild({ buildId, build }) {
    if (!buildId || !build) {
        throw new Error('Missing buildId or build data for updateUserBuild');
    }

    const res = await fetch(`${API_URL}/api/user/build/${buildId}`, {
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
        throw new Error('Missing buildId or build data for updateUserBuild');
    }

    const res = await fetch(`${API_URL}/api/user/build/${buildId}/steps`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ steps }),
    });

    if (!res.ok) return handleApiError(res, 'Update build');

    return res.json();
}


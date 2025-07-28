const API_URL = process.env.API_URL || 'http://localhost:3001'
const AUTH_TOKEN = process.env.AUTH_TOKEN || "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IlIydEptbjAwVXBDQkFLR1hwQlgzayJ9.eyJpc3MiOiJodHRwczovL2Rldi1vM2YxMG81YjR6djBjNjhrLnVzLmF1dGgwLmNvbS8iLCJzdWIiOiJhdXRoMHw2ODgxMjgzMDJiY2ExZGViZmQyY2U1MzMiLCJhdWQiOlsiaHR0cHM6Ly9hcGkubWNidWlsZGVyYm90LmNvbSIsImh0dHBzOi8vZGV2LW8zZjEwbzViNHp2MGM2OGsudXMuYXV0aDAuY29tL3VzZXJpbmZvIl0sImlhdCI6MTc1MzQ5MTM4MSwiZXhwIjoxNzUzNTc3NzgxLCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIiwiYXpwIjoiQ3Y5VWljWXN0VmozM1hEeHN3V0FRNTlZeTdJNFVtZWoifQ.qdMQ-U9OE3aRqE1L-0Vx_i_Mk0OQNsbst9cCHrRI8LFLsRJ8tnTtGwFLIrFz2IyavlvBE7aEWJ4ggaa1Klee9_JeHewRBUbMmvscjddBbavWtUaQCoRVWnWWMqZAWobUGoiGRnPU33vQPzsnmWi7SY_HFwjGN437GdyQQKhoURBhIwSqkHEZ7ija80NlApmC-41yZAicjcKfsZkVVLWQatKOZY6KE3koRw3Qdxk9A6-cptaNx-UClk_zWwKUm9XWOA3GkHk7vxG6SxJFKT72vcSzt_FHLT58CG34NGUxr3EyfIef1WA67Cy8P1j-RfLne_R7h0QTipVfn_7rOiZ09Q"
const SESSION_ID = process.env.SESSION_ID || '123-123-1234'

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

// 🧠 Ask ChatGPT for block structure
export async function getStructureAndTagsFromAI(message) {
    const res = await fetch(`${process.env.API_URL}/api/ai-get-structure`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message }),
    });

    const data = await res.json();
    return data.blocksAndTags;
}

// Get user tier
export async function getUserTier() {
    const res = await fetch(`${API_URL}/api/user/tier`, {
        headers: authHeaders(),
    });

    if (!res.ok) return handleApiError(res, 'Update build');

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
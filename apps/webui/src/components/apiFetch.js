export async function fetchJson(path, options = {}) {
  const response = await fetch(path, options);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed: ${path}`);
  }

  return response.json();
}

export async function fetchAuthorizedJson(getAccessTokenSilently, path, options = {}) {
  const token = await getAccessTokenSilently();
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  return fetchJson(path, {
    ...options,
    headers,
  });
}

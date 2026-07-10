export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

let _token: string | null = null;

export function setApiToken(token: string | null) {
  _token = token;
}

export function getApiToken(): string | null {
  return _token;
}

// Drop-in fetch wrapper that auto-includes Authorization + Content-Type headers.
// Use for all calls to API_BASE. Non-JSON bodies (e.g. FormData) should pass
// their own Content-Type header which will override the default.
export function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  const callerHeaders = (opts.headers ?? {}) as Record<string, string>;
  for (const [k, v] of Object.entries(callerHeaders)) headers[k] = v;
  return fetch(`${API_BASE}${path}`, { ...opts, headers });
}

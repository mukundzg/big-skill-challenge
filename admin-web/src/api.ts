const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';

function parseError(res: Response, body: string): string {
  try {
    const j = JSON.parse(body) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map((x) => JSON.stringify(x)).join('; ');
    if (d != null) return JSON.stringify(d);
  } catch {
    /* ignore */
  }
  return body || res.statusText;
}

export async function api<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseError(res, text));
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const apiBase = API_BASE;

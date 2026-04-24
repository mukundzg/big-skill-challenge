import { API_BASE_URL } from '../config/env';

const REQUEST_TIMEOUT_MS = 15000;

function joinUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${p}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ApiError(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`, 0);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetchWithTimeout(joinUrl(path));
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(`Request failed: ${path}`, res.status, text);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function apiPost<TBody extends object, TRes = unknown>(
  path: string,
  body: TBody,
): Promise<TRes> {
  const res = await fetchWithTimeout(joinUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(`Request failed: ${path}`, res.status, text);
  }
  if (!text) return undefined as TRes;
  try {
    return JSON.parse(text) as TRes;
  } catch {
    return text as unknown as TRes;
  }
}

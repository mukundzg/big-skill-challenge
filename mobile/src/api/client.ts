import { API_BASE_URL } from '../config/env';

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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(joinUrl(path));
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
  const res = await fetch(joinUrl(path), {
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

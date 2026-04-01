import { ApiError, apiPost } from './client';

function detailFromBody(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const j = JSON.parse(body) as { detail?: unknown };
    if (typeof j.detail === 'string') return j.detail;
    if (Array.isArray(j.detail) && j.detail.length > 0) {
      const first = j.detail[0] as { msg?: string };
      if (typeof first?.msg === 'string') return first.msg;
    }
  } catch {
    /* ignore */
  }
  return body;
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }

  static fromApiError(e: ApiError): AuthApiError {
    const detail = detailFromBody(e.body);
    return new AuthApiError(detail ?? e.message, e.status, e.body);
  }
}

export async function requestVerificationCode(email: string): Promise<void> {
  try {
    await apiPost('/auth/request-code', { email });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export async function verifyCode(email: string, code: string): Promise<void> {
  try {
    await apiPost('/auth/verify', { email, code });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

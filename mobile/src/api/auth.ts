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

/** Backend returned 404 (e.g. no row in `users` for logout). */
export function isUserNotFoundError(e: unknown): boolean {
  return e instanceof AuthApiError && e.status === 404;
}

export type VerifyResponse = {
  ok: boolean;
  user_id: number | null;
  email: string | null;
  is_verified: boolean;
  is_active: boolean;
  next_screen: string;
  /** True when server has recorded consent — skip consent screen. */
  has_consent?: boolean | null;
};

export type ConsentStatusResponse = {
  has_consent: boolean;
};

export type ConsentResponse = {
  ok: boolean;
  message?: string | null;
};

export type LogoutResponse = {
  ok: boolean;
  user_id: number | null;
  email: string | null;
  is_active: boolean;
  message?: string | null;
};

export async function requestVerificationCode(email: string): Promise<void> {
  try {
    await apiPost('/auth/request-code', { email });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export async function verifyCode(email: string, code: string): Promise<VerifyResponse> {
  try {
    return await apiPost<{ email: string; code: string }, VerifyResponse>('/auth/verify', {
      email,
      code,
    });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export async function logout(email: string): Promise<LogoutResponse> {
  try {
    return await apiPost<{ email: string }, LogoutResponse>('/auth/logout', { email });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

/** Server source of truth for consent; falls back to local storage if the call fails. */
export async function fetchConsentStatus(email: string): Promise<ConsentStatusResponse> {
  try {
    return await apiPost<{ email: string }, ConsentStatusResponse>('/auth/consent-status', {
      email,
    });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export async function submitConsent(email: string): Promise<ConsentResponse> {
  try {
    return await apiPost<{ email: string }, ConsentResponse>('/auth/consent', { email });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

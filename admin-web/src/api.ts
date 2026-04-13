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

export type QuestionBankUploadItem = {
  original_file_name: string;
  success: boolean;
  file_id?: number | null;
  file_name?: string | null;
  inserted_questions: number;
  deduped_questions: number;
  /** True if Ollama generated decoys for at least one question in this PDF */
  used_ollama?: boolean;
  /** True if Gemini extracted MCQs after regex parsing found none */
  used_gemini?: boolean;
  error?: string | null;
  needs_gemini_confirmation?: boolean;
  pending_id?: string | null;
  gemini_prompt_reason?: string | null;
  /** True when multi-file batch skipped Gemini; re-upload these files one at a time */
  suggest_upload_individually?: boolean;
};

export type QuestionBankConfirmGeminiResponse = {
  ok: true;
  file_id: number;
  file_name: string;
  inserted_questions: number;
  deduped_questions: number;
  used_ollama?: boolean;
  used_gemini?: boolean;
};

export type QuestionBankUploadBatchResponse = {
  ok: true;
  items: QuestionBankUploadItem[];
  succeeded: number;
  failed: number;
};

export type QuestionBankUploadProgress = {
  /** 0–100 overall bar */
  percent: number;
  phase: 'upload' | 'processing';
};

function parseXhrError(xhr: XMLHttpRequest, body: string): string {
  return parseError(
    new Response(body, { status: xhr.status, statusText: xhr.statusText }),
    body,
  );
}

/**
 * POST multipart to question-bank upload with upload-byte progress (XHR) and a smooth
 * “processing” segment until the server responds (parse / dedupe / DB — no server push).
 */
export function uploadQuestionBanksWithProgress(
  formData: FormData,
  token: string,
  onProgress: (p: QuestionBankUploadProgress) => void,
): Promise<QuestionBankUploadBatchResponse> {
  const url = `${API_BASE}/admin/question-banks/upload`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let simTimer: ReturnType<typeof setInterval> | null = null;
    let processingStarted = false;

    const clearSim = () => {
      if (simTimer) {
        clearInterval(simTimer);
        simTimer = null;
      }
    };

    const startProcessingPhase = () => {
      if (processingStarted) return;
      processingStarted = true;
      onProgress({ percent: 25, phase: 'processing' });
      let sim = 25;
      simTimer = setInterval(() => {
        sim = Math.min(sim + 0.85, 92);
        onProgress({ percent: sim, phase: 'processing' });
      }, 380);
    };

    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        const pct = Math.min(22, Math.round((ev.loaded / ev.total) * 22));
        onProgress({ percent: pct, phase: 'upload' });
      }
    };

    xhr.upload.onload = () => {
      startProcessingPhase();
    };

    xhr.onload = () => {
      clearSim();
      const text = xhr.responseText || '';
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress({ percent: 100, phase: 'processing' });
        try {
          resolve(JSON.parse(text) as QuestionBankUploadBatchResponse);
        } catch {
          reject(new Error('Invalid server response'));
        }
      } else {
        reject(new Error(parseXhrError(xhr, text)));
      }
    };

    xhr.onerror = () => {
      clearSim();
      reject(new Error('Network error'));
    };

    onProgress({ percent: 2, phase: 'upload' });
    xhr.send(formData);
  });
}

export const apiBase = API_BASE;

export async function confirmQuestionBankGemini(
  pendingId: string,
  token: string,
): Promise<QuestionBankConfirmGeminiResponse> {
  return api<QuestionBankConfirmGeminiResponse>(
    `/admin/question-banks/pending/${encodeURIComponent(pendingId)}/confirm-gemini`,
    { method: 'POST', token },
  );
}

export async function cancelPendingQuestionBank(pendingId: string, token: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(
    `/admin/question-banks/pending/${encodeURIComponent(pendingId)}`,
    { method: 'DELETE', token },
  );
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  api,
  apiBase,
  cancelPendingQuestionBank,
  confirmQuestionBankGemini,
  uploadQuestionBanksWithProgress,
  type QuestionBankUploadBatchResponse,
} from '../api';
import type { QbBackgroundJob, QuestionBankRow } from '../types';

type QuestionBanksResponse = { rows: QuestionBankRow[] };

type GeminiQueueItem = {
  pendingId: string;
  originalFileName: string;
  reason: string;
};

function formatBatchSummary(out: QuestionBankUploadBatchResponse): string {
  const okItems = out.items.filter((i) => i.success);
  const pendingGemini = out.items.filter((i) => i.needs_gemini_confirmation);
  const filesOk = okItems.length;
  const questionsSaved = okItems.reduce((n, i) => n + (i.inserted_questions ?? 0), 0);
  const anyOllama = okItems.some((i) => i.used_ollama === true);
  const anyGemini = okItems.some((i) => i.used_gemini === true);
  const parts = [
    `${filesOk} file(s)`,
    `${questionsSaved} question(s) saved`,
    `Ollama: ${anyOllama ? 'yes' : 'no'}`,
    `Gemini: ${anyGemini ? 'yes' : 'no'}`,
  ];
  if (pendingGemini.length > 0) {
    parts.push(`${pendingGemini.length} awaiting your review (Gemini optional)`);
  }
  const hardFailed = out.items.filter((i) => !i.success && !i.needs_gemini_confirmation);
  if (hardFailed.length > 0) {
    parts.push(`${hardFailed.length} failed`);
  }
  let text = `Upload summary: ${parts.join(' · ')}.`;
  const oneByOne = out.items.filter((i) => i.suggest_upload_individually);
  if (oneByOne.length > 0) {
    const names = oneByOne.map((i) => i.original_file_name).join(', ');
    text += `\n\nThese did not parse in this batch — upload one at a time so you can review each PDF and approve Gemini if needed: ${names}`;
  }
  const errs = out.items.filter((i) => !i.success && !i.needs_gemini_confirmation);
  if (errs.length) {
    text += `\n${errs.map((e) => `${e.original_file_name}: ${e.error ?? 'failed'}`).join('\n')}`;
  }
  return text;
}

function phaseLabel(phase: 'upload' | 'processing'): string {
  if (phase === 'upload') return 'Uploading PDFs…';
  return 'Parsing, deduplicating, saving to database…';
}

export function QuestionBanksPanel({
  token,
  qbBackgroundJob,
  setQbBackgroundJob,
}: {
  token: string;
  qbBackgroundJob: QbBackgroundJob | null;
  setQbBackgroundJob: Dispatch<SetStateAction<QbBackgroundJob | null>>;
}) {
  const [rows, setRows] = useState<QuestionBankRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [foregroundBusy, setForegroundBusy] = useState(false);
  const [fgProgress, setFgProgress] = useState(0);
  const [fgPhase, setFgPhase] = useState('');
  const [msgFading, setMsgFading] = useState(false);
  const [geminiQueue, setGeminiQueue] = useState<GeminiQueueItem[]>([]);
  const [geminiPdfUrl, setGeminiPdfUrl] = useState<string | null>(null);
  const [geminiPdfErr, setGeminiPdfErr] = useState<string | null>(null);
  const [geminiBusy, setGeminiBusy] = useState(false);
  const mountedRef = useRef(true);
  const msgAutoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgFadeEndRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeGemini = geminiQueue[0] ?? null;

  const popGeminiQueue = useCallback(() => {
    setGeminiQueue((q) => q.slice(1));
  }, []);

  const clearMsgAutoDismiss = useCallback(() => {
    if (msgAutoDismissRef.current) {
      clearTimeout(msgAutoDismissRef.current);
      msgAutoDismissRef.current = null;
    }
    if (msgFadeEndRef.current) {
      clearTimeout(msgFadeEndRef.current);
      msgFadeEndRef.current = null;
    }
  }, []);

  const dismissUploadSummary = useCallback(() => {
    clearMsgAutoDismiss();
    setMsgFading(false);
    setMsg(null);
  }, [clearMsgAutoDismiss]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activeGemini) {
      setGeminiPdfUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setGeminiPdfErr(null);
      return undefined;
    }
    let cancelled = false;
    setGeminiPdfErr(null);
    setGeminiPdfUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `${apiBase}/admin/question-banks/pending/${encodeURIComponent(activeGemini.pendingId)}/pdf`,
          { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal },
        );
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || res.statusText);
        }
        const blob = await res.blob();
        if (cancelled) return;
        setGeminiPdfUrl(URL.createObjectURL(blob));
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setGeminiPdfErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      setGeminiPdfUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
    };
  }, [activeGemini?.pendingId, token]);

  useEffect(() => {
    if (!msg) {
      setMsgFading(false);
      clearMsgAutoDismiss();
      return;
    }
    setMsgFading(false);
    clearMsgAutoDismiss();
    msgAutoDismissRef.current = setTimeout(() => {
      setMsgFading(true);
      msgFadeEndRef.current = setTimeout(() => {
        setMsg(null);
        setMsgFading(false);
        msgFadeEndRef.current = null;
      }, 480);
    }, 10000);
    return () => clearMsgAutoDismiss();
  }, [msg, clearMsgAutoDismiss]);

  const load = useCallback(async () => {
    const out = await api<QuestionBanksResponse>('/admin/question-banks', { token });
    if (mountedRef.current) setRows(out.rows || []);
  }, [token]);

  const onConfirmGemini = useCallback(async () => {
    const g = geminiQueue[0];
    if (!g) return;
    setGeminiBusy(true);
    setErr(null);
    try {
      await confirmQuestionBankGemini(g.pendingId, token);
      popGeminiQueue();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGeminiBusy(false);
    }
  }, [geminiQueue, token, load, popGeminiQueue]);

  const onCancelGemini = useCallback(async () => {
    const g = geminiQueue[0];
    if (!g) return;
    setGeminiBusy(true);
    try {
      await cancelPendingQuestionBank(g.pendingId, token);
    } catch {
      /* dequeue even if server already dropped the pending file */
    }
    setGeminiBusy(false);
    popGeminiQueue();
  }, [geminiQueue, token, popGeminiQueue]);

  useEffect(() => {
    void (async () => {
      try {
        setErr(null);
        await load();
      } catch (e) {
        if (mountedRef.current) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [load]);

  const resetFilePicker = useCallback(() => {
    setFiles([]);
    setFileKey((k) => k + 1);
  }, []);

  const buildFormData = useCallback(() => {
    const body = new FormData();
    for (const f of files) {
      body.append('files', f);
    }
    return body;
  }, [files]);

  const runUpload = useCallback(
    async (mode: 'foreground' | 'background') => {
      if (!files.length) {
        setErr('Choose one or more PDF files first.');
        return;
      }
      if (mode === 'background' && qbBackgroundJob && !qbBackgroundJob.done) {
        setErr('A background upload is already running. Dismiss it when finished, or wait.');
        return;
      }

      const fileLabel = files.map((f) => f.name).join(', ');
      const formData = buildFormData();

      setErr(null);
      if (mode === 'foreground') setMsg(null);
      resetFilePicker();

      const jobId = `${Date.now()}`;
      const bumpBg = (patch: Partial<QbBackgroundJob>) => {
        setQbBackgroundJob((prev) => {
          if (prev && prev.id === jobId) {
            return { ...prev, ...patch };
          }
          return {
            id: jobId,
            fileLabel,
            progress: 2,
            phaseLabel: phaseLabel('upload'),
            done: false,
            ...patch,
          };
        });
      };

      if (mode === 'background') {
        bumpBg({ progress: 2, phaseLabel: phaseLabel('upload'), done: false });
      } else {
        setForegroundBusy(true);
        setFgProgress(2);
        setFgPhase(phaseLabel('upload'));
      }

      try {
        const out = await uploadQuestionBanksWithProgress(formData, token, (p) => {
          const label = phaseLabel(p.phase);
          if (mode === 'background') {
            bumpBg({ progress: p.percent, phaseLabel: label });
          } else {
            setFgProgress(p.percent);
            setFgPhase(label);
          }
        });

        const summary = formatBatchSummary(out);
        const pendingGemini = out.items.flatMap((i) =>
          i.needs_gemini_confirmation && i.pending_id
            ? [
                {
                  pendingId: i.pending_id,
                  originalFileName: i.original_file_name,
                  reason:
                    i.gemini_prompt_reason?.trim() ||
                    'Local PDF parsing did not find usable multiple-choice questions.',
                },
              ]
            : [],
        );
        if (pendingGemini.length && mountedRef.current) {
          setGeminiQueue((q) => [...q, ...pendingGemini]);
        }
        if (mode === 'background') {
          bumpBg({
            progress: 100,
            phaseLabel: 'Done',
            done: true,
            summary,
          });
        } else if (mountedRef.current) {
          setMsg(summary);
        }
        if (mountedRef.current) await load();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (mode === 'background') {
          bumpBg({
            done: true,
            progress: 100,
            phaseLabel: 'Failed',
            error: message,
          });
        } else if (mountedRef.current) {
          setErr(message);
        }
      } finally {
        if (mode === 'foreground' && mountedRef.current) {
          setForegroundBusy(false);
          setFgProgress(0);
          setFgPhase('');
        }
      }
    },
    [
      files,
      buildFormData,
      qbBackgroundJob,
      resetFilePicker,
      setQbBackgroundJob,
      token,
      load,
    ],
  );

  const bgBlocking = Boolean(qbBackgroundJob && !qbBackgroundJob.done);

  return (
    <div className="panel-stack qb-panel-wrap">
      {foregroundBusy && (
        <div className="qb-upload-overlay" role="status" aria-live="polite">
          <div className="qb-upload-overlay-card">
            <div className="qb-upload-overlay-title">Processing question banks</div>
            <p className="muted qb-upload-overlay-phase">{fgPhase}</p>
            <div className="qb-progress-track">
              <div className="qb-progress-fill" style={{ width: `${Math.round(fgProgress)}%` }} />
            </div>
            <p className="muted qb-upload-overlay-pct">{Math.round(fgProgress)}%</p>
            <p className="muted qb-upload-overlay-hint">
              Upload progress is real; the rest follows server work (parse, dedupe, DB). Large models on
              first run can take longer.
            </p>
          </div>
        </div>
      )}

      {err && <p className="err">{err}</p>}
      {msg && (
        <div
          className={`ok qb-upload-summary ${msgFading ? 'qb-upload-summary-fade' : ''}`}
          role="status"
        >
          <button
            type="button"
            className="qb-upload-summary-close"
            onClick={dismissUploadSummary}
            aria-label="Dismiss upload summary"
          >
            ×
          </button>
          <pre className="qb-upload-summary-text">{msg}</pre>
        </div>
      )}

      <section className="card">
        <h3>Upload Question Banks (PDF)</h3>
        <p className="muted">
          Select one or many PDFs. They are processed in order (queued). Upload shows byte progress; after
          that, the bar estimates server-side ETL until the response returns.           If built-in parsing cannot read a PDF and the server has a Gemini key, a preview modal appears
          only when you upload a single PDF; with multiple files, ones that parse are saved and the rest
          are listed so you can re-upload them one by one. The PDF must yield at least as many distinct
          questions as{' '}
          <strong>Questions per attempt</strong> in Quiz settings (extras are trimmed). Use{' '}
          <strong>Run in background</strong> to switch pages while a batch finishes.
        </p>
        <input
          key={fileKey}
          className="input"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          disabled={foregroundBusy}
          onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
        />
        {files.length > 0 && (
          <p className="muted">
            {files.length} file{files.length === 1 ? '' : 's'} selected
          </p>
        )}
        <div className="row-actions qb-upload-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => void runUpload('foreground')}
            disabled={foregroundBusy || bgBlocking}
          >
            {foregroundBusy ? 'Processing…' : 'Upload'}
          </button>
          <button
            type="button"
            className="btn outline"
            onClick={() => void runUpload('background')}
            disabled={foregroundBusy || bgBlocking}
            title={
              bgBlocking
                ? 'Wait for the current background job to finish'
                : 'Clear selection and process while you use other admin pages'
            }
          >
            Run in background
          </button>
        </div>
      </section>

      {activeGemini && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !geminiBusy) void onCancelGemini();
          }}
        >
          <div
            className="modal-card qb-gemini-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qb-gemini-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="qb-gemini-title">Review PDF before Gemini extraction</h3>
            <p className="muted small">
              <strong>{activeGemini.originalFileName}</strong> — built-in parsing failed. Confirm you want
              Google Gemini to read this PDF and extract MCQs (uses your GEM_KEY quota).
            </p>
            <p className="qb-gemini-reason">{activeGemini.reason}</p>
            {geminiPdfErr && <p className="err">{geminiPdfErr}</p>}
            {!geminiPdfErr && !geminiPdfUrl && <p className="muted">Loading PDF preview…</p>}
            {geminiPdfUrl && (
              <iframe
                className="qb-gemini-pdf-frame"
                title="PDF preview"
                src={geminiPdfUrl}
              />
            )}
            <div className="row-actions" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="btn primary"
                disabled={geminiBusy || !geminiPdfUrl}
                onClick={() => void onConfirmGemini()}
              >
                {geminiBusy ? 'Working…' : 'Extract with Gemini'}
              </button>
              <button
                type="button"
                className="btn outline"
                disabled={geminiBusy}
                onClick={() => void onCancelGemini()}
              >
                Discard upload
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <h3>Stored Question Banks</h3>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>File</th>
              <th>Questions</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.file_name}</td>
                <td>{r.question_count}</td>
                <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="muted">
                  No question banks uploaded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

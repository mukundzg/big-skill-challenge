import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type {
  ContentAnalysisScores,
  ScoreDetail,
  ScoreReviewHistoryResponse,
  ScoreReviewHistoryRow,
  ScoreReviewUpdateBody,
  ScoreRow,
} from '../types';

function toIntOrNull(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i <= 0) return null;
  return i;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function reasoningEntries(r: ScoreRow): [string, string][] {
  const obj = r.reasoning;
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj)
    .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string])
    .filter(([, v]) => v && v !== 'null' && v !== '""')
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function humanizeInsight(raw: string): string {
  let s = raw.trim();
  if (!s) return s;

  // Remove common evaluator-internal prefixes.
  s = s.replace(/^Scored\s+(from|using)\s+[^:]+:\s*/i, '');
  s = s.replace(/^Detected\s+[^,]+,\s*guiding\s*/i, '');

  // Remove trailing "(score X)" markers; score is already shown in table.
  s = s.replace(/\(\s*score\s*\d+(\.\d+)?\s*\)/gi, '');

  // Collapse whitespace and tidy punctuation spacing.
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+([,.;:!?])/g, '$1');

  return s || raw.trim();
}

function fallbackInsightForDimension(key: string): string {
  const k = key.trim().toLowerCase();
  if (k === 'impact') return 'No urgency terms detected.';
  if (k === 'relevance') return 'No clear topic-alignment signals detected.';
  if (k === 'creativity') return 'No strong lexical novelty signals detected.';
  if (k === 'clarity') return 'No strong readability or punctuation signals detected.';
  return 'No strong heuristic signals detected.';
}

function normalizeMissingTokens(value: string, key: string): string {
  const v = value.toLowerCase();
  const hasNoneToken =
    v.includes("['none']") ||
    v.includes('["none"]') ||
    v.includes("'none'") ||
    v.includes('"none"') ||
    v.includes(' none ') ||
    v.endsWith(' none');
  if (!hasNoneToken) return value;
  return fallbackInsightForDimension(key);
}

function displayInsight(key: string, raw: string): string {
  const cleaned = humanizeInsight(raw);
  return normalizeMissingTokens(cleaned, key);
}

export function ContentAnalysisPanel({ token }: { token: string }) {
  const [data, setData] = useState<ContentAnalysisScores | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [agent, setAgent] = useState('agentic');
  const [userId, setUserId] = useState('');
  const [submissionId, setSubmissionId] = useState('');

  const [offset, setOffset] = useState(0);
  const limit = 25;
  const [detail, setDetail] = useState<ScoreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<ScoreReviewHistoryRow[]>([]);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reviewScores, setReviewScores] = useState({
    impact: '0',
    clarity: '0',
    relevance: '0',
    creativity: '0',
  });
  const [reviewReasoning, setReviewReasoning] = useState({
    impact: '',
    clarity: '',
    relevance: '',
    creativity: '',
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', String(limit));
    p.set('offset', String(offset));
    if (agent.trim()) p.set('agent', agent.trim());
    const uid = toIntOrNull(userId);
    const sid = toIntOrNull(submissionId);
    if (uid != null) p.set('user_id', String(uid));
    if (sid != null) p.set('submission_id', String(sid));
    return p.toString();
  }, [agent, userId, submissionId, limit, offset]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api<ContentAnalysisScores>(`/admin/content-analysis/scores?${qs}`, { token });
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [token, qs]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;
  const avg = summary?.avg ?? null;

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const page = data ? Math.floor(data.offset / limit) + 1 : 1;

  const onApplyFilters = () => {
    setOffset(0);
    void load();
  };

  const openDetail = async (scoreId: number) => {
    setDetailErr(null);
    setDetailLoading(true);
    setDetail(null);
    setReviewMode(false);
    setHistoryRows([]);
    setHistoryErr(null);
    try {
      const d = await api<ScoreDetail>(`/admin/content-analysis/scores/${scoreId}`, { token });
      setDetail(d);
      setReviewScores({
        impact: String(d.impact ?? 0),
        clarity: String(d.clarity ?? 0),
        relevance: String(d.relevance ?? 0),
        creativity: String(d.creativity ?? 0),
      });
      const rs = (d.reasoning ?? {}) as Record<string, unknown>;
      setReviewReasoning({
        impact: typeof rs.impact === 'string' ? rs.impact : '',
        clarity: typeof rs.clarity === 'string' ? rs.clarity : '',
        relevance: typeof rs.relevance === 'string' ? rs.relevance : '',
        creativity: typeof rs.creativity === 'string' ? rs.creativity : '',
      });
      try {
        const h = await api<ScoreReviewHistoryResponse>(`/admin/content-analysis/scores/${scoreId}/history`, { token });
        setHistoryRows(h.rows);
      } catch (e) {
        setHistoryErr(e instanceof Error ? e.message : String(e));
      }
      if (d.needs_human_review) {
        setToast('Recommendation: this row needs review. Click "Review" to adjudicate.');
      }
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const parseScore = (v: string): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (Math.trunc(n) !== n) return null;
    if (n < 0 || n > 10) return null;
    return n;
  };

  const saveReview = async () => {
    if (!detail) return;
    const impact = parseScore(reviewScores.impact);
    const clarity = parseScore(reviewScores.clarity);
    const relevance = parseScore(reviewScores.relevance);
    const creativity = parseScore(reviewScores.creativity);
    if ([impact, clarity, relevance, creativity].some((x) => x == null)) {
      setToast('Scores must be integers between 0 and 10.');
      return;
    }
    if (
      !reviewReasoning.impact.trim() ||
      !reviewReasoning.clarity.trim() ||
      !reviewReasoning.relevance.trim() ||
      !reviewReasoning.creativity.trim()
    ) {
      setToast('Reasoning text is required for all four dimensions.');
      return;
    }

    const body: ScoreReviewUpdateBody = {
      scores: {
        impact: impact as number,
        clarity: clarity as number,
        relevance: relevance as number,
        creativity: creativity as number,
      },
      reasoning: {
        impact: reviewReasoning.impact.trim(),
        clarity: reviewReasoning.clarity.trim(),
        relevance: reviewReasoning.relevance.trim(),
        creativity: reviewReasoning.creativity.trim(),
      },
    };

    setReviewSaving(true);
    try {
      const out = await api<{ ok: true; score: ScoreDetail }>(`/admin/content-analysis/scores/${detail.id}/review`, {
        method: 'PUT',
        body: JSON.stringify(body),
        token,
      });
      setDetail(out.score);
      setReviewMode(false);
      setToast('Review saved successfully.');
      const h = await api<ScoreReviewHistoryResponse>(`/admin/content-analysis/scores/${detail.id}/history`, { token });
      setHistoryRows(h.rows);
      void load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewSaving(false);
    }
  };

  return (
    <div className="panel-stack">
      {err && <p className="err">{err}</p>}

      <div className="card">
        <div className="toolbar">
          <h3>Score analysis</h3>
          <div className="toolbar-right">
            <button type="button" className="btn ghost sm" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        <p className="muted small">
          Data from <code>scores</code>: relevance, creativity, clarity, impact, total_score, weighted_score. Expand a row to
          see the <code>reasoning</code> JSON insights.
        </p>

        <div className="form-grid">
          <label className="label">
            Agent
            <input className="input" value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="agentic" />
          </label>
          <label className="label">
            User ID (optional)
            <input className="input" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="e.g. 12" />
          </label>
          <label className="label">
            Submission ID (optional)
            <input
              className="input"
              value={submissionId}
              onChange={(e) => setSubmissionId(e.target.value)}
              placeholder="e.g. 99"
            />
          </label>
        </div>
        <button type="button" className="btn outline" onClick={onApplyFilters}>
          Apply filters
        </button>
      </div>

      {summary && (
        <div className="stat-grid mini">
          <div className="stat-card flat">
            <span className="stat-label">Rows</span>
            <strong>{summary.count}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Avg relevance</span>
            <strong>{fmt(avg?.relevance, 2)}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Avg creativity</span>
            <strong>{fmt(avg?.creativity, 2)}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Avg clarity</span>
            <strong>{fmt(avg?.clarity, 2)}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Avg impact</span>
            <strong>{fmt(avg?.impact, 2)}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Avg total</span>
            <strong>{fmt(avg?.total_score, 2)}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Avg weighted</span>
            <strong>{fmt(avg?.weighted_score, 3)}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Weighted range</span>
            <strong>
              {summary.min && summary.max
                ? `${fmt(summary.min.weighted_score, 3)}–${fmt(summary.max.weighted_score, 3)}`
                : '—'}
            </strong>
          </div>
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <h3>Scores</h3>
          <div className="toolbar-right">
            <span className="muted small">
              Page {page}
              {totalPages ? ` of ${totalPages}` : ''} · {data?.total ?? 0} rows
            </span>
          </div>
        </div>

        {!data ? (
          <p className="muted">Loading…</p>
        ) : data.rows.length === 0 ? (
          <p className="muted">No rows match.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table dense">
                <thead>
                  <tr>
                    <th className="nowrap">Evaluated</th>
                    <th>Agent</th>
                    <th>User email</th>
                    <th>Review</th>
                    <th>Relevance</th>
                    <th>Creativity</th>
                    <th>Clarity</th>
                    <th>Impact</th>
                    <th>Total Score</th>
                    <th>Weighted Score</th>
                    <th>Confidence</th>
                    <th>Submitted Content</th>
                    <th>Insights</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const entries = reasoningEntries(r);
                    return (
                      <tr key={r.id}>
                        <td className="nowrap small">{r.evaluated_at ? new Date(r.evaluated_at).toLocaleString() : '—'}</td>
                        <td>{r.agent}</td>
                        <td>{r.user_email || '—'}</td>
                        <td>{r.needs_human_review ? <span className="badge">Review</span> : <span className="muted">—</span>}</td>
                        <td>{r.relevance}</td>
                        <td>{r.creativity}</td>
                        <td>{r.clarity}</td>
                        <td>{r.impact}</td>
                        <td>{r.total_score}</td>
                        <td className="mono">{fmt(r.weighted_score, 3)}</td>
                        <td>{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                        <td>
                          <button type="button" className="btn ghost sm" onClick={() => void openDetail(r.id)}>
                            View content
                          </button>
                        </td>
                        <td>
                          {entries.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            <details>
                              <summary className="muted small">View ({entries.length})</summary>
                              <div style={{ marginTop: 8 }}>
                                {entries.map(([k, v]) => (
                                  <div key={k} style={{ marginBottom: 8 }}>
                                    <div className="badge" style={{ marginBottom: 6 }}>
                                      {k}
                                    </div>
                                    <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>
                                      {displayInsight(k, v)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <button
                type="button"
                className="btn ghost sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Previous
              </button>
              <span className="muted small">
                Page {page}
                {totalPages ? ` of ${totalPages}` : ''} · {data.total} rows
              </span>
              <button
                type="button"
                className="btn ghost sm"
                disabled={!data || offset + limit >= data.total}
                onClick={() => setOffset(offset + limit)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      {(detailLoading || detailErr || detail) && (
        <div className="modal-backdrop" role="presentation" onClick={() => !detailLoading && setDetail(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="toolbar">
              <h3>Submission verification</h3>
              <button type="button" className="btn ghost sm" onClick={() => setDetail(null)} disabled={detailLoading}>
                Close
              </button>
            </div>
            {detailLoading && <p className="muted">Loading submission content…</p>}
            {detailErr && <p className="err">{detailErr}</p>}
            {detail && (
              <div className="panel-stack">
                <div className="stat-grid mini">
                  <div className="stat-card flat">
                    <span className="stat-label">User</span>
                    <strong>{detail.user_email || '—'}</strong>
                  </div>
                  <div className="stat-card flat">
                    <span className="stat-label">Model/Agent</span>
                    <strong>{detail.agent}</strong>
                  </div>
                  <div className="stat-card flat">
                    <span className="stat-label">Total</span>
                    <strong>{detail.total_score}</strong>
                  </div>
                  <div className="stat-card flat">
                    <span className="stat-label">Weighted</span>
                    <strong>{fmt(detail.weighted_score, 3)}</strong>
                  </div>
                  <div className="stat-card flat">
                    <span className="stat-label">Confidence</span>
                    <strong>{detail.confidence != null ? `${Math.round(detail.confidence * 100)}%` : '—'}</strong>
                  </div>
                  <div className="stat-card flat">
                    <span className="stat-label">Needs review</span>
                    <strong>{detail.needs_human_review ? 'Yes' : 'No'}</strong>
                  </div>
                  <div className="stat-card flat">
                    <span className="stat-label">Word count</span>
                    <strong>{detail.submission_word_count ?? '—'}</strong>
                  </div>
                </div>

                {toast && (
                  <div className="banner">
                    <div className="banner-head">
                      <strong>Notice</strong>
                      <button type="button" className="btn ghost sm" onClick={() => setToast(null)}>
                        dismiss
                      </button>
                    </div>
                    <div>{toast}</div>
                  </div>
                )}

                <div className="card">
                  <h3>Submitted content</h3>
                  <div className="submission-body">{detail.submission_text || 'No submission text available.'}</div>
                </div>

                {(detail.uncertainty_reason || detail.needs_human_review || detail.confidence != null) && (
                  <div className="card">
                    <h3>Uncertainty</h3>
                    <p className="muted small">
                      {detail.needs_human_review ? 'Flagged for human review.' : 'Not flagged for human review.'}{' '}
                      {detail.confidence != null ? `Confidence: ${Math.round(detail.confidence * 100)}%.` : ''}
                    </p>
                    {detail.uncertainty_reason ? (
                      <div className="submission-body">{detail.uncertainty_reason}</div>
                    ) : (
                      <p className="muted small">No uncertainty reason provided.</p>
                    )}
                  </div>
                )}

                <div className="card">
                  <div className="toolbar">
                    <h3>Score breakdown</h3>
                    <div className="toolbar-right">
                      <button
                        type="button"
                        className="btn outline"
                        onClick={() => setReviewMode((v) => !v)}
                        disabled={reviewSaving}
                      >
                        {reviewMode ? 'Cancel review' : 'Review'}
                      </button>
                    </div>
                  </div>
                  <p className="muted small">
                    Relevance: {detail.relevance} · Creativity: {detail.creativity} · Clarity: {detail.clarity} · Impact:{' '}
                    {detail.impact}
                  </p>

                  {reviewMode && (
                    <div className="panel-stack">
                      <div className="form-grid">
                        <label className="label">
                          Impact (0-10)
                          <input
                            className="input"
                            value={reviewScores.impact}
                            onChange={(e) => setReviewScores((s) => ({ ...s, impact: e.target.value }))}
                          />
                        </label>
                        <label className="label">
                          Clarity (0-10)
                          <input
                            className="input"
                            value={reviewScores.clarity}
                            onChange={(e) => setReviewScores((s) => ({ ...s, clarity: e.target.value }))}
                          />
                        </label>
                        <label className="label">
                          Relevance (0-10)
                          <input
                            className="input"
                            value={reviewScores.relevance}
                            onChange={(e) => setReviewScores((s) => ({ ...s, relevance: e.target.value }))}
                          />
                        </label>
                        <label className="label">
                          Creativity (0-10)
                          <input
                            className="input"
                            value={reviewScores.creativity}
                            onChange={(e) => setReviewScores((s) => ({ ...s, creativity: e.target.value }))}
                          />
                        </label>
                      </div>

                      <label className="label">
                        Impact reasoning
                        <textarea
                          className="textarea"
                          rows={2}
                          value={reviewReasoning.impact}
                          onChange={(e) => setReviewReasoning((r) => ({ ...r, impact: e.target.value }))}
                        />
                      </label>
                      <label className="label">
                        Clarity reasoning
                        <textarea
                          className="textarea"
                          rows={2}
                          value={reviewReasoning.clarity}
                          onChange={(e) => setReviewReasoning((r) => ({ ...r, clarity: e.target.value }))}
                        />
                      </label>
                      <label className="label">
                        Relevance reasoning
                        <textarea
                          className="textarea"
                          rows={2}
                          value={reviewReasoning.relevance}
                          onChange={(e) => setReviewReasoning((r) => ({ ...r, relevance: e.target.value }))}
                        />
                      </label>
                      <label className="label">
                        Creativity reasoning
                        <textarea
                          className="textarea"
                          rows={2}
                          value={reviewReasoning.creativity}
                          onChange={(e) => setReviewReasoning((r) => ({ ...r, creativity: e.target.value }))}
                        />
                      </label>

                      <button type="button" className="btn primary" onClick={() => void saveReview()} disabled={reviewSaving}>
                        {reviewSaving ? 'Saving...' : 'Save review'}
                      </button>
                    </div>
                  )}

                  <div style={{ marginTop: 8 }}>
                    {reasoningEntries(detail).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <div className="badge" style={{ marginBottom: 6 }}>
                          {k}
                        </div>
                        <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>
                          {displayInsight(k, v)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <h3>Review history</h3>
                  {historyErr && <p className="err">{historyErr}</p>}
                  {historyRows.length === 0 ? (
                    <p className="muted small">No review history yet.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="table dense">
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Reviewer</th>
                            <th>Previous</th>
                            <th>Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historyRows.map((h) => (
                            <tr key={h.id}>
                              <td className="nowrap small">{h.created_at ? new Date(h.created_at).toLocaleString() : '—'}</td>
                              <td>{h.reviewer}</td>
                              <td className="small mono">
                                {JSON.stringify((h.previous_row_json as Record<string, unknown>).scores ?? h.previous_row_json)}
                              </td>
                              <td className="small mono">
                                {JSON.stringify((h.updated_row_json as Record<string, unknown>).scores ?? h.updated_row_json)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


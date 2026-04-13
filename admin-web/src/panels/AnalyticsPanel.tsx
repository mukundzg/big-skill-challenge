import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AnalyticsAttempts, AnalyticsSummary, AttemptRow } from '../types';

export function AnalyticsPanel({ token }: { token: string }) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [attempts, setAttempts] = useState<AnalyticsAttempts | null>(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, a] = await Promise.all([
        api<AnalyticsSummary>('/admin/analytics/summary', { token }),
        api<AnalyticsAttempts>(
          `/admin/analytics/attempts?limit=${limit}&offset=${offset}${agentFilter ? `&status=${encodeURIComponent(agentFilter)}` : ''}`,
          { token },
        ),
      ]);
      setSummary(s);
      setAttempts(a);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [token, offset, agentFilter]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const onFilterChange = (v: string) => {
    setAgentFilter(v);
    setOffset(0);
  };

  const totalPages = attempts ? Math.ceil(attempts.total / limit) : 0;
  const page = attempts ? Math.floor(attempts.offset / limit) + 1 : 1;

  return (
    <div className="panel-stack">
      {err && <p className="err">{err}</p>}

      {summary && (
        <div className="stat-grid mini">
          <div className="stat-card flat">
            <span className="stat-label">Scores</span>
            <strong>{summary.total_scores}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Avg weighted</span>
            <strong>{summary.average_weighted_score != null ? summary.average_weighted_score.toFixed(3) : '—'}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Avg total</span>
            <strong>{summary.average_total_score != null ? summary.average_total_score.toFixed(2) : '—'}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Avg confidence</span>
            <strong>{summary.average_confidence != null ? `${Math.round(summary.average_confidence * 100)}%` : '—'}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Needs review</span>
            <strong>{summary.needs_review_count}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Users</span>
            <strong>{summary.distinct_users}</strong>
          </div>
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <h3>Score analytics</h3>
          <div className="toolbar-right">
            <label className="inline-label">
              Agent
              <input
                className="input select"
                value={agentFilter}
                onChange={(e) => onFilterChange(e.target.value)}
                placeholder="agentic"
              />
            </label>
            <button type="button" className="btn ghost sm" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        <p className="muted small">
          Data from the <code>scores</code> table (dimension scores + weighted score).
        </p>

        {!attempts ? (
          <p className="muted">Loading…</p>
        ) : attempts.rows.length === 0 ? (
          <p className="muted">No rows match.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table dense">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>User</th>
                    <th>Agent</th>
                    <th>Review</th>
                    <th>Relevance</th>
                    <th>Creativity</th>
                    <th>Clarity</th>
                    <th>Impact</th>
                    <th>Total</th>
                    <th>Weighted</th>
                    <th>Confidence</th>
                    <th>Evaluated</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.rows.map((r: AttemptRow) => (
                    <tr key={r.id}>
                      <td className="mono">{r.id}</td>
                      <td>{r.user_email}</td>
                      <td>{r.agent}</td>
                      <td>{r.needs_human_review ? <span className="badge">Review</span> : <span className="muted">—</span>}</td>
                      <td>{r.relevance}</td>
                      <td>{r.creativity}</td>
                      <td>{r.clarity}</td>
                      <td>{r.impact}</td>
                      <td>{r.total_score}</td>
                      <td>{r.weighted_score.toFixed(3)}</td>
                      <td>{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                      <td className="nowrap small">
                        {r.evaluated_at ? new Date(r.evaluated_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
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
                {totalPages ? ` of ${totalPages}` : ''} · {attempts.total} rows
              </span>
              <button
                type="button"
                className="btn ghost sm"
                disabled={!attempts || offset + limit >= attempts.total}
                onClick={() => setOffset(offset + limit)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

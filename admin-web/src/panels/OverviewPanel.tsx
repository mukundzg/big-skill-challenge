import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AnalyticsSummary, ScoreHighlightsResponse, ScoreRow } from '../types';

export function OverviewPanel({ token }: { token: string }) {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [userRows, setUserRows] = useState<ScoreRow[] | null>(null);
  const [userErr, setUserErr] = useState<string | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [hiOffset, setHiOffset] = useState(0);
  const hiLimit = 20;
  const [hiTotal, setHiTotal] = useState(0);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const s = await api<AnalyticsSummary>('/admin/analytics/summary', { token });
        if (!c) setData(s);
      } catch (e) {
        if (!c) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      c = true;
    };
  }, [token]);

  const loadHighlights = useCallback(async (nextOffset = hiOffset) => {
    setUserErr(null);
    setUserLoading(true);
    try {
      const r = await api<ScoreHighlightsResponse>(
        `/admin/analytics/score-highlights?limit=${hiLimit}&offset=${nextOffset}`,
        { token },
      );
      setUserRows(r.rows);
      setHiTotal(r.total);
      setHiOffset(r.offset);
    } catch (e) {
      setUserErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUserLoading(false);
    }
  }, [hiLimit, hiOffset, token]);

  useEffect(() => {
    void loadHighlights(0);
  }, [loadHighlights]);

  if (err) return <p className="err">{err}</p>;
  if (!data) return <p className="muted">Loading overview…</p>;

  const agentEntries = Object.entries(data.by_agent).sort((a, b) => b[1] - a[1]);
  const maxBar = Math.max(10, ...(userRows ?? []).map((r) => Math.max(r.total_score, Math.round(r.weighted_score * 10))));

  return (
    <div className="panel-stack">
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Scores</span>
          <strong className="stat-value">{data.total_scores}</strong>
          <span className="stat-hint">All time</span>
        </div>
        <div className="stat-card accent">
          <span className="stat-label">Participants</span>
          <strong className="stat-value">{data.distinct_users}</strong>
          <span className="stat-hint">Users with ≥1 attempt</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Avg. weighted</span>
          <strong className="stat-value">
            {data.average_weighted_score != null ? data.average_weighted_score.toFixed(3) : '—'}
          </strong>
          <span className="stat-hint">Across all scored submissions</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Weighted sum</span>
          <strong className="stat-value">{data.weighted_score_sum.toFixed(1)}</strong>
          <span className="stat-hint">Sum of weighted scores</span>
        </div>
      </div>

      <div className="card">
        <h3>Scores by agent</h3>
        <p className="muted small">Distribution across all rows in the scores table.</p>
        {agentEntries.length === 0 ? (
          <p className="muted">No scores yet.</p>
        ) : (
          <div className="bar-list">
            {agentEntries.map(([label, count]) => {
              const pct = data.total_scores ? Math.round((count / data.total_scores) * 100) : 0;
              return (
                <div key={label} className="bar-row">
                  <span className="badge">{label}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="bar-count">
                    {count} <span className="muted">({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <h3>Submission highlights across users</h3>
          <button type="button" className="btn outline" onClick={() => void loadHighlights(hiOffset)} disabled={userLoading}>
            {userLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <p className="muted small">
          Auto-pulls top scored row and latest review-flagged row from all users. Paginated.
        </p>
        {userErr && <p className="err">{userErr}</p>}
        {userRows && userRows.length === 0 && <p className="muted">No highlight rows found.</p>}
        {userRows && userRows.length > 0 && (
          <div className="bar-list">
            {userRows.map((r) => (
              <div key={r.id} className="card" style={{ marginBottom: 0 }}>
                <p className="muted small" style={{ marginTop: 0 }}>
                  {r.evaluated_at ? new Date(r.evaluated_at).toLocaleString() : '—'} · {r.highlight_kind || 'HIGHLIGHT'} ·
                  user={r.user_email || '—'} · agent={r.agent} · confidence=
                  {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'} · review=
                  {r.needs_human_review ? 'yes' : 'no'}
                </p>
                {[
                  ['Relevance', r.relevance],
                  ['Creativity', r.creativity],
                  ['Clarity', r.clarity],
                  ['Impact', r.impact],
                  ['Total', r.total_score],
                  ['Weighted x10', Math.round(r.weighted_score * 10)],
                ].map(([label, value]) => {
                  const v = Number(value) || 0;
                  const pct = Math.max(0, Math.min(100, Math.round((v / maxBar) * 100)));
                  return (
                    <div key={String(label)} className="bar-row">
                      <span>{label}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="bar-count">{v}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <div className="pager">
          <button
            type="button"
            className="btn ghost sm"
            disabled={hiOffset === 0 || userLoading}
            onClick={() => void loadHighlights(Math.max(0, hiOffset - hiLimit))}
          >
            Previous
          </button>
          <span className="muted small">
            {hiTotal} rows total
          </span>
          <button
            type="button"
            className="btn ghost sm"
            disabled={userLoading || hiOffset + hiLimit >= hiTotal}
            onClick={() => void loadHighlights(hiOffset + hiLimit)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

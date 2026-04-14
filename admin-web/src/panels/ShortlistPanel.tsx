import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ContestSettingRow, ShortlistScoresResponse } from '../types';

export function ShortlistPanel({ token }: { token: string }) {
  const [data, setData] = useState<ShortlistScoresResponse | null>(null);
  const [activeSetting, setActiveSetting] = useState<ContestSettingRow | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const loadActiveSetting = useCallback(async () => {
    const settingsResp = await api<{ settings: ContestSettingRow[] }>('/admin/contest-settings', { token });
    const active = settingsResp.settings.find((s) => s.is_active && !s.is_deleted) ?? null;
    setActiveSetting(active);
  }, [token]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      await loadActiveSetting();
      const d = await api<ShortlistScoresResponse>(
        `/admin/content-analysis/shortlist-scores?limit=${limit}&offset=${offset}`,
        { token },
      );
      setData(d);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [token, offset, loadActiveSetting]);

  const onToggleRepeatUsers = async (checked: boolean) => {
    if (!activeSetting) return;
    setErr(null);
    setSavingMode(true);
    try {
      await api<ContestSettingRow>(`/admin/contest-settings/${activeSetting.id}/shortlist-threshold`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          shortlist_threshold: activeSetting.shortlist_threshold,
          allow_repeat_users: checked,
        }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMode(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const page = data ? Math.floor(data.offset / limit) + 1 : 1;

  return (
    <div className="panel-stack">
      {err && <p className="err">{err}</p>}

      {data && (
        <div className="stat-grid mini">
          <div className="stat-card flat">
            <span className="stat-label">Threshold (top %)</span>
            <strong>{data.threshold_percent}%</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Scores in pool</span>
            <strong>{data.total_scores_in_pool}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Shortlist size</span>
            <strong>{data.shortlist_size}</strong>
          </div>
          <div className="stat-card flat">
            <span className="stat-label">Mode</span>
            <strong>{data.repeat_users ? 'Repeat users' : 'One per user'}</strong>
          </div>
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <h3>Shortlisted scores</h3>
          <div className="toolbar-right">
            <label className="inline-label">
              <input
                type="checkbox"
                checked={Boolean(activeSetting?.allow_repeat_users)}
                onChange={(e) => void onToggleRepeatUsers(e.target.checked)}
                disabled={!activeSetting || savingMode}
              />
              Repeat users
            </label>
            <button type="button" className="btn ghost sm" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        <p className="muted small">
          Uses the active contest setting&apos;s <strong>shortlist threshold</strong>: rows whose rank by{' '}
          <code>weighted_score</code> falls in the top N% of all rows in <code>scores</code> (N = threshold).
          Toggle <strong>Repeat users</strong> ON to allow multiple rows per user, OFF for one best row per user.
          Rank ties break on total score, then evaluation time, then id.
        </p>

        {!data && !err ? (
          <p className="muted">Loading…</p>
        ) : data ? (
          <>
            <div className="table-wrap">
              <table className="table dense">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>User</th>
                    <th>Agent</th>
                    <th className="nowrap">Weighted</th>
                    <th className="nowrap">Total</th>
                    <th>Evaluated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.id}</td>
                      <td>{r.user_email || '—'}</td>
                      <td>{r.agent}</td>
                      <td className="nowrap">{r.weighted_score.toFixed(3)}</td>
                      <td className="nowrap">{r.total_score}</td>
                      <td className="muted small nowrap">{r.evaluated_at ?? '—'}</td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No scores in the shortlist (empty pool or threshold yields zero rows).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {data.total > 0 && (
              <div className="pager">
                <button
                  type="button"
                  className="btn outline sm"
                  disabled={offset <= 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  Previous
                </button>
                <span className="muted small">
                  Page {page}
                  {totalPages > 0 ? ` / ${totalPages}` : ''} · {data.total} in shortlist
                </span>
                <button
                  type="button"
                  className="btn outline sm"
                  disabled={offset + limit >= data.total}
                  onClick={() => setOffset(offset + limit)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

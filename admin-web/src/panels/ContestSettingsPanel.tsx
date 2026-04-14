import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ContestSettingRow } from '../types';

type SettingsListResponse = { settings: ContestSettingRow[] };

function dateOnlyFromIso(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/** Returns normalized YYYY-MM-DD or null if empty/invalid. */
function parseYmd(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

type DateTextFieldProps = {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  small?: boolean;
};

/** Text field (type YYYY-MM-DD) + native date picker, kept in sync when the value is valid. */
function DateTextField({ value, onChange, ariaLabel, disabled, small }: DateTextFieldProps) {
  const pickerValue = parseYmd(value) ?? '';
  return (
    <div className={`date-text-field${small ? ' sm' : ''}`}>
      <input
        type="text"
        className={`input${small ? ' sm' : ''}`}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="YYYY-MM-DD"
        title="Type a date as YYYY-MM-DD, or use the calendar control."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const n = parseYmd(value);
          if (n) onChange(n);
          if (!value.trim()) onChange('');
        }}
        aria-label={ariaLabel}
        disabled={disabled}
      />
      <input
        type="date"
        className={`date-text-field-picker${small ? ' sm' : ''}`}
        value={pickerValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={`${ariaLabel} — calendar`}
      />
    </div>
  );
}

export function ContestSettingsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<ContestSettingRow[]>([]);
  const [subjectName, setSubjectName] = useState('');
  const [subjectDescription, setSubjectDescription] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [seasonStartDate, setSeasonStartDate] = useState('');
  const [seasonEndDate, setSeasonEndDate] = useState('');
  const [shortlistThreshold, setShortlistThreshold] = useState('10');
  const [rowSeasonDraft, setRowSeasonDraft] = useState<Record<number, { start: string; end: string }>>({});
  const [rowShortlistDraft, setRowShortlistDraft] = useState<
    Record<number, { threshold: string; allowRepeat: boolean }>
  >({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await api<SettingsListResponse>('/admin/contest-settings', { token });
    setRows(data.settings);
    const draft: Record<number, { start: string; end: string }> = {};
    for (const r of data.settings) {
      draft[r.id] = {
        start: dateOnlyFromIso(r.season_start),
        end: dateOnlyFromIso(r.season_end),
      };
    }
    setRowSeasonDraft(draft);
    const thd: Record<number, { threshold: string; allowRepeat: boolean }> = {};
    for (const r of data.settings) {
      thd[r.id] = {
        threshold: String(r.shortlist_threshold),
        allowRepeat: Boolean(r.allow_repeat_users),
      };
    }
    setRowShortlistDraft(thd);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onAdd = async () => {
    setErr(null);
    if (!subjectName.trim()) {
      setErr('Subject name is required.');
      return;
    }
    const sStart = seasonStartDate.trim();
    const sEnd = seasonEndDate.trim();
    if (sStart && !parseYmd(sStart)) {
      setErr('Season start must be empty or a valid date (YYYY-MM-DD).');
      return;
    }
    if (sEnd && !parseYmd(sEnd)) {
      setErr('Season end must be empty or a valid date (YYYY-MM-DD).');
      return;
    }
    const st = Number.parseInt(shortlistThreshold.trim(), 10);
    if (!Number.isFinite(st) || st < 1 || st > 100) {
      setErr('Shortlist threshold must be a whole number from 1 to 100.');
      return;
    }
    setLoading(true);
    try {
      await api<ContestSettingRow>('/admin/contest-settings', {
        method: 'POST',
        token,
        body: JSON.stringify({
          subject_name: subjectName.trim(),
          subject_description: subjectDescription.trim() || null,
          is_active: isActive,
          season_start_date: sStart ? parseYmd(sStart) : null,
          season_end_date: sEnd ? parseYmd(sEnd) : null,
          shortlist_threshold: st,
        }),
      });
      setSubjectName('');
      setSubjectDescription('');
      setIsActive(false);
      setSeasonStartDate('');
      setSeasonEndDate('');
      setShortlistThreshold('10');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onDeactivate = async (id: number) => {
    setErr(null);
    setLoading(true);
    try {
      await api(`/admin/contest-settings/${id}/deactivate`, {
        method: 'POST',
        token,
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onUpdateSeason = async (id: number) => {
    setErr(null);
    const draft = rowSeasonDraft[id];
    if (!draft) return;
    const ds = draft.start.trim();
    const de = draft.end.trim();
    if (ds && !parseYmd(ds)) {
      setErr('Season start must be empty or a valid date (YYYY-MM-DD).');
      return;
    }
    if (de && !parseYmd(de)) {
      setErr('Season end must be empty or a valid date (YYYY-MM-DD).');
      return;
    }
    setLoading(true);
    try {
      await api<ContestSettingRow>(`/admin/contest-settings/${id}/season`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          season_start_date: ds ? parseYmd(ds) : null,
          season_end_date: de ? parseYmd(de) : null,
        }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const setDraft = (id: number, field: 'start' | 'end', value: string) => {
    setRowSeasonDraft((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { start: '', end: '' }), [field]: value },
    }));
  };

  const onSaveShortlist = async (id: number) => {
    setErr(null);
    const draft = rowShortlistDraft[id];
    const raw = (draft?.threshold ?? '').trim();
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      setErr('Shortlist threshold must be a whole number from 1 to 100.');
      return;
    }
    setLoading(true);
    try {
      await api<ContestSettingRow>(`/admin/contest-settings/${id}/shortlist-threshold`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          shortlist_threshold: n,
          allow_repeat_users: Boolean(draft?.allowRepeat),
        }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel-stack">
      {err && <p className="err">{err}</p>}

      <div className="card">
        <h3>Add contest setting</h3>
        <p className="muted small">
          Only one row can be active at a time. If an active row exists, the API rejects adding another active
          row. Season dates are optional; when set, the stored range is start day 00:00:00 through end day
          23:59:59. Shortlist threshold (1–100) is the top percentage of all scores by weighted score used on the
          Shortlist tab.
        </p>
        <label className="label">Subject name</label>
        <input
          className="input"
          value={subjectName}
          onChange={(e) => setSubjectName(e.target.value)}
          placeholder="e.g. Climate policy"
        />
        <label className="label">Description (optional)</label>
        <textarea
          className="textarea"
          rows={3}
          value={subjectDescription}
          onChange={(e) => setSubjectDescription(e.target.value)}
          placeholder="Brief subject context used during evaluation."
        />
        <div className="row-dates">
          <div>
            <label className="label">Season start (date)</label>
            <DateTextField
              value={seasonStartDate}
              onChange={setSeasonStartDate}
              ariaLabel="Season start date"
              disabled={loading}
            />
          </div>
          <div>
            <label className="label">Season end (date)</label>
            <DateTextField
              value={seasonEndDate}
              onChange={setSeasonEndDate}
              ariaLabel="Season end date"
              disabled={loading}
            />
          </div>
        </div>
        <label className="label">Shortlist threshold (1–100)</label>
        <input
          className="input"
          type="number"
          min={1}
          max={100}
          step={1}
          value={shortlistThreshold}
          onChange={(e) => setShortlistThreshold(e.target.value)}
          title="Top N% of scores by weighted score (e.g. 10 = top 10%)."
        />
        <label className="inline-label mt">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Set as active contest setting
        </label>
        <button type="button" className="btn primary" onClick={() => void onAdd()} disabled={loading}>
          Add contest setting
        </button>
      </div>

      <div className="card">
        <h3>Contest settings</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Description</th>
                <th>Active</th>
                <th>Season (stored)</th>
                <th>Shortlist %</th>
                <th>Mode</th>
                <th>Update season</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.subject_name}</td>
                  <td>{r.subject_description || '-'}</td>
                  <td>{r.is_active ? 'yes' : 'no'}</td>
                  <td className="muted small">
                    {r.season_start || r.season_end ? (
                      <>
                        {r.season_start ? dateOnlyFromIso(r.season_start) : '—'} →{' '}
                        {r.season_end ? dateOnlyFromIso(r.season_end) : '—'}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <div className="inline-shortlist-edit">
                      <input
                        className="input sm"
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        aria-label="Shortlist threshold percent"
                        value={rowShortlistDraft[r.id]?.threshold ?? String(r.shortlist_threshold)}
                        onChange={(e) =>
                          setRowShortlistDraft((prev) => ({
                            ...prev,
                            [r.id]: {
                              threshold: e.target.value,
                              allowRepeat: prev[r.id]?.allowRepeat ?? Boolean(r.allow_repeat_users),
                            },
                          }))
                        }
                        disabled={loading || r.is_deleted}
                      />
                      <button
                        type="button"
                        className="btn outline sm"
                        onClick={() => void onSaveShortlist(r.id)}
                        disabled={loading || r.is_deleted}
                      >
                        Save
                      </button>
                    </div>
                  </td>
                  <td>
                    <label className="inline-label">
                      <input
                        type="checkbox"
                        checked={rowShortlistDraft[r.id]?.allowRepeat ?? Boolean(r.allow_repeat_users)}
                        onChange={(e) =>
                          setRowShortlistDraft((prev) => ({
                            ...prev,
                            [r.id]: {
                              threshold: prev[r.id]?.threshold ?? String(r.shortlist_threshold),
                              allowRepeat: e.target.checked,
                            },
                          }))
                        }
                        disabled={loading || r.is_deleted}
                      />
                      Repeat users
                    </label>
                  </td>
                  <td>
                    <div className="inline-season-edit">
                      <DateTextField
                        small
                        value={rowSeasonDraft[r.id]?.start ?? ''}
                        onChange={(v) => setDraft(r.id, 'start', v)}
                        ariaLabel="Season start"
                        disabled={loading || r.is_deleted}
                      />
                      <DateTextField
                        small
                        value={rowSeasonDraft[r.id]?.end ?? ''}
                        onChange={(v) => setDraft(r.id, 'end', v)}
                        ariaLabel="Season end"
                        disabled={loading || r.is_deleted}
                      />
                      <button
                        type="button"
                        className="btn outline sm"
                        onClick={() => void onUpdateSeason(r.id)}
                        disabled={loading || r.is_deleted}
                      >
                        Save season
                      </button>
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn danger sm"
                      onClick={() => void onDeactivate(r.id)}
                      disabled={loading}
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    No contest settings added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

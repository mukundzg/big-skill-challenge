import { useEffect, useState } from 'react';
import { api } from '../api';
import type { QuizSettings } from '../types';

export function QuizSettingsPanel({ token }: { token: string }) {
  const [data, setData] = useState<QuizSettings | null>(null);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [timeSec, setTimeSec] = useState(60);
  const [marks, setMarks] = useState(10);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let c = false;
    (async () => {
      setErr(null);
      try {
        const s = await api<QuizSettings>('/admin/quiz-settings', { token });
        if (!c) {
          setData(s);
          setMaxAttempts(s.max_attempts);
          setTimeSec(s.time_per_question_seconds);
          setMarks(s.marks_per_question);
        }
      } catch (e) {
        if (!c) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [token]);

  const onSave = async () => {
    setErr(null);
    setSaved(false);
    try {
      const s = await api<QuizSettings>('/admin/quiz-settings', {
        method: 'PUT',
        token,
        body: JSON.stringify({
          max_attempts: maxAttempts,
          time_per_question_seconds: timeSec,
          marks_per_question: marks,
        }),
      });
      setData(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <p className="muted">Loading settings…</p>;

  return (
    <div className="panel-stack">
      {err && <p className="err">{err}</p>}
      <div className="card">
        <h3>Quiz configuration</h3>
        <p className="muted small">
          These values map to the <code>quiz_settings</code> row (id=1) used for new quiz sessions.
        </p>
        {data && (
          <p className="muted small meta-line">
            Last updated {data.updated_at ? new Date(data.updated_at).toLocaleString() : '—'}
          </p>
        )}
        <div className="form-grid">
          <div>
            <label className="label">Max attempts per user (lifetime)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Seconds per question</label>
            <input
              className="input"
              type="number"
              min={5}
              value={timeSec}
              onChange={(e) => setTimeSec(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Marks per question</label>
            <input
              className="input"
              type="number"
              min={1}
              value={marks}
              onChange={(e) => setMarks(Number(e.target.value))}
            />
          </div>
        </div>
        <button type="button" className="btn primary" onClick={onSave}>
          Save changes
        </button>
        {saved && <span className="saved-tag">Saved</span>}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ContentSubjectRow } from '../types';

type SubjectListResponse = { subjects: ContentSubjectRow[] };

export function SubjectsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<ContentSubjectRow[]>([]);
  const [subjectName, setSubjectName] = useState('');
  const [subjectDescription, setSubjectDescription] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await api<SubjectListResponse>('/admin/content-subjects', { token });
    setRows(data.subjects);
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
    setLoading(true);
    try {
      await api<ContentSubjectRow>('/admin/content-subjects', {
        method: 'POST',
        token,
        body: JSON.stringify({
          subject_name: subjectName.trim(),
          subject_description: subjectDescription.trim() || null,
          is_active: isActive,
        }),
      });
      setSubjectName('');
      setSubjectDescription('');
      setIsActive(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onSoftDelete = async (id: number) => {
    setErr(null);
    setLoading(true);
    try {
      await api(`/admin/content-subjects/${id}/soft-delete`, {
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

  return (
    <div className="panel-stack">
      {err && <p className="err">{err}</p>}

      <div className="card">
        <h3>Add subject</h3>
        <p className="muted small">
          Only one subject can be active at a time. If active exists, API will reject adding another active subject.
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
        <label className="inline-label mt">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Set as active subject
        </label>
        <button type="button" className="btn primary" onClick={() => void onAdd()} disabled={loading}>
          Add subject
        </button>
      </div>

      <div className="card">
        <h3>Subjects</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Description</th>
                <th>Active</th>
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
                  <td>
                    <button
                      type="button"
                      className="btn danger sm"
                      onClick={() => void onSoftDelete(r.id)}
                      disabled={loading}
                    >
                      Soft delete
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No subjects added yet.
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

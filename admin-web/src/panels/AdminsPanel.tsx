import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AdminRow } from '../types';

type RegisterRes = { created: { email: string; password: string }[] };
type AdminList = { admins: AdminRow[] };

export function AdminsPanel({
  token,
  onCredentials,
}: {
  token: string;
  onCredentials: (c: { email: string; password: string }[] | null) => void;
}) {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [addEmails, setAddEmails] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<AdminList>('/admin/admins', { token });
    setAdmins(data.admins);
  }, [token]);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!c) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      c = true;
    };
  }, [load]);

  const onAdd = async () => {
    setErr(null);
    const emails = addEmails
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!emails.length) {
      setErr('Enter at least one email.');
      return;
    }
    try {
      const res = await api<RegisterRes>('/admin/admins', {
        method: 'POST',
        token,
        body: JSON.stringify({ emails }),
      });
      onCredentials(res.created);
      setAddEmails('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onDisable = async (id: number) => {
    setErr(null);
    try {
      await api(`/admin/admins/${id}/disable`, { method: 'POST', token });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="panel-stack">
      {err && <p className="err">{err}</p>}
      <div className="card">
        <h3>Administrators</h3>
        <p className="muted small">Manage who can access this console.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>{a.email}</td>
                  <td>{a.is_active ? 'yes' : 'no'}</td>
                  <td>
                    <button type="button" className="btn danger sm" onClick={() => onDisable(a.id)}>
                      Disable
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Add administrators</h3>
        <p className="muted small">Random passwords are shown once after you submit.</p>
        <textarea
          className="textarea"
          rows={4}
          value={addEmails}
          onChange={(e) => setAddEmails(e.target.value)}
          placeholder="email1@company.com, email2@company.com"
        />
        <button type="button" className="btn primary" onClick={() => void onAdd()}>
          Add admins
        </button>
      </div>
    </div>
  );
}

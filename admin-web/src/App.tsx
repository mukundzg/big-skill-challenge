import { useCallback, useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { api } from './api';
import './App.css';

const TOKEN_KEY = 'admin_jwt';

type SetupStatus = { needs_bootstrap: boolean };
type TokenResponse = { access_token: string; token_type: string };
type AdminList = { admins: { id: number; email: string }[] };
type RegisterRes = { created: { email: string; password: string }[] };

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'bootstrap' | 'register' | 'login' | 'dashboard'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [bootstrapToken, setBootstrapToken] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [code, setCode] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerEmails, setRegisterEmails] = useState('');
  const [credentials, setCredentials] = useState<{ email: string; password: string }[] | null>(null);

  const loadDashboard = useCallback(async (t: string) => {
    await api<AdminList>('/admin/admins', { token: t });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await api<SetupStatus>('/admin/setup-status');
        if (cancelled) return;
        if (st.needs_bootstrap) {
          await api('/admin/bootstrap/request-code', { method: 'POST' });
          setPhase('bootstrap');
          return;
        }
        const stored = localStorage.getItem(TOKEN_KEY);
        if (stored) {
          try {
            await loadDashboard(stored);
            setToken(stored);
            setPhase('dashboard');
          } catch {
            localStorage.removeItem(TOKEN_KEY);
            setToken(null);
            setPhase('login');
          }
        } else {
          setPhase('login');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        setPhase('login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  const onVerifyBootstrap = async () => {
    setError(null);
    try {
      const res = await api<TokenResponse>('/admin/bootstrap/verify', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      setBootstrapToken(res.access_token);
      setPhase('register');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRegisterFirst = async () => {
    if (!bootstrapToken) return;
    setError(null);
    const emails = registerEmails
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!emails.length) {
      setError('Enter at least one email.');
      return;
    }
    try {
      const res = await api<RegisterRes>('/admin/admins/register', {
        method: 'POST',
        token: bootstrapToken,
        body: JSON.stringify({ emails }),
      });
      setCredentials(res.created);
      setBootstrapToken(null);
      localStorage.removeItem(TOKEN_KEY);
      setPhase('login');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onLogin = async () => {
    setError(null);
    try {
      const res = await api<TokenResponse>('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      localStorage.setItem(TOKEN_KEY, res.access_token);
      setToken(res.access_token);
      await loadDashboard(res.access_token);
      setPhase('dashboard');
      setLoginPassword('');
      setCredentials(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setPhase('login');
    setCredentials(null);
  };

  if (phase === 'loading') {
    return (
      <div className="shell shell-auth">
        <p className="muted">Loading…</p>
        {error && <p className="err">{error}</p>}
      </div>
    );
  }

  if (phase === 'dashboard' && token) {
    return (
      <div className="app-root">
        {credentials && credentials.length > 0 && (
          <div className="credentials-strip">
            <div className="credentials-inner">
              <strong>Save new passwords now</strong>
              <ul>
                {credentials.map((c) => (
                  <li key={c.email}>
                    {c.email} — <code>{c.password}</code>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn ghost sm" onClick={() => setCredentials(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}
        <Dashboard token={token} onLogout={onLogout} onCredentials={setCredentials} />
      </div>
    );
  }

  return (
    <div className="shell shell-auth">
      {!['bootstrap', 'register', 'login'].includes(phase) ? null : (
        <header className="header-auth">
          <h1>Big Skill — Admin</h1>
        </header>
      )}

      {error && <p className="err">{error}</p>}

      {phase === 'bootstrap' && (
        <section className="card">
          <h2>First-time setup</h2>
          <p className="muted">
            A one-time code was printed in the <strong>Python server terminal</strong>. Enter it below,
            then register admin emails.
          </p>
          <label className="label">Bootstrap code</label>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code from server console"
            autoComplete="off"
          />
          <button type="button" className="btn primary" onClick={onVerifyBootstrap}>
            Continue
          </button>
        </section>
      )}

      {phase === 'register' && (
        <section className="card">
          <h2>Register administrators</h2>
          <p className="muted">
            One row or comma-separated emails. Each receives a random password (shown once after save).
          </p>
          <textarea
            className="textarea"
            rows={5}
            value={registerEmails}
            onChange={(e) => setRegisterEmails(e.target.value)}
            placeholder="admin1@company.com, admin2@company.com"
          />
          <button type="button" className="btn primary" onClick={onRegisterFirst}>
            Create admins
          </button>
        </section>
      )}

      {phase === 'login' && (
        <section className="card">
          <h2>Administrator login</h2>
          {credentials && credentials.length > 0 && (
            <div className="banner">
              <div className="banner-head">
                <span>
                  <strong>Save these passwords now</strong> (shown once):
                </span>
                <button type="button" className="btn ghost sm" onClick={() => setCredentials(null)}>
                  Dismiss
                </button>
              </div>
              <ul>
                {credentials.map((c) => (
                  <li key={c.email}>
                    {c.email} — <code>{c.password}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            autoComplete="username"
          />
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button type="button" className="btn primary" onClick={onLogin}>
            Log in
          </button>
        </section>
      )}
    </div>
  );
}

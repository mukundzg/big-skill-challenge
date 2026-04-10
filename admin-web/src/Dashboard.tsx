import { useState } from 'react';
import { AdminsPanel } from './panels/AdminsPanel';
import { AnalyticsPanel } from './panels/AnalyticsPanel';
import { ContentAnalysisPanel } from './panels/ContentAnalysisPanel';
import { OverviewPanel } from './panels/OverviewPanel';
import { QuizSettingsPanel } from './panels/QuizSettingsPanel';
import { SubjectsPanel } from './panels/SubjectsPanel';

export type NavId = 'overview' | 'quiz-settings' | 'analytics' | 'content-analysis' | 'subjects' | 'admins';

const NAV: { id: NavId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'quiz-settings', label: 'Quiz settings' },
  { id: 'analytics', label: 'Score analytics' },
  { id: 'content-analysis', label: 'Content analysis' },
  { id: 'subjects', label: 'Subjects' },
  { id: 'admins', label: 'Administrators' },
];

export function Dashboard({
  token,
  onLogout,
  onCredentials,
}: {
  token: string;
  onLogout: () => void;
  onCredentials: (c: { email: string; password: string }[] | null) => void;
}) {
  const [nav, setNav] = useState<NavId>('overview');

  return (
    <div className="dash-layout">
      <aside className="dash-sidebar">
        <div className="brand">
          <span className="brand-mark">B</span>
          <div>
            <div className="brand-title">Big Skill</div>
            <div className="brand-sub">Admin</div>
          </div>
        </div>
        <nav className="dash-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`dash-nav-item ${nav === item.id ? 'active' : ''}`}
              onClick={() => setNav(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="dash-sidebar-footer">
          <button type="button" className="btn outline full" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>
      <div className="dash-content">
        <header className="dash-header">
          <h2>{NAV.find((n) => n.id === nav)?.label}</h2>
          <p className="muted header-sub">
            {nav === 'overview' && 'Snapshot of quiz usage and outcomes.'}
            {nav === 'quiz-settings' && 'Edit global quiz rules stored in quiz_settings.'}
            {nav === 'analytics' && 'Browse score analytics (from scores table): per-dimension values and weighted score.'}
            {nav === 'content-analysis' && 'Analyze AI scoring across relevance, creativity, clarity, and impact with reasoning insights.'}
            {nav === 'subjects' && 'Manage content subjects (add / soft delete / active flag).'}
            {nav === 'admins' && 'Invite or disable admin accounts.'}
          </p>
        </header>
        <div className="dash-body">
          {nav === 'overview' && <OverviewPanel token={token} />}
          {nav === 'quiz-settings' && <QuizSettingsPanel token={token} />}
          {nav === 'analytics' && <AnalyticsPanel token={token} />}
          {nav === 'content-analysis' && <ContentAnalysisPanel token={token} />}
          {nav === 'subjects' && <SubjectsPanel token={token} />}
          {nav === 'admins' && <AdminsPanel token={token} onCredentials={onCredentials} />}
        </div>
      </div>
    </div>
  );
}

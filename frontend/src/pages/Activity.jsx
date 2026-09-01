import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useDateRange } from '../DateRangeContext.jsx';

/** How the raw action names read on screen. */
const ACTION_LABEL = {
  created: 'Uploaded sheet',
  edited: 'Edited sheet',
  verified: 'Verified sheet',
  deleted: 'Deleted sheet',
  'user-approved': 'Approved account',
  'user-blocked': 'Blocked account',
  'user-role-changed': 'Changed role',
  'receipt-added': 'Recorded payment',
  'receipt-deleted': 'Removed payment',
  'split-comment': 'Profit split comment',
  'expense-added': 'Added expense',
  'expense-edited': 'Edited expense',
  'expense-deleted': 'Deleted expense',
  'backup-created': 'Took a backup',
  'signed-in': 'Signed in',
};

const AREA_LABEL = {
  users: 'Admin — Users',
  split: 'Profit Split',
  sheets: 'Daily Sheets',
  expenses: 'Expenses',
  system: 'System',
  other: 'Other',
};

// SQLite's datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS" with no timezone marker —
// without an explicit "Z", Date() would parse it as local time and skew the diff.
function relativeTime(sqliteUtc) {
  const diffMs = Date.now() - new Date(`${sqliteUtc.replace(' ', 'T')}Z`).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const exactTime = (sqliteUtc) => new Date(`${sqliteUtc.replace(' ', 'T')}Z`).toLocaleString();

function Entry({ a }) {
  return (
    <li className={a.sensitive ? 'sensitive' : undefined}>
      <div className="activity-head">
        <strong>{ACTION_LABEL[a.action] || a.action}</strong>
        <span className={`badge ${a.sensitive ? 'high' : 'owing'}`}>{AREA_LABEL[a.area] || a.area}</span>
        {a.sheet_id && a.action !== 'deleted' ? (
          <Link to={`/sheets/${a.sheet_id}`}>{a.sheet_date}</Link>
        ) : a.sheet_date ? <span className="muted">{a.sheet_date}</span> : null}
      </div>
      {a.detail && <div className="activity-detail">{a.detail}</div>}
      <div className="muted activity-meta">
        {a.actor_name || a.actor_email || 'someone'}
        {a.actor_name && a.actor_email ? ` · ${a.actor_email}` : ''}
        {' · '}<span title={exactTime(a.created_at)}>{relativeTime(a.created_at)}</span>
      </div>
    </li>
  );
}

function BackupsSection() {
  const [backups, setBackups] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api.backups().then(setBackups).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const backUpNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createBackup();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const latest = backups?.[0];

  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Database backups</strong>
        <button className="secondary row-action" onClick={backUpNow} disabled={busy}>
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
      </div>
      {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        {!backups
          ? 'Loading…'
          : latest
            ? <>Runs nightly, keeping the last 14. Latest: {new Date(latest.created_at).toLocaleString()} ({Math.round(latest.size / 1024)} KB).</>
            : 'No snapshots yet — the first one is written shortly after the server starts.'}
      </p>
      {backups && backups.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {backups.slice(0, 3).map((b) => (
            <a key={b.name} className="btn secondary row-action" href={api.backupUrl(b.name)} download>
              {b.created_at.slice(0, 10)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const SENSITIVE_SHOWN = 8;

export default function Activity() {
  const [log, setLog] = useState(null);
  const [error, setError] = useState(null);
  const [areaFilter, setAreaFilter] = useState('all');
  const { from, to, label } = useDateRange();

  useEffect(() => {
    api.auditLog(500).then(setLog).catch((e) => setError(e.message));
  }, []);

  if (error) return <><h1 className="page-title">Activity</h1><div className="error-box">{error}</div></>;
  if (!log) return <><h1 className="page-title">Activity</h1><p className="muted"><span className="spinner" />Loading…</p></>;

  const sensitive = log.filter((a) => a.sensitive);
  const shown = areaFilter === 'all' ? log : log.filter((a) => a.area === areaFilter);
  const areas = [...new Set(log.map((a) => a.area))];

  return (
    <>
      <h1 className="page-title">Activity</h1>
      <div className="page-sub">
        Everything done on the site, newest first. Changes to <strong>Admin — Users</strong> and{' '}
        <strong>Profit Split</strong> are highlighted, since one governs who has access and the
        other moves money.
      </div>

      {sensitive.length > 0 && (
        <div className="panel panel-alert">
          <h2>
            Needs attention
            <span className="panel-count">{sensitive.length} access &amp; money changes</span>
          </h2>
          {/* Pinned separately rather than sorted to the top of the timeline: an audit trail
              that isn't chronological can't be read as a sequence of events. The same entries
              appear in order below, marked the same way. */}
          <ul className="activity-list">
            {sensitive.slice(0, SENSITIVE_SHOWN).map((a) => <Entry key={a.id} a={a} />)}
          </ul>
          {sensitive.length > SENSITIVE_SHOWN && (
            <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
              {sensitive.length - SENSITIVE_SHOWN} more below.
            </p>
          )}
        </div>
      )}

      <div className="panel">
        <h2>
          All activity
          <span className="panel-count">{shown.length} of {log.length}</span>
        </h2>
        <div className="activity-filters">
          <button className={areaFilter === 'all' ? '' : 'secondary'} onClick={() => setAreaFilter('all')}>
            All
          </button>
          {areas.map((a) => (
            <button key={a} className={areaFilter === a ? '' : 'secondary'} onClick={() => setAreaFilter(a)}>
              {AREA_LABEL[a] || a}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="muted">Nothing recorded in this area yet.</p>
        ) : (
          <ul className="activity-list activity-full">
            {shown.map((a) => <Entry key={a.id} a={a} />)}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2>Export</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Downloads data for the current range ({label}) as CSV.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn secondary" href={api.exportUrl('sheets', from, to)} download>Sheets CSV</a>
          <a className="btn secondary" href={api.exportUrl('expenses', from, to)} download>Expenses CSV</a>
          <a className="btn secondary" href={api.exportUrl('profit-split')} download>Profit Split CSV</a>
        </div>
        <BackupsSection />
      </div>
    </>
  );
}

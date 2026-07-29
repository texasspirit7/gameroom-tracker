import { useEffect, useState } from 'react';
import { api, fmt, signedMoney } from '../api.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

export default function ProfitSplit() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);
  const [notesDraft, setNotesDraft] = useState({}); // month -> in-progress textarea value

  const load = () => api.profitSplit().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const togglePaid = async (row) => {
    setSaving(row.month);
    setError(null);
    try {
      await api.setProfitSplitPaid(row.month, !row.paid);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  const saveNotes = async (row) => {
    const draft = notesDraft[row.month];
    if (draft === undefined || draft === row.notes) return;
    try {
      await api.setProfitSplitNotes(row.month, draft);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (error && !rows) return <div className="error-box">{error}</div>;
  if (!rows) return <p className="muted"><span className="spinner" />Loading…</p>;

  // Rows come newest-first, so the first one carries the running recoup total.
  const latest = rows[0];
  const recoupTarget = latest?.recoup_target ?? 0;

  return (
    <>
      <h1 className="page-title">Profit Split</h1>
      <div className="page-sub">
        Monthly net profit (after overhead). The 40% side takes every month in full until
        ${fmt(recoupTarget)} has been recovered; from there it splits 40/60.
      </div>
      {error && <div className="error-box">{error}</div>}

      {latest && (
        <div className="panel">
          <h2>
            Recoup progress
            <span className="panel-count">
              {latest.recoup_remaining > 0
                ? `$${fmt(latest.recoup_remaining)} still to recover`
                : 'fully recovered — now splitting 40/60'}
            </span>
          </h2>
          <div className="recoup-bar">
            <i style={{ width: `${Math.min(100, (latest.recovered_to_date / recoupTarget) * 100)}%` }} />
          </div>
          <div className="recoup-cap">
            <span><strong>${fmt(latest.recovered_to_date)}</strong> recovered</span>
            <span>${fmt(recoupTarget)} target</span>
          </div>
        </div>
      )}

      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted">No months on record yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Net Profit</th>
                <th title="Taken in full by the 40% side until the target is recovered">To Recoup</th>
                <th title="What's left after the recoup — this is what gets split 40/60">Split Base</th>
                <th>40% Amount</th><th>60% Amount</th><th>Paid</th><th>Comments</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>
                    {monthLabel(r.month)}
                    {r.recoup_amount > 0 && <span className="badge review" style={{ marginLeft: 8 }}>recoup</span>}
                  </td>
                  <td className={r.net_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(r.net_profit)}</td>
                  <td>{r.recoup_amount ? `$${fmt(r.recoup_amount)}` : '—'}</td>
                  <td>{r.split_base ? `$${fmt(r.split_base)}` : '—'}</td>
                  <td>${fmt(r.amount_40)}</td>
                  <td>${fmt(r.amount_60)}</td>
                  <td>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={r.paid}
                        disabled={saving === r.month}
                        onClick={() => togglePaid(r)}
                        onChange={() => {}}
                      />
                      {r.paid ? <span className="badge verified">Paid</span> : <span className="badge review">Unpaid</span>}
                    </label>
                    {r.paid && r.paid_at && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {new Date(r.paid_at).toLocaleDateString()}{r.paid_by ? ` · ${r.paid_by}` : ''}
                      </div>
                    )}
                  </td>
                  <td>
                    <textarea
                      rows={2}
                      style={{ width: 180, resize: 'vertical', font: 'inherit', fontSize: 12 }}
                      placeholder="Add a comment…"
                      value={notesDraft[r.month] ?? r.notes}
                      onChange={(e) => setNotesDraft((prev) => ({ ...prev, [r.month]: e.target.value }))}
                      onBlur={() => saveNotes(r)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

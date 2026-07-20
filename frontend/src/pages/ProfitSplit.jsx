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

  return (
    <>
      <h1 className="page-title">Profit Split</h1>
      <div className="page-sub">
        Monthly net profit (after overhead) split 40/60, and whether that month's payout has been made.
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted">No months on record yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Month</th><th>Split</th><th>Net Profit</th>
                <th>40% Amount</th><th>60% Amount</th><th>Paid</th><th>Comments</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  <td>{r.split_label}</td>
                  <td className={r.net_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(r.net_profit)}</td>
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

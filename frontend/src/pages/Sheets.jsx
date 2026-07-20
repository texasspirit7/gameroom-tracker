import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, signedMoney } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** Groups sheets by calendar month with summed totals, most recent month first. */
function groupByMonth(sheets) {
  const map = new Map();
  for (const s of sheets) {
    const key = s.sheet_date.slice(0, 7);
    if (!map.has(key)) {
      map.set(key, {
        key, label: monthLabel(key), sheets: [],
        total_in: 0, total_out: 0, match_amount: 0, expenses: 0, meter_profit: 0, net_profit: 0, warnings: 0,
      });
    }
    const g = map.get(key);
    g.sheets.push(s);
    g.total_in += s.total_in || 0;
    g.total_out += s.total_out || 0;
    g.match_amount += s.match_amount || 0;
    g.expenses += s.expenses || 0;
    g.meter_profit += s.meter_profit || 0;
    g.net_profit += s.net_profit || 0;
    g.warnings += s.warnings || 0;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

export default function Sheets() {
  const { isAdmin, authEnabled } = useAuth();
  const canModify = !authEnabled || isAdmin;
  const [sheets, setSheets] = useState(null);
  const [error, setError] = useState(null);
  const [expandedMonth, setExpandedMonth] = useState(null);
  const navigate = useNavigate();

  const load = () => api.sheets().then(setSheets).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const remove = async (e, sheet) => {
    e.stopPropagation();
    if (!window.confirm(`Delete sheet ${sheet.sheet_date}? This cannot be undone.`)) return;
    await api.deleteSheet(sheet.id);
    load();
  };

  const months = useMemo(() => (sheets ? groupByMonth(sheets) : []), [sheets]);

  if (error) return <div className="error-box">{error}</div>;
  if (!sheets) return <p className="muted"><span className="spinner" />Loading…</p>;

  return (
    <>
      <h1 className="page-title">Daily Sheets</h1>
      <div className="page-sub">{sheets.length} sheet{sheets.length === 1 ? '' : 's'} on record</div>

      <div className="panel">
        {months.length === 0 ? (
          <p className="muted">Nothing uploaded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Month</th><th>Sheets</th><th>Total In</th><th>Total Out</th>
                <th>Match</th><th>Expenses</th><th>Meter Profit</th><th>Net Profit (After Overhead)</th>
                <th>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {months.map((g) => (
                <Fragment key={g.key}>
                  <tr className="clickable" onClick={() => setExpandedMonth(expandedMonth === g.key ? null : g.key)}>
                    <td><strong>{expandedMonth === g.key ? '▾' : '▸'} {g.label}</strong></td>
                    <td>{g.sheets.length}</td>
                    <td>${fmt(g.total_in)}</td>
                    <td>${fmt(g.total_out)}</td>
                    <td>${fmt(g.match_amount)}</td>
                    <td>${fmt(g.expenses)}</td>
                    <td className={g.meter_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(g.meter_profit)}</td>
                    <td className={g.net_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(g.net_profit)}</td>
                    <td>{g.warnings > 0 ? <span className="badge review">{g.warnings}</span> : '—'}</td>
                  </tr>
                  {expandedMonth === g.key && (
                    <tr>
                      <td colSpan={9} style={{ background: '#f7f9fd' }}>
                        <table style={{ margin: '8px 0' }}>
                          <thead>
                            <tr>
                              <th>Date</th><th>Day</th><th></th><th>Source</th><th>Total In</th><th>Total Out</th>
                              <th>Match</th><th>Expenses</th><th>Meter Profit</th><th>Net Profit (After Overhead)</th>
                              <th>Warnings</th><th>Status</th>
                              {canModify && <th></th>}
                            </tr>
                          </thead>
                          <tbody>
                            {g.sheets.map((s) => (
                              <tr key={s.id} className="clickable" onClick={() => navigate(`/sheets/${s.id}`)}>
                                <td>{s.sheet_date}</td>
                                <td>{weekday(s.sheet_date)}</td>
                                <td>
                                  {s.has_file && (
                                    <a
                                      href={`/api/sheets/${s.id}/file`}
                                      title="Download uploaded sheet"
                                      className="attachment-link"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      📎
                                    </a>
                                  )}
                                </td>
                                <td>{s.source}</td>
                                <td>${fmt(s.total_in)}</td>
                                <td>${fmt(s.total_out)}</td>
                                <td>${fmt(s.match_amount)}</td>
                                <td>${fmt(s.expenses)}</td>
                                <td className={s.meter_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(s.meter_profit)}</td>
                                <td className={s.net_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(s.net_profit)}</td>
                                <td>{s.warnings > 0 ? <span className="badge review">{s.warnings}</span> : '—'}</td>
                                <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                                {canModify && (
                                  <td>
                                    <button className="danger row-action" onClick={(e) => remove(e, s)}>Delete</button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

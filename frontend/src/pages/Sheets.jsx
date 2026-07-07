import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, signedMoney } from '../api.js';

export default function Sheets() {
  const [sheets, setSheets] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.sheets().then(setSheets).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!sheets) return <p className="muted"><span className="spinner" />Loading…</p>;

  return (
    <>
      <h1 className="page-title">Daily Sheets</h1>
      <div className="page-sub">{sheets.length} sheet{sheets.length === 1 ? '' : 's'} on record</div>

      <div className="panel">
        {sheets.length === 0 ? (
          <p className="muted">Nothing uploaded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Source</th><th>Total In</th><th>Total Out</th>
                <th>Meter P/L</th><th>Cash P/L</th><th>Over/Short</th><th>Warnings</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => navigate(`/sheets/${s.id}`)}>
                  <td>{s.sheet_date}</td>
                  <td>{s.source}</td>
                  <td>${fmt(s.total_in)}</td>
                  <td>${fmt(s.total_out)}</td>
                  <td className={s.meter_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(s.meter_profit)}</td>
                  <td className={s.cash_profit == null ? '' : s.cash_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(s.cash_profit)}</td>
                  <td className={s.over_short == null ? '' : s.over_short >= 0 ? 'pos' : 'neg'}>{signedMoney(s.over_short)}</td>
                  <td>{s.warnings > 0 ? <span className="badge review">{s.warnings}</span> : '—'}</td>
                  <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

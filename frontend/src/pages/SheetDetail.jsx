import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, fmt, signedMoney } from '../api.js';

export default function SheetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [edits, setEdits] = useState({});      // machine_number -> partial row
  const [fields, setFields] = useState({});    // sheet-level field edits

  const load = () => api.sheet(id).then((s) => { setSheet(s); setEdits({}); setFields({}); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  if (error) return <div className="error-box">{error}</div>;
  if (!sheet) return <p className="muted"><span className="spinner" />Loading…</p>;

  const dirty = Object.keys(edits).length > 0 || Object.keys(fields).length > 0;

  const editCell = (n, key, value) => {
    setSaved(false);
    setEdits((prev) => ({ ...prev, [n]: { ...prev[n], [key]: value } }));
  };

  const rowValue = (m, key) => edits[m.machine_number]?.[key] ?? m[key];
  const fieldValue = (key) => fields[key] ?? sheet[key] ?? '';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const machines = Object.entries(edits).map(([n, patch]) => {
        const base = sheet.machines.find((m) => m.machine_number === Number(n));
        return { ...base, ...patch, machine_number: Number(n) };
      });
      const body = { ...fields };
      for (const k of ['total_in', 'total_out', 'match_amount', 'loan_rtn', 'start_bank', 'end_bank', 'cash_profit']) {
        if (body[k] !== undefined) body[k] = body[k] === '' ? null : Number(body[k]);
      }
      if (machines.length) body.machines = machines;
      await api.patchSheet(id, body);
      await load();
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    await api.verifySheet(id);
    load();
  };

  const remove = async () => {
    if (!window.confirm(`Delete sheet ${sheet.sheet_date}? This cannot be undone.`)) return;
    await api.deleteSheet(id);
    navigate('/sheets');
  };

  return (
    <>
      <h1 className="page-title">Sheet — {sheet.sheet_date}</h1>
      <div className="page-sub">
        Source: {sheet.source} · <span className={`badge ${sheet.status}`}>{sheet.status}</span>
      </div>

      {sheet.warnings.length > 0 && (
        <div className="warning-box">
          <strong>⚠ {sheet.warnings.length} validation warning{sheet.warnings.length === 1 ? '' : 's'}</strong>
          <ul>{sheet.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {saved && <div className="ok-box">Saved — totals and validations recomputed.</div>}

      <div className="toolbar">
        <button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        {sheet.status !== 'verified' && (
          <button className="secondary" onClick={verify} disabled={dirty}>Mark verified</button>
        )}
        <div className="spacer" />
        <button className="danger" onClick={remove}>Delete sheet</button>
      </div>

      <div className="panel">
        <h2>Summary</h2>
        <div className="form-row">
          {[
            ['total_in', 'Total In'], ['total_out', 'Total Out'], ['match_amount', 'Match'],
            ['loan_rtn', 'Loan RTN'], ['start_bank', 'Start Bank'], ['end_bank', 'End Bank'],
            ['cash_profit', 'Cash Profit'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number" style={{ width: 110 }} value={fieldValue(key)}
                onChange={(e) => { setSaved(false); setFields((p) => ({ ...p, [key]: e.target.value })); }}
              />
            </label>
          ))}
        </div>
        <p style={{ fontSize: 14 }}>
          Meter profit: <strong className={sheet.meter_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(sheet.meter_profit)}</strong>
          {' · '}Over/Short: <strong className={sheet.over_short == null ? '' : sheet.over_short >= 0 ? 'pos' : 'neg'}>{signedMoney(sheet.over_short)}</strong>
          {' · '}Expenses: {sheet.expenses.map((e) => `${e.category} $${fmt(e.amount)}`).join(', ') || 'none'}
        </p>
      </div>

      <div className="panel">
        <h2>Machine readings ({sheet.machines.length})</h2>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Prev In</th><th>Curr In</th><th>Daily In</th>
              <th>Prev Out</th><th>Curr Out</th><th>Daily Out</th><th>Net</th>
            </tr>
          </thead>
          <tbody>
            {sheet.machines.map((m) => {
              const net = Number(rowValue(m, 'daily_in')) - Number(rowValue(m, 'daily_out'));
              return (
                <tr key={m.machine_number}>
                  <td><strong>{m.machine_number}</strong></td>
                  {['prev_in', 'curr_in', 'daily_in', 'prev_out', 'curr_out', 'daily_out'].map((key) => (
                    <td key={key}>
                      <input
                        className="cell" type="number" value={rowValue(m, key)}
                        onChange={(e) => editCell(m.machine_number, key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className={net >= 0 ? 'pos' : 'neg'}>{signedMoney(net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmt } from '../api.js';
import { todayISO } from '../dateRange.js';
import { useDateRange } from '../DateRangeContext.jsx';
import { useAuth } from '../AuthContext.jsx';

const CATEGORY_SUGGESTIONS = ['Rent', 'Electricity', 'Water', 'Internet', 'Insurance', 'Repairs & Maintenance', 'Supplies', 'Other'];

export default function Expenses() {
  const { from, to, label, preset } = useDateRange();
  const { isAdmin, authEnabled } = useAuth();
  const canModify = !authEnabled || isAdmin;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ expense_date: todayISO(), category: '', amount: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = () => {
    const params = preset === 'allTime' ? '' : `?from=${from}&to=${to}`;
    api.expenses(params).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [from, to, preset]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await api.addExpense({ ...form, amount: Number(form.amount) });
      setForm({ expense_date: todayISO(), category: '', amount: '', note: '' });
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    await api.deleteExpense(id);
    load();
  };

  if (error) return <div className="error-box">{error}</div>;

  // Category breakdown for a quick summary above the full list
  const byCategory = data
    ? Object.entries(
        data.expenses.reduce((acc, e) => {
          acc[e.category] = (acc[e.category] || 0) + e.amount;
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <>
      <h1 className="page-title">Expenses</h1>
      <div className="page-sub">
        Every expense in one place — pay, food, and supplies pulled automatically from daily sheets,
        plus recurring overhead (rent, electricity, etc.) you log here yourself.
      </div>

      <div className="panel">
        <h2>Log an expense</h2>
        <form className="form-row" onSubmit={submit}>
          <label>
            Date
            <input type="date" value={form.expense_date} onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))} required />
          </label>
          <label>
            Category
            <input
              list="expense-categories" value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Rent" required style={{ width: 160 }}
            />
            <datalist id="expense-categories">
              {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label>
            Amount
            <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required style={{ width: 110 }} />
          </label>
          <label>
            Note (optional)
            <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. June rent" style={{ width: 200 }} />
          </label>
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add expense'}</button>
        </form>
        {formError && <div className="error-box">{formError}</div>}
      </div>

      {byCategory.length > 0 && (
        <div className="panel">
          <h2>By category — {label}</h2>
          <table>
            <thead><tr><th>Category</th><th>Amount</th></tr></thead>
            <tbody>
              {byCategory.map(([category, amount]) => (
                <tr key={category}><td>{category}</td><td>${fmt(amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h2>{label} — {data ? `$${fmt(data.total)} total` : '…'}</h2>
        {!data ? (
          <p className="muted"><span className="spinner" />Loading…</p>
        ) : data.expenses.length === 0 ? (
          <p className="muted">No expenses in this range.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Date</th><th>Category</th><th>Amount</th><th>Note</th><th>Source</th>{canModify && <th></th>}</tr>
            </thead>
            <tbody>
              {data.expenses.map((e) => (
                <tr key={`${e.source}-${e.id}`}>
                  <td>{e.date}</td>
                  <td>{e.category}</td>
                  <td>${fmt(e.amount)}</td>
                  <td>{e.note || '—'}</td>
                  <td>
                    {e.source === 'sheet'
                      ? <Link to={`/sheets/${e.sheet_id}`}>sheet #{e.sheet_id}</Link>
                      : (e.created_by || 'logged manually')}
                  </td>
                  {canModify && (
                    <td>
                      {e.source === 'other'
                        ? <button className="danger row-action" onClick={() => remove(e.id)}>Delete</button>
                        : <span className="muted" style={{ fontSize: 12 }}>edit on sheet</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

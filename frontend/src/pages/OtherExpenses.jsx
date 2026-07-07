import { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import { todayISO } from '../dateRange.js';
import { useDateRange } from '../DateRangeContext.jsx';
import { useAuth } from '../AuthContext.jsx';

const CATEGORY_SUGGESTIONS = ['Rent', 'Electricity', 'Water', 'Internet', 'Insurance', 'Repairs & Maintenance', 'Supplies', 'Other'];

export default function OtherExpenses() {
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
    api.otherExpenses(params).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [from, to, preset]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await api.addOtherExpense({ ...form, amount: Number(form.amount) });
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
    await api.deleteOtherExpense(id);
    load();
  };

  if (error) return <div className="error-box">{error}</div>;

  return (
    <>
      <h1 className="page-title">Other Expenses</h1>
      <div className="page-sub">Recurring overhead — rent, electricity, water, etc. — kept separate from daily sheet reconciliation.</div>

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

      <div className="panel">
        <h2>{label} — {data ? `$${fmt(data.total)} total` : '…'}</h2>
        {!data ? (
          <p className="muted"><span className="spinner" />Loading…</p>
        ) : data.expenses.length === 0 ? (
          <p className="muted">No expenses logged in this range.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Date</th><th>Category</th><th>Amount</th><th>Note</th><th>Logged by</th>{canModify && <th></th>}</tr>
            </thead>
            <tbody>
              {data.expenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.expense_date}</td>
                  <td>{e.category}</td>
                  <td>${fmt(e.amount)}</td>
                  <td>{e.note || '—'}</td>
                  <td>{e.created_by || '—'}</td>
                  {canModify && (
                    <td><button className="danger row-action" onClick={() => remove(e.id)}>Delete</button></td>
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

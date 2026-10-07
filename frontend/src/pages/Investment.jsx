import { useEffect, useState } from 'react';
import { api, fmt, signedMoney } from '../api.js';
import { todayISO } from '../dateRange.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

const emptyForm = () => ({ released_on: todayISO(), amount: '', budget_id: '', note: '' });
const emptyLine = () => ({ item: '', qty: '', price_each: '', amount: '' });

export default function Investment() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(emptyLine());
  const [addingLine, setAddingLine] = useState(false);

  const load = () => api.investment().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.releaseFunds({
        released_on: form.released_on,
        amount: Number(form.amount),
        budget_id: form.budget_id || null,
        note: form.note,
      });
      setForm(emptyForm());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d) => {
    if (!window.confirm(`Delete the $${fmt(d.amount)} released on ${d.released_on}?`)) return;
    setError(null);
    try {
      await api.deleteRelease(d.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const addLine = async (e) => {
    e.preventDefault();
    setAddingLine(true);
    setError(null);
    try {
      await api.addBudgetLine({
        item: line.item,
        qty: line.qty || null,
        price_each: line.price_each || null,
        amount: line.amount || null,
      });
      setLine(emptyLine());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingLine(false);
    }
  };

  const removeLine = async (b) => {
    if (!window.confirm(`Remove "${b.item}" from the budget?`)) return;
    setError(null);
    try {
      await api.deleteBudgetLine(b.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (error && !data) return <><h1 className="page-title">Investment</h1><div className="error-box">{error}</div></>;
  if (!data) return <><h1 className="page-title">Investment</h1><p className="muted"><span className="spinner" />Loading…</p></>;

  const { budget, disbursements, summary } = data;
  const pct = summary.released > 0 ? `${summary.recovered_pct}%` : '0%';

  return (
    <>
      <h1 className="page-title">Investment</h1>
      <div className="page-sub">
        Setup costs for this location: what was quoted, what has actually been released, and how
        much has come back. Recovery is your share of weekly profit as it accrues — the same
        figure the Profit Split page shows, not a second one kept by hand.
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="account-cards">
        <div className="account-card">
          <span className="account-label">Released</span>
          <span className="account-fig">${fmt(summary.released)}</span>
          <span className="muted">of ${fmt(summary.quoted)} quoted</span>
        </div>
        <div className="account-card">
          <span className="account-label">Recovered</span>
          <span className="account-fig pos">${fmt(summary.recovered)}</span>
          <span className="muted">{summary.recovered_pct}% of what went out</span>
        </div>
        <div className="account-card accent">
          <span className="account-label">Still to recover</span>
          <span className={`account-fig ${summary.outstanding > 0 ? 'neg' : 'pos'}`}>
            ${fmt(summary.outstanding)}
          </span>
          <span className="muted">
            {summary.fully_recovered ? 'fully recovered' : `$${fmt(summary.remaining_to_release)} left to release`}
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>
          Recovery
          <span className="panel-count">
            {summary.released > 0
              ? `$${fmt(summary.recovered)} of $${fmt(summary.released)} released`
              : 'nothing released yet'}
          </span>
        </h2>
        <div className="recoup-bar"><i style={{ width: pct }} /></div>
        <p className="muted recoup-note">
          {/* Measured against what actually went out, not the quote — you get back what you
              put in, not what you planned to. */}
          Measured against money actually released, not the ${fmt(summary.quoted)} estimate.
        </p>
      </div>

      <div className="panel">
        <h2>Release funds<span className="panel-count">{disbursements.length} recorded</span></h2>
        <form className="receipt-form" onSubmit={submit}>
          <label>Released on
            <input type="date" required value={form.released_on}
              onChange={(e) => setForm((f) => ({ ...f, released_on: e.target.value }))} />
          </label>
          <label>Amount
            <input type="number" step="0.01" min="0.01" required placeholder="0.00" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </label>
          <label>Against
            <select value={form.budget_id}
              onChange={(e) => setForm((f) => ({ ...f, budget_id: e.target.value }))}>
              <option value="">— not itemised —</option>
              {budget.map((b) => <option key={b.id} value={b.id}>{b.line_no}. {b.item}</option>)}
            </select>
          </label>
          <label className="grow">Note
            <input type="text" placeholder="e.g. deposit paid to supplier" value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </label>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Record'}</button>
        </form>

        {disbursements.length === 0 ? (
          <p className="muted" style={{ marginTop: 16 }}>Nothing released yet.</p>
        ) : (
          <table className="receipt-table wide">
            <thead>
              <tr><th>Date</th><th>Amount</th><th>Against</th><th>Note</th><th /></tr>
            </thead>
            <tbody>
              {disbursements.map((d) => (
                <tr key={d.id}>
                  <td>{dayLabel(d.released_on)}</td>
                  <td><b>${fmt(d.amount)}</b></td>
                  <td className="muted">{d.budget_item ? `${d.budget_line}. ${d.budget_item}` : '—'}</td>
                  <td className="muted">{d.note || '—'}</td>
                  <td><button className="danger row-action" onClick={() => remove(d)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>
          Budget
          <span className="panel-count">
            quoted ${fmt(summary.quoted)}
            {summary.unassigned > 0 && ` · $${fmt(summary.unassigned)} released without a line`}
          </span>
        </h2>
        <table className="split-table">
          <thead>
            <tr>
              <th>#</th><th>Item</th><th>Qty</th><th>Each</th>
              <th>Quoted</th><th>Released</th><th title="Released minus quoted">Variance</th><th />
            </tr>
          </thead>
          <tbody>
            {budget.map((b) => (
              <tr key={b.id}>
                <td className="muted">{b.line_no}</td>
                <td>{b.item}</td>
                <td className="muted">{b.qty ?? '—'}</td>
                <td className="muted">{b.price_each ? `$${fmt(b.price_each)}` : '—'}</td>
                <td>${fmt(b.amount)}</td>
                <td>{b.released ? `$${fmt(b.released)}` : '—'}</td>
                {/* Over the quote is the thing worth noticing, so only that is coloured. */}
                <td className={b.variance > 0 ? 'neg' : undefined}>
                  {b.released ? signedMoney(b.variance) : '—'}
                </td>
                <td>
                  {/* Only a line with nothing booked against it can go — the server refuses
                      the rest, and offering a button that fails would be worse. */}
                  {b.released
                    ? <span className="muted" title="Money has been released against this line">locked</span>
                    : <button className="danger row-action" onClick={() => removeLine(b)}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form className="receipt-form" style={{ marginTop: 18 }} onSubmit={addLine}>
          <label className="grow">Add an item
            <input type="text" required placeholder="e.g. extra bill validator" value={line.item}
              onChange={(e) => setLine((l) => ({ ...l, item: e.target.value }))} />
          </label>
          <label>Qty
            <input type="number" step="1" min="0" placeholder="—" value={line.qty}
              onChange={(e) => setLine((l) => ({ ...l, qty: e.target.value }))} />
          </label>
          <label>Each
            <input type="number" step="0.01" min="0" placeholder="—" value={line.price_each}
              onChange={(e) => setLine((l) => ({ ...l, price_each: e.target.value }))} />
          </label>
          <label title="Worked out from quantity × price when both are given">Amount
            <input type="number" step="0.01" min="0" placeholder="0.00"
              value={line.qty && line.price_each ? Number(line.qty) * Number(line.price_each) : line.amount}
              disabled={Boolean(line.qty && line.price_each)}
              onChange={(e) => setLine((l) => ({ ...l, amount: e.target.value }))} />
          </label>
          <button className="btn" disabled={addingLine}>{addingLine ? 'Adding…' : 'Add'}</button>
        </form>
      </div>
    </>
  );
}

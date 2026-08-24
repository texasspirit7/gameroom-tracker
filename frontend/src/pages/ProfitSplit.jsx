import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, fmt, signedMoney } from '../api.js';
import { todayISO } from '../dateRange.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

/** "Aug 24 – Aug 30, 2026", collapsing the year when both ends share it. */
const weekLabel = (from, to) => {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const left = `${MONTHS[fm - 1]} ${fd}`;
  const right = `${MONTHS[tm - 1]} ${td}`;
  return fy === ty ? `${left} – ${right}, ${ty}` : `${left}, ${fy} – ${right}, ${ty}`;
};

const periodLabel = (r) =>
  r.closed ? `Everything through ${dayLabel(r.period_end)}` : weekLabel(r.period_start, r.period_end);

const COVERAGE = {
  covered: { cls: 'verified', label: 'Covered' },
  partial: { cls: 'review', label: 'Partial' },
  open: { cls: 'owing', label: 'Open' },
  none: { cls: 'owing', label: '—' },
};

/** Payments visible before the ledger starts scrolling. */
const LEDGER_VISIBLE = 5;

/** Seeded rows (the close-out) are settled history — the API refuses to delete them, so the
 *  page must not offer a button that can only fail. */
const isSeeded = (rc) => String(rc.created_by || '').startsWith('system:');

const emptyForm = () => ({ received_on: todayISO(), amount: '', expense_credit: '', note: '' });

export default function ProfitSplit() {
  const [data, setData] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState({});
  const scrollRef = useRef(null);
  const [ledgerMaxH, setLedgerMaxH] = useState(null);

  const load = async () => {
    const [split, receipts] = await Promise.all([api.profitSplit(), api.profitReceipts()]);
    setData(split);
    setLedger(receipts);
  };
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  /**
   * Cap the ledger at LEDGER_VISIBLE rows and let the rest scroll.
   *
   * Measured rather than assumed a fixed row height, since a long note wraps to two lines.
   * `data` is a dependency as well as `ledger`: the table only exists once the page has
   * rendered past its loading state, so keying on the ledger alone would measure nothing on
   * the first load and leave the list uncapped.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const table = el?.querySelector('table');
    const rows = table?.tBodies?.[0]?.rows;
    if (!el || !rows || rows.length <= LEDGER_VISIBLE) { setLedgerMaxH(null); return undefined; }

    // Measured against the container's own box rather than offsetTop, which is relative to
    // whichever ancestor happens to be positioned.
    const measure = () => {
      const last = rows[LEDGER_VISIBLE - 1];
      setLedgerMaxH(Math.round(
        last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop,
      ));
    };
    measure();

    // Row heights are not final on the first pass: they settle after the next paint, again
    // once the web font swaps in, and again whenever a long note rewraps at a new width.
    // Each of those is a separate moment, so re-measure at all of them rather than trusting
    // one reading — an early measurement is too tall and silently shows six rows.
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    window.addEventListener('resize', measure);
    let live = true;
    document.fonts?.ready.then(() => { if (live) measure(); });

    return () => {
      live = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ledger, data]);

  const submitReceipt = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addProfitReceipt({
        received_on: form.received_on,
        amount: Number(form.amount) || 0,
        expense_credit: Number(form.expense_credit) || 0,
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

  const removeReceipt = async (rc) => {
    const total = fmt(rc.amount + rc.expense_credit);
    if (!window.confirm(`Delete the $${total} receipt from ${rc.received_on}? The balance will go back up.`)) return;
    setError(null);
    try {
      await api.deleteProfitReceipt(rc.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveNotes = async (row) => {
    const draft = notesDraft[row.period];
    if (draft === undefined || draft === row.notes) return;
    try {
      await api.setProfitSplitNotes(row.period, draft);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (error && !data) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted"><span className="spinner" />Loading…</p>;

  const { rows, account } = data;
  const earningWeeks = rows.filter((r) => !r.closed && r.amount_40 > 0).length;
  const owedPct = account.owed_total
    ? `${Math.min(100, (account.received_total / account.owed_total) * 100)}%`
    : '0%';

  return (
    <>
      <h1 className="page-title">Profit Split</h1>
      <div className="page-sub">
        Weekly net profit (after overhead), split 40/60, with each week running Monday through
        Sunday. Every week adds to what you’re owed — payments draw down the running balance.
        Everything up to {dayLabel(account.close_out_date)} was settled separately and is closed.
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="account-cards">
        <div className="account-card">
          <span className="account-label">Owed to date</span>
          <span className="account-fig">${fmt(account.owed_total)}</span>
          <span className="muted">
            {earningWeeks === 0 ? 'closed period only'
              : `closed period + ${earningWeeks} ${earningWeeks === 1 ? 'week' : 'weeks'}`}
          </span>
        </div>
        <div className="account-card">
          <span className="account-label">Received</span>
          <span className="account-fig pos">${fmt(account.received_total)}</span>
          <span className="muted">{ledger.length} payment{ledger.length === 1 ? '' : 's'}</span>
        </div>
        <div className="account-card accent">
          <span className="account-label">Balance owed</span>
          <span className={`account-fig ${account.balance > 0 ? 'neg' : 'pos'}`}>
            ${fmt(Math.abs(account.balance))}{account.balance < 0 ? ' over' : ''}
          </span>
          <span className="muted">
            {account.paid_through === 'closed' ? 'closed period settled'
              : account.paid_through ? `paid up through ${dayLabel(account.paid_through)}`
              : 'nothing covered yet'}
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>
          Balance
          <span className="panel-count">
            ${fmt(account.received_total)} of ${fmt(account.owed_total)} collected
          </span>
        </h2>
        <div className="recoup-bar"><i style={{ width: owedPct }} /></div>
        <p className="muted recoup-note">
          Weeks run Monday to Sunday, splitting 40/60. The first began
          {' '}{dayLabel(account.first_week_start)}.
        </p>
      </div>

      <div className="panel">
        <h2>Payments received<span className="panel-count">{ledger.length}</span></h2>

        <form className="receipt-form" onSubmit={submitReceipt}>
          <label>Received on
            <input type="date" required value={form.received_on}
              onChange={(e) => setForm((f) => ({ ...f, received_on: e.target.value }))} />
          </label>
          <label>Cash
            <input type="number" step="0.01" min="0" placeholder="0.00" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </label>
          <label title="Value received as expenses rather than cash — draws down the balance the same way">
            Expenses
            <input type="number" step="0.01" min="0" placeholder="0.00" value={form.expense_credit}
              onChange={(e) => setForm((f) => ({ ...f, expense_credit: e.target.value }))} />
          </label>
          <label className="grow">Note
            <input type="text" placeholder="e.g. Zelle from owner" value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </label>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Record'}</button>
        </form>

        {ledger.length === 0 ? (
          <p className="muted" style={{ marginTop: 16 }}>No payments recorded yet.</p>
        ) : (
          <div
            className="ledger-scroll"
            ref={scrollRef}
            style={ledgerMaxH ? { maxHeight: ledgerMaxH } : undefined}
          >
          <table className="receipt-table wide">
            <thead>
              <tr><th>Date</th><th>Cash</th><th>Expenses</th><th>Total</th><th>Note</th><th /></tr>
            </thead>
            <tbody>
              {ledger.map((rc) => (
                <tr key={rc.id}>
                  <td>{rc.received_on}</td>
                  <td>{rc.amount ? `$${fmt(rc.amount)}` : '—'}</td>
                  <td>{rc.expense_credit ? `$${fmt(rc.expense_credit)}` : '—'}</td>
                  <td><b>${fmt(rc.amount + rc.expense_credit)}</b></td>
                  <td className="muted">{rc.note || '—'}</td>
                  <td>
                    {isSeeded(rc)
                      ? <span className="muted" title="Settled history — cannot be removed">locked</span>
                      : <button className="danger row-action" onClick={() => removeReceipt(rc)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {ledger.length > LEDGER_VISIBLE && (
          <p className="muted ledger-hint">
            Showing {LEDGER_VISIBLE} of {ledger.length} — scroll for older payments.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>By week<span className="panel-count">Monday to Sunday</span></h2>
        {rows.length === 0 ? (
          <p className="muted">Nothing on record yet.</p>
        ) : (
          <table className="split-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Net Profit</th>
                <th title="What this week added to what you're owed">Owed (40%)</th>
                <th>60% Side</th>
                <th title="Cumulative amount owed">Running Total</th>
                <th title="Payments fill the oldest periods first">Coverage</th>
                <th>Comments</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cv = COVERAGE[r.coverage];
                return (
                  <tr key={r.period} className={r.closed ? 'closed-period' : undefined}>
                    <td>
                      {periodLabel(r)}
                      {r.closed && <span className="badge verified" style={{ marginLeft: 8 }}>closed</span>}
                    </td>
                    {/* The closed period is a settled lump sum, not a computed week — it has no
                        net profit or 60% side to show. */}
                    <td className={r.closed ? 'muted' : (r.net_profit >= 0 ? 'pos' : 'neg')}>
                      {r.closed ? '—' : signedMoney(r.net_profit)}
                    </td>
                    <td>${fmt(r.amount_40)}</td>
                    <td className="muted">{r.closed ? '—' : `$${fmt(r.amount_60)}`}</td>
                    <td className="muted">${fmt(r.owed_running)}</td>
                    <td>
                      <span className={`badge ${cv.cls}`}>{cv.label}</span>
                      {r.coverage === 'partial' && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          ${fmt(r.applied)} of ${fmt(r.amount_40)}
                        </div>
                      )}
                    </td>
                    <td>
                      <textarea
                        rows={2} className="split-notes-cell" placeholder="Add a comment…"
                        value={notesDraft[r.period] ?? r.notes}
                        onChange={(e) => setNotesDraft((prev) => ({ ...prev, [r.period]: e.target.value }))}
                        onBlur={() => saveNotes(r)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

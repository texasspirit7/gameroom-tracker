import { fmt, signedMoney } from '../api.js';

// The word a cabinet wears on its plate — read before any number.
const STATE_LABEL = { profit: 'Holding', bleeding: 'Bleeding', negative: 'Negative', dead: 'No play' };

/**
 * Where a machine sits on a bleeding → holding range, as a 0–100% track position.
 * Break-even (0% hold) sits dead centre; anything at or past −100% pins to the far left, so a
 * wild figure like −1650% still renders somewhere sensible instead of blowing out the track.
 */
export const gaugePos = (holdPct) => Math.min(100, Math.max(0, (holdPct + 100) / 2));

/** One machine as a cabinet: brass number plate, its figures, and a hold gauge. */
export default function CabinetCard({ machine: m, onOpen }) {
  const noReadings = m.hold_pct == null;
  return (
    <div
      className="cab"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(m.machine_number)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(m.machine_number); }
      }}
    >
      <div className="cab-plate">
        <span className="cab-no">#{m.machine_number}</span>
        <span className={`cab-state ${m.flag || 'dead'}`}>{STATE_LABEL[m.flag] || 'Even'}</span>
      </div>
      <div className="cab-body">
        <div className="cab-fig"><span>In</span><span>${fmt(m.total_in)}</span></div>
        <div className="cab-fig"><span>Out</span><span>${fmt(m.total_out)}</span></div>
        <div className="cab-fig">
          <span>Net</span>
          <span className={m.net >= 0 ? 'pos' : 'neg'}>{signedMoney(m.net)}</span>
        </div>
        <div className="gauge">
          <div className={`gauge-track${noReadings ? ' empty' : ''}`}>
            <i
              className={`gauge-pin${noReadings ? ' empty' : ''}`}
              style={{ '--at': `${noReadings ? 50 : gaugePos(m.hold_pct)}%` }}
            />
          </div>
          <div className="gauge-cap">
            <span>Hold</span>
            <b>{noReadings ? '—' : `${m.hold_pct}%`}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

import { fmt, signedMoney } from '../api.js';

// The word a cabinet wears on its plate — read before any number.
const STATE_LABEL = { profit: 'Holding', bleeding: 'Bleeding', negative: 'Negative', dead: 'No play' };

/**
 * Where a machine sits on a bleeding → holding range, as a 0–100% track position.
 * Break-even (0% hold) sits dead centre; anything at or past −100% pins to the far left, so a
 * wild figure like −1650% still renders somewhere sensible instead of blowing out the track.
 */
export const gaugePos = (holdPct) => Math.min(100, Math.max(0, (holdPct + 100) / 2));

// Matches --good / --bad / --muted in App.css. Kept as RGB triples so the strength of the
// tint can be varied per machine, which a flat token can't express.
const RGB = { win: '70,217,138', loss: '255,107,107', none: '116,137,127' };

/** The best and worst net in a set — the scale every card in that set is shaded against. */
export function netBounds(machines) {
  const nets = machines.filter((m) => m.hold_pct != null).map((m) => m.net);
  return { maxNet: Math.max(0, ...nets), minNet: Math.min(0, ...nets) };
}

/**
 * How strongly to tint a cabinet, and in which direction.
 *
 * Earners shade green in proportion to the best machine in the current range, so the top
 * performer is the most saturated and the shading fades toward neutral as profit approaches
 * break-even. Machines paying out more than they take shade red on the same relative scale,
 * and machines with no play at all stay grey rather than reading as "barely break-even" —
 * no play is a different condition from earning nothing.
 *
 * Scaling is relative rather than absolute so the range filter can't wash the whole grid out:
 * one day's takings and a year's would otherwise land at wildly different intensities.
 */
export function machineTint(m, { maxNet = 0, minNet = 0 } = {}) {
  if (m.hold_pct == null || m.flag === 'dead') return { rgb: RGB.none, strength: 0 };
  if (m.net > 0) return { rgb: RGB.win, strength: maxNet > 0 ? m.net / maxNet : 1 };
  if (m.net < 0) return { rgb: RGB.loss, strength: minNet < 0 ? m.net / minNet : 1 };
  return { rgb: RGB.none, strength: 0 };
}

/** One machine as a cabinet: brass number plate, its figures, and a hold gauge. */
export default function CabinetCard({ machine: m, onOpen, bounds }) {
  const noReadings = m.hold_pct == null;
  const { rgb, strength } = machineTint(m, bounds);
  // Floor the alpha so a small but real profit still reads as green rather than vanishing.
  const edgeAlpha = strength > 0 ? 0.3 + 0.7 * strength : 0.3;
  const washAlpha = strength > 0 ? 0.03 + 0.11 * strength : 0;

  return (
    <div
      className="cab"
      role="button"
      tabIndex={0}
      style={{
        '--tint': `rgba(${rgb}, ${edgeAlpha.toFixed(3)})`,
        '--tint-wash': `rgba(${rgb}, ${washAlpha.toFixed(3)})`,
      }}
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

const ICONS = [
  { icon: '🎰', top: '4%', left: '86%', size: 150, rotate: -12 },
  { icon: '🎲', top: '38%', left: '3%', size: 120, rotate: 18 },
  { icon: '♠️', top: '78%', left: '82%', size: 130, rotate: 8 },
  { icon: '🃏', top: '14%', left: '46%', size: 110, rotate: -6 },
  { icon: '💰', top: '88%', left: '18%', size: 120, rotate: 10 },
  { icon: '♦️', top: '58%', left: '92%', size: 90, rotate: -20 },
  { icon: '🎲', top: '92%', left: '55%', size: 100, rotate: 25 },
];

/** Faint, fixed-position casino iconography behind the page content. */
export default function CasinoBackdrop() {
  return (
    <div className="casino-backdrop" aria-hidden="true">
      {ICONS.map((it, i) => (
        <span
          key={i}
          className="backdrop-icon"
          style={{ top: it.top, left: it.left, fontSize: it.size, transform: `rotate(${it.rotate}deg)` }}
        >
          {it.icon}
        </span>
      ))}
    </div>
  );
}

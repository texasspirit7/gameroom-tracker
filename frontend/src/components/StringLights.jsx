const COLORS = ['#ff4d4d', '#ffd23b', '#4dd6ff', '#4dff88', '#ff4dd2', '#ff9f4d'];

export default function StringLights({ count = 60 }) {
  return (
    <div className="string-lights" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="light-bulb"
          style={{
            '--bulb-color': COLORS[i % COLORS.length],
            animationDelay: `${(i % 10) * 0.15}s`,
          }}
        />
      ))}
    </div>
  );
}

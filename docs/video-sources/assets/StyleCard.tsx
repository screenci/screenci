// A full .tsx page overlay: a speaking-style caption card, parameterized by a
// `text` prop. screenci bundles this and renders it client-side, passing the
// props from the overlay config. Different cards are the same component with
// different props (no duplicated markup).
export default function StyleCard({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 6,
        boxSizing: 'border-box',
        padding: '18px 28px',
        borderRadius: 18,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        color: '#ffffff',
        background:
          'linear-gradient(135deg, #6366f1 0%, #8b5cf6 55%, #ec4899 100%)',
        border: '1px solid rgba(255, 255, 255, 0.28)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.35)',
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          opacity: 0.85,
        }}
      >
        Speaking style
      </span>
      <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.01em' }}>
        {text}
      </span>
    </div>
  )
}

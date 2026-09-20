// A full .tsx page overlay: a speaking-style caption card, parameterized by a
// `text` prop. screenci bundles this and renders it client-side, passing the
// props from the overlay config. Different cards are the same component with
// different props (no duplicated markup). Colours come from the shared theme,
// never from the component.
import { theme } from './theme'

export default function StyleCard({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 6,
        boxSizing: 'border-box',
        padding: '18px 28px',
        borderRadius: theme.radius + 6,
        fontFamily: theme.fontFamily,
        color: theme.text,
        background: theme.surface,
        borderLeft: `6px solid ${theme.accent}`,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: theme.muted,
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

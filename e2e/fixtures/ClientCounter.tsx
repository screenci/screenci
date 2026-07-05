import React, { useState, useEffect } from 'react'

// Fixture for the client-rendered overlay e2e test: a normal React component with
// a hook and an effect. When bundled and mounted in the overlay page under the
// capture clock, the effect's requestAnimationFrame animates the value, proving
// hooks/effects run during capture.
export default function ClientCounter({ to = 100 }: { to?: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const start = Date.now()
    let raf = 0
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / 500)
      setN(Math.round(t * to))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [to])
  return (
    <div
      id="counter"
      data-n={n}
      style={{
        width: 200,
        height: 80,
        color: '#fff',
        background: '#111',
        font: '700 40px system-ui',
      }}
    >
      {n}
    </div>
  )
}

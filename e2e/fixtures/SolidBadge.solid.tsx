import { createSignal, onMount } from 'solid-js'

// Fixture for the Solid overlay e2e test: a Solid component with a signal set
// in onMount, proving Solid's runtime (not a static render) runs in the
// overlay page. The <style> tag pins a deterministic 200x80 box.
export default function SolidBadge(props: { label?: string }) {
  const [mounted, setMounted] = createSignal(false)
  onMount(() => setMounted(true))
  return (
    <div id="solid-badge" data-mounted={mounted() ? 'yes' : 'no'}>
      <style>
        {
          '#solid-badge{width:200px;height:80px;background:#181818;color:#fff;font:700 40px system-ui}'
        }
      </style>
      {props.label ?? 'Solid'}
    </div>
  )
}

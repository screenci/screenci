<script>
  // Fixture for the Svelte overlay e2e test: a Svelte 5 component with runes
  // props and a scoped style block. The extracted CSS pins a deterministic
  // 200x80 box, proving component styles are inlined into the host document.
  let { label = 'Svelte' } = $props()
</script>

<div class="svelte-badge">{label}</div>

<style>
  .svelte-badge {
    width: 200px;
    height: 80px;
    background: #401010;
    color: #fff;
    font: 700 40px system-ui;
  }
</style>

<script setup>
// Fixture for the Vue overlay e2e test: a single-file component with props and
// a style block. The extracted CSS pins a deterministic 200x80 box, proving
// SFC styles are inlined into the overlay host document.
defineProps({ label: { type: String, default: 'Vue' } })
</script>

<template>
  <div class="vue-badge">{{ label }}</div>
</template>

<style>
.vue-badge {
  width: 200px;
  height: 80px;
  background: #101040;
  color: #fff;
  font: 700 40px system-ui;
}
</style>

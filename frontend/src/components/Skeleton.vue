<template>
  <div :class="['skeleton', variant]" :style="{ width, height }" />
</template>

<script setup lang="ts">
defineProps<{
  width?: string
  height?: string
  variant?: 'text' | 'card' | 'circle'
}>()
</script>

<style scoped>
.skeleton {
  background: linear-gradient(
    90deg,
    var(--surface-2) 25%,
    var(--border) 50%,
    var(--surface-2) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: var(--radius);
}

.skeleton.text   { height: 14px; border-radius: 4px; }
.skeleton.card   { height: 80px; border-radius: var(--radius-xl); }
.skeleton.circle { border-radius: 50%; }

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>

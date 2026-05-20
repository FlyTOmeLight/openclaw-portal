<template>
  <div :class="['card', { 'skill-disabled': !skill.enabled }]" style="padding: var(--space-4);">
    <div class="skill-name">{{ skill.name }}</div>
    <span v-if="skill.agent" class="badge badge-accent" style="margin: 5px 0 8px; display:inline-flex;">{{ skill.agent }}</span>
    <p class="skill-desc">{{ skill.description }}</p>
    <div style="margin-top: auto; padding-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;">
      <button v-if="skill.enabled && skill.agent" @click="$emit('disable', skill.name, skill.agent)" class="btn btn-sm">禁用</button>
      <button v-if="!skill.enabled && skill.agent" @click="$emit('enable', skill.name, skill.agent)" class="btn btn-sm btn-primary">启用</button>
      <button @click="$emit('check-deps', skill)" class="btn btn-sm" title="检查这个技能的依赖完整度">依赖</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ skill: any }>()
defineEmits<{
  disable: [name: string, agent: string]
  enable: [name: string, agent: string]
  'check-deps': [skill: any]
}>()
</script>

<style scoped>
.skill-disabled { opacity: .5; }
.skill-name { font-weight: 600; font-size: var(--text-sm); margin-bottom: 2px; color: var(--text-primary); }
.skill-desc { font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.45; }
</style>

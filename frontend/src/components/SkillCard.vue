<template>
  <div :class="['skill-card', { disabled: !skill.enabled }]">
    <div class="skill-name">{{ skill.name }}</div>
    <div class="skill-agent" v-if="skill.agent">{{ skill.agent }}</div>
    <div class="skill-desc">{{ skill.description }}</div>
    <div class="skill-actions">
      <button v-if="skill.enabled && skill.agent" @click="$emit('disable', skill.name, skill.agent)" class="btn sm">禁用</button>
      <button v-if="!skill.enabled && skill.agent" @click="$emit('enable', skill.name, skill.agent)" class="btn sm primary">启用</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ skill: any }>()
defineEmits<{ disable: [name: string, agent: string]; enable: [name: string, agent: string] }>()
</script>

<style scoped>
.skill-card { background: white; border-radius: 8px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.skill-card.disabled { opacity: .5; }
.skill-name { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
.skill-agent { font-size: 11px; background: #ede9fe; color: #5b21b6; padding: 1px 6px; border-radius: 8px; display: inline-block; margin-bottom: 6px; }
.skill-desc { font-size: 12px; color: #6b7280; margin-bottom: 10px; line-height: 1.4; }
.btn { padding: 4px 10px; border-radius: 5px; border: 1px solid #d1d5db; cursor: pointer; font-size: 12px; background: white; }
.btn.primary { background: #2563eb; color: white; border-color: #2563eb; }
</style>

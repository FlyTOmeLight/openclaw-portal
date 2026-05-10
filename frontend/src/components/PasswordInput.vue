<template>
  <div class="pw-input-wrap">
    <input
      class="form-input"
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button
      type="button"
      class="eye-btn"
      tabindex="-1"
      :aria-label="visible ? '隐藏密码' : '显示密码'"
      @click="visible = !visible"
    >
      <svg v-if="!visible" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
        <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
        <path d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  modelValue: string
  placeholder?: string
  autocomplete?: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const visible = ref(false)
</script>

<style scoped>
.pw-input-wrap {
  position: relative;
  width: 100%;
}
.pw-input-wrap .form-input {
  width: 100%;
  padding-right: 42px;
  box-sizing: border-box;
}
.eye-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-muted, #a8a29e);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 160ms ease;
}
.eye-btn:hover {
  color: var(--text-secondary, #57534e);
}
</style>

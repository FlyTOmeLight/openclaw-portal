<template>
  <Transition name="confirm-fade">
    <div
      v-if="show"
      class="ui-modal-overlay"
      @click.self="emit('cancel')"
      @keydown.esc="emit('cancel')"
    >
      <div class="ui-modal ui-modal-sm confirm-modal" role="alertdialog" aria-modal="true">
        <div class="confirm-body">
          <div :class="['confirm-icon', danger ? 'danger' : 'normal']">
            {{ danger ? '⚠' : '?' }}
          </div>
          <div class="confirm-copy">
            <div class="confirm-title">{{ title }}</div>
            <p v-if="message" class="confirm-message">{{ message }}</p>
          </div>
        </div>
        <div class="confirm-footer">
          <button class="confirm-btn confirm-btn-cancel" @click="emit('cancel')">
            {{ cancelText }}
          </button>
          <button
            ref="confirmBtnEl"
            :class="['confirm-btn', danger ? 'confirm-btn-danger' : 'confirm-btn-primary']"
            @click="emit('confirm')"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  show: boolean
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>(), {
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const confirmBtnEl = ref<HTMLButtonElement>()

// Focus the confirm button on open so Enter / Esc work without a mouse.
watch(() => props.show, (open) => {
  if (open) nextTick(() => confirmBtnEl.value?.focus())
})
</script>

<style scoped>
.confirm-modal {
  width: min(100%, 420px);
}

.confirm-body {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-5) var(--space-4);
}

.confirm-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
}
.confirm-icon.normal {
  background: var(--tint-strong, rgba(99, 102, 241, 0.12));
  color: var(--accent);
}
.confirm-icon.danger {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.confirm-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding-top: 2px;
}

.confirm-title {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.35;
}

.confirm-message {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
  word-break: break-word;
  white-space: pre-wrap;
}

.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5) var(--space-5);
}

.confirm-btn {
  padding: 7px 18px;
  border-radius: var(--radius);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background var(--duration-fast), border-color var(--duration-fast), transform var(--duration-fast);
}
.confirm-btn:active { transform: translateY(1px); }

.confirm-btn-cancel {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text-secondary);
}
.confirm-btn-cancel:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.confirm-btn-primary {
  background: var(--accent);
  color: #fff;
}
.confirm-btn-primary:hover { filter: brightness(1.08); }

.confirm-btn-danger {
  background: #ef4444;
  color: #fff;
}
.confirm-btn-danger:hover { background: #dc2626; }

/* enter / leave */
.confirm-fade-enter-active,
.confirm-fade-leave-active { transition: opacity var(--duration-fast); }
.confirm-fade-enter-from,
.confirm-fade-leave-to { opacity: 0; }
.confirm-fade-enter-active .confirm-modal,
.confirm-fade-leave-active .confirm-modal { transition: transform var(--duration-fast); }
.confirm-fade-enter-from .confirm-modal { transform: scale(0.96); }
</style>

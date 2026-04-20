import { defineStore } from 'pinia'
import { createDiscreteApi } from 'naive-ui'

// Discrete API works outside component context (stores, composables, etc.)
const { message } = createDiscreteApi(['message'])

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration: number
}

export const useToastStore = defineStore('toast', () => {
  // Keep the toasts array for backward compat (nothing renders it anymore)
  const toasts: Toast[] = []

  function show(msg: string, type: ToastType = 'info', duration = 4000) {
    switch (type) {
      case 'success': message.success(msg, { duration }); break
      case 'error':   message.error(msg, { duration }); break
      case 'warning': message.warning(msg, { duration }); break
      default:        message.info(msg, { duration }); break
    }
  }

  function dismiss(_id: string) { /* no-op — Naive UI manages its own lifecycle */ }

  const success = (msg: string) => show(msg, 'success', 4000)
  const error   = (msg: string) => show(msg, 'error', 6000)
  const info    = (msg: string) => show(msg, 'info', 4000)
  const warning = (msg: string) => show(msg, 'warning', 4000)

  return { toasts, show, dismiss, success, error, info, warning }
})

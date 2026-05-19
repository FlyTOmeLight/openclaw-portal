/**
 * useConfirm — Promise-based confirmation dialog, drop-in for window.confirm().
 *
 * A single shared dialog instance is rendered by <ConfirmDialogHost> (mounted
 * once in App.vue). Callers just `await confirm({ ... })` and branch on the
 * boolean — no per-view modal state, no logic restructuring.
 */
import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmState extends Required<ConfirmOptions> {
  show: boolean
}

export const confirmState = reactive<ConfirmState>({
  show: false,
  title: '',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
})

let pendingResolve: ((v: boolean) => void) | null = null

/** Open the confirmation dialog; resolves true on confirm, false on cancel. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  // A new request supersedes any still-open one (treat the old as cancelled).
  if (pendingResolve) {
    pendingResolve(false)
    pendingResolve = null
  }
  confirmState.title = opts.title
  confirmState.message = opts.message ?? ''
  confirmState.confirmText = opts.confirmText ?? '确定'
  confirmState.cancelText = opts.cancelText ?? '取消'
  confirmState.danger = opts.danger ?? false
  confirmState.show = true
  return new Promise<boolean>((resolve) => { pendingResolve = resolve })
}

/** Called by <ConfirmDialogHost> when the user picks an option. */
export function settleConfirm(value: boolean): void {
  if (!confirmState.show) return
  confirmState.show = false
  const resolve = pendingResolve
  pendingResolve = null
  resolve?.(value)
}

export function useConfirm() {
  return confirm
}

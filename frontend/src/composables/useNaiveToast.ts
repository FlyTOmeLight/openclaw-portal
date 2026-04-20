/**
 * Wraps Naive UI's useMessage() so all views can call toast.success/error/info/warning
 * with the same API as the old useToastStore, without touching store logic.
 */
import { useMessage } from 'naive-ui'

export function useNaiveToast() {
  const message = useMessage()
  return {
    success: (msg: string) => message.success(msg, { duration: 4000 }),
    error: (msg: string) => message.error(msg, { duration: 6000 }),
    info: (msg: string) => message.info(msg, { duration: 4000 }),
    warning: (msg: string) => message.warning(msg, { duration: 4000 }),
  }
}

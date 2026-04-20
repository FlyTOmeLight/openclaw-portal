import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'portal.theme'

function detectInitial(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {}
  return 'light'
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(detectInitial())

  function apply(next: ThemeMode) {
    const body = document.body
    body.classList.remove('theme-light', 'theme-dark')
    body.classList.add(`theme-${next}`)
    body.dataset.theme = next
  }

  function set(next: ThemeMode) {
    mode.value = next
  }
  function toggle() {
    mode.value = mode.value === 'dark' ? 'light' : 'dark'
  }

  watch(mode, v => {
    apply(v)
    try { localStorage.setItem(STORAGE_KEY, v) } catch {}
  }, { immediate: true })

  return { mode, set, toggle }
})

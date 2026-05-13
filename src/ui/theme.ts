export const Theme = {
  _current: null as string | null,

  get(): string {
    if (this._current) return this._current
    const s = localStorage.getItem('mineai-hub:theme')
    if (s === 'light' || s === 'dark') return s
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  },

  set(t: string): void {
    this._current = t
    localStorage.setItem('mineai-hub:theme', t)
    document.documentElement.setAttribute('data-theme', t)
  },

  toggle(): void {
    this.set(this.get() === 'dark' ? 'light' : 'dark')
    window.electronAPI.notifyThemeChange(this.get())
  },

  apply(): void {
    this.set(this.get())
  },

  listenSystemTheme(): void {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
      if (!localStorage.getItem('mineai-hub:theme')) this.set(e.matches ? 'light' : 'dark')
    })
  }
}

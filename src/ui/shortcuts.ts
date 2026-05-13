import { toast } from './toast'

const shortcutDisplayMap: Record<string, string> = {
  Meta: 'Cmd',
  Control: 'Ctrl',
  Alt: 'Opt',
  Shift: 'Shift'
}

function shortcutDisplay(keys: string[]): string {
  return keys.map(k => shortcutDisplayMap[k] || k).join('+')
}

export function setupShortcutRecording(
  inputId: string,
  getKeys: () => string[],
  setKeys: (v: string[]) => void,
  onSave: (acc: string) => Promise<{ ok: boolean; error?: string }>,
  onRefresh: () => Promise<string>,
  successMsg: string
): void {
  const input = document.getElementById(inputId) as HTMLElement
  if (!input) return
  let keys: string[] = []

  input.addEventListener('click', () => {
    input.classList.add('recording')
    input.textContent = '请按键…'
    keys = []
    setKeys([])
  })

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    e.preventDefault()
    if (!input.classList.contains('recording')) return
    keys = []
    if (e.metaKey) keys.push('Meta')
    if (e.ctrlKey) keys.push('Control')
    if (e.altKey) keys.push('Alt')
    if (e.shiftKey) keys.push('Shift')
    const modCodes = ['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight']
    if (!modCodes.includes(e.code)) {
      keys.push(e.code.startsWith('Key') ? e.code.slice(3) : e.code)
    }
    input.textContent = shortcutDisplay(keys)
    setKeys(keys)
  })

  input.addEventListener('keyup', async () => {
    input.classList.remove('recording')
    if (keys.length > 1) {
      const acc = keys.join('+')
      const result = await onSave(acc)
      if (result.ok) {
        input.textContent = shortcutDisplay(keys)
        toast(successMsg)
      } else {
        toast(result.error || '快捷键设置失败')
        const s = await onRefresh()
        input.textContent = s || '未设置'
      }
    } else {
      const s = await onRefresh()
      input.textContent = s || '未设置'
    }
  })
}

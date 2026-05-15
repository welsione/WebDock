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
  let recording = false

  const cancelRecording = async () => {
    if (!recording) return
    recording = false
    input.classList.remove('recording')
    const s = await onRefresh()
    input.textContent = s || '未设置'
  }

  input.addEventListener('click', () => {
    recording = true
    input.classList.add('recording')
    input.textContent = '请按键…'
    keys = []
    setKeys([])
  })

  // 失去焦点时取消录制
  input.addEventListener('blur', cancelRecording)

  // 按 Escape 取消录制
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!recording) return
    if (e.code === 'Escape') {
      e.preventDefault()
      cancelRecording()
      return
    }
    e.preventDefault()
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
    if (!recording) return
    recording = false
    input.classList.remove('recording')
    // 需要至少一个修饰键和一个普通键
    const hasModifier = keys.some(k => ['Meta', 'Control', 'Alt', 'Shift'].includes(k))
    const hasKey = keys.some(k => !['Meta', 'Control', 'Alt', 'Shift'].includes(k))
    if (hasModifier && hasKey) {
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
      // 单按修饰键或普通键，视为取消
      const s = await onRefresh()
      input.textContent = s || '未设置'
    }
  })
}

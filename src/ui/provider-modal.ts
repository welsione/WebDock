// ===== 添加/编辑自定义服务商弹窗 =====
// 绑定 index.html 中 #addProviderModal 的静态结构（id 以 modal* 命名）。
// 旧版 provider-modal.ts 因 DOM id 与 HTML 全面脱节被删除，本文件按实际 id 重建。

import { addCustomProvider, updateCustomProvider } from '../state'
import { renderProviderList, saveProviderOrderFromDOM } from '../providers/manager'
import { toast } from './toast'
import { byIdOrNull } from '../utils/dom'
import { MAX_ICON_UPLOAD_BYTES } from '../utils/constants'

export interface ProviderModalEditTarget {
  key: string
  name: string
  url: string
  icon: string | null
  color: { dark: string; light: string }
}

interface ModalElements {
  overlay: HTMLElement
  title: HTMLElement
  name: HTMLInputElement
  url: HTMLInputElement
  iconUrl: HTMLInputElement
  iconPreview: HTMLElement
  iconFileInput: HTMLInputElement
  colorDark: HTMLInputElement
  colorDarkHex: HTMLElement
  colorLight: HTMLInputElement
  colorLightHex: HTMLElement
  saveBtn: HTMLButtonElement
}

let els: ModalElements | null = null
let currentEditKey: string | null = null // null = 新增模式
let pendingIcon: string | null = null // 本次编辑选中的图标 data URL

function collectElements(): ModalElements | null {
  const overlay = byIdOrNull<HTMLElement>('addProviderModal')
  const name = byIdOrNull<HTMLInputElement>('modalName')
  const url = byIdOrNull<HTMLInputElement>('modalUrl')
  if (!overlay || !name || !url) return null
  return {
    overlay,
    title: byIdOrNull<HTMLElement>('modalTitle')!,
    name,
    url,
    iconUrl: byIdOrNull<HTMLInputElement>('modalIconUrl')!,
    iconPreview: byIdOrNull<HTMLElement>('iconPreview')!,
    iconFileInput: byIdOrNull<HTMLInputElement>('iconFileInput')!,
    colorDark: byIdOrNull<HTMLInputElement>('modalColorDark')!,
    colorDarkHex: byIdOrNull<HTMLElement>('modalColorDarkHex')!,
    colorLight: byIdOrNull<HTMLInputElement>('modalColorLight')!,
    colorLightHex: byIdOrNull<HTMLElement>('modalColorLightHex')!,
    saveBtn: byIdOrNull<HTMLButtonElement>('modalSave')!
  }
}

/** URL 校验：必须 http/https（任意主机，含 localhost/127.0.0.1——本地 AI 服务是核心场景） */
export function validateProviderUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return '请输入网址'
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return '网址格式不正确'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '仅支持 http/https 协议'
  }
  if (!parsed.hostname) return '网址格式不正确'
  return null
}

/** 校验图标上传：大小限制 + 仅图片 */
export function validateIconFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return '仅支持图片文件'
  if (file.size > MAX_ICON_UPLOAD_BYTES) return '图片不能超过 256KB'
  return null
}

function setPreview(icon: string | null): void {
  if (!els) return
  if (icon) {
    els.iconPreview.innerHTML = `<img src="${icon.replace(/"/g, '&quot;')}" alt="图标预览">`
    els.iconPreview.title = '点击更换图片'
  } else {
    els.iconPreview.innerHTML = '?'
    els.iconPreview.title = '点击上传图片'
  }
  pendingIcon = icon
}

function openModal(): void {
  if (!els) return
  els.overlay.classList.add('visible')
}

function closeModal(): void {
  if (!els) return
  els.overlay.classList.remove('visible')
  currentEditKey = null
  pendingIcon = null
}

/** 打开弹窗：edit 有值 = 编辑模式，否则新增模式 */
export function openProviderModal(edit?: ProviderModalEditTarget): void {
  if (!els) {
    els = collectElements()
    if (!els) return
  }
  currentEditKey = edit?.key ?? null
  els.title.textContent = edit ? '编辑自定义服务商' : '添加自定义服务商'
  els.saveBtn.textContent = edit ? '保存' : '添加'
  els.name.value = edit?.name ?? ''
  els.url.value = edit?.url ?? ''
  els.iconUrl.value = ''
  els.colorDark.value = edit?.color.dark ?? '#1a1e28'
  els.colorDarkHex.textContent = els.colorDark.value
  els.colorLight.value = edit?.color.light ?? '#f0f2f5'
  els.colorLightHex.textContent = els.colorLight.value
  setPreview(edit?.icon ?? null)
  openModal()
}

function handleSave(): void {
  if (!els) return
  const name = els.name.value.trim()
  if (!name) {
    toast('请输入名称')
    return
  }
  const urlError = validateProviderUrl(els.url.value)
  if (urlError) {
    toast(urlError)
    return
  }
  const url = els.url.value.trim()
  const color = { dark: els.colorDark.value, light: els.colorLight.value }
  const updates = { name, url, icon: pendingIcon, color }

  if (currentEditKey) {
    updateCustomProvider(currentEditKey, updates)
  } else {
    addCustomProvider({ key: crypto.randomUUID(), ...updates })
  }
  // 上报主进程（saveProviderOrderFromDOM 内部会 saveProviderSettings + 推送 providers-updated）
  saveProviderOrderFromDOM()
  renderProviderList()
  closeModal()
}

/** 初始化弹窗事件绑定（app 入口调用一次） */
export function initProviderModal(): void {
  els = collectElements()
  if (!els) return

  byIdOrNull<HTMLButtonElement>('btnAddProvider')?.addEventListener('click', () => openProviderModal())

  byIdOrNull<HTMLElement>('modalClose')?.addEventListener('click', closeModal)
  byIdOrNull<HTMLButtonElement>('modalCancel')?.addEventListener('click', closeModal)
  els.overlay.addEventListener('click', e => {
    if (e.target === els?.overlay) closeModal()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && els?.overlay.classList.contains('visible')) closeModal()
  })

  els.saveBtn.addEventListener('click', handleSave)

  // 获取图标（任意主机，含本地服务）
  byIdOrNull<HTMLButtonElement>('btnFetchIcon')?.addEventListener('click', async () => {
    if (!els) return
    const urlError = validateProviderUrl(els.iconUrl.value)
    if (urlError) {
      toast('图标网址无效，仅支持 http/https')
      return
    }
    const icon = await window.electronAPI.fetchIconUrl(els.iconUrl.value.trim())
    if (icon) {
      setPreview(icon)
      toast('图标已获取')
    } else {
      toast('获取图标失败')
    }
  })

  // 本地上传
  els.iconPreview.addEventListener('click', () => els?.iconFileInput.click())
  els.iconFileInput.addEventListener('change', () => {
    const file = els?.iconFileInput.files?.[0]
    if (!file) return
    const err = validateIconFile(file)
    if (err) {
      toast(err)
      if (els) els.iconFileInput.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => setPreview(String(reader.result))
    reader.readAsDataURL(file)
  })

  // 颜色联动
  els.colorDark.addEventListener('input', () => {
    if (els) els.colorDarkHex.textContent = els.colorDark.value
  })
  els.colorLight.addEventListener('input', () => {
    if (els) els.colorLightHex.textContent = els.colorLight.value
  })
}

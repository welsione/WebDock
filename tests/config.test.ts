import { describe, it, expect, vi } from 'vitest'

// vitest hoists vi.mock calls to the top of the file, before imports
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/mock-userdata'
  }
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: () => Buffer.from('mock-icon-data')
  },
  readFileSync: () => Buffer.from('mock-icon-data')
}))

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return {
    ...actual,
    join: (...args: string[]) => args.join('/'),
    extname: (p: string) => {
      const dot = p.lastIndexOf('.')
      return dot === -1 ? '' : p.slice(dot)
    }
  }
})

import { parseShortcut, matchesKeyEvent } from '../electron/config'
import type { KeyEvent } from '../electron/config'

// ===== parseShortcut =====
describe('parseShortcut', () => {
  it('parses simple modifier+key shortcut', () => {
    const result = parseShortcut('Meta+Shift+Space')
    expect(result).not.toBeNull()
    expect(result!.mods.has('Meta')).toBe(true)
    expect(result!.mods.has('Shift')).toBe(true)
    expect(result!.key).toBe('Space')
  })

  it('parses Meta shortcut correctly', () => {
    const result = parseShortcut('Meta+Shift+Tab')
    expect(result).not.toBeNull()
    expect(result!.mods.has('Meta')).toBe(true)
    expect(result!.mods.has('Shift')).toBe(true)
    expect(result!.key).toBe('Tab')
  })

  it('parses shortcut without modifiers', () => {
    const result = parseShortcut('Tab')
    expect(result).not.toBeNull()
    expect(result!.mods.size).toBe(0)
    expect(result!.key).toBe('Tab')
  })

  it('parses Control+Alt shortcut', () => {
    const result = parseShortcut('Control+Alt+K')
    expect(result).not.toBeNull()
    expect(result!.mods.has('Control')).toBe(true)
    expect(result!.mods.has('Alt')).toBe(true)
    expect(result!.key).toBe('K')
  })

  it('returns null for empty string', () => {
    expect(parseShortcut('')).toBeNull()
  })

  it('returns null for modifier-only shortcut', () => {
    expect(parseShortcut('Meta+Shift')).toBeNull()
  })
})

// ===== matchesKeyEvent =====
describe('matchesKeyEvent', () => {
  function makeKeyDown(overrides: Partial<KeyEvent> = {}): KeyEvent {
    return {
      type: 'keyDown',
      meta: false,
      control: false,
      alt: false,
      shift: false,
      code: 'KeyA',
      ...overrides
    }
  }

  it('matches exact shortcut', () => {
    const event = makeKeyDown({ meta: true, shift: true, code: 'Space' })
    expect(matchesKeyEvent(event, 'Meta+Shift+Space')).toBe(true)
  })

  it('does not match when modifier missing', () => {
    const event = makeKeyDown({ shift: true, code: 'Space' })
    expect(matchesKeyEvent(event, 'Meta+Shift+Space')).toBe(false)
  })

  it('does not match when extra modifier pressed', () => {
    const event = makeKeyDown({ meta: true, shift: true, alt: true, code: 'Space' })
    expect(matchesKeyEvent(event, 'Meta+Shift+Space')).toBe(false)
  })

  it('does not match on keyUp', () => {
    const event = makeKeyDown({ type: 'keyUp', meta: true, shift: true, code: 'Space' })
    expect(matchesKeyEvent(event, 'Meta+Shift+Space')).toBe(false)
  })

  it('matches KeyX codes', () => {
    const event = makeKeyDown({ meta: true, code: 'KeyT' })
    expect(matchesKeyEvent(event, 'Meta+T')).toBe(true)
  })

  it('does not match different key', () => {
    const event = makeKeyDown({ meta: true, code: 'KeyT' })
    expect(matchesKeyEvent(event, 'Meta+K')).toBe(false)
  })

  it('returns false for invalid shortcut string', () => {
    const event = makeKeyDown({ code: 'KeyA' })
    expect(matchesKeyEvent(event, '')).toBe(false)
  })

  it('matches Tab shortcut', () => {
    const event = makeKeyDown({ control: true, shift: true, code: 'Tab' })
    expect(matchesKeyEvent(event, 'Control+Shift+Tab')).toBe(true)
  })
})

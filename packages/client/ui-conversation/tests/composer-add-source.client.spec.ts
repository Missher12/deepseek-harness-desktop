import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  bindComposerImagePicker, composerAddLauncherSources, createComposerAddSource,
} from '../src/client/input/composer-add-source.ts'

const sid = (value: string): SessionId => value as SessionId

describe('composer add source', () => {
  it('contributes files and image actions with localized copy', async () => {
    const dispose = bindComposerImagePicker(sid('a'), vi.fn())
    const source = createComposerAddSource({
      files: '文件和文件夹',
      filesDescription: '引用工作区内容',
      image: '添加图片',
      imageDescription: 'PNG、JPG、WebP 或 GIF',
      section: '添加',
    })

    expect(await source.candidates(
      { sessionId: sid('a') },
      { query: '', quoted: false, position: 'leading', signal: new AbortController().signal },
    )).toEqual([
      {
        name: '文件和文件夹',
        value: 'files',
        description: '引用工作区内容',
        section: '添加',
      },
      {
        name: '添加图片',
        value: 'image',
        description: 'PNG、JPG、WebP 或 GIF',
        section: '添加',
      },
    ])
    dispose()
  })

  it('omits the image action when the current composer has no image intake', async () => {
    const source = createComposerAddSource({
      files: '文件和文件夹', filesDescription: '引用工作区内容',
      image: '添加图片', imageDescription: 'PNG、JPG、WebP 或 GIF', section: '添加',
    })
    expect(await source.candidates(
      { sessionId: sid('without-images') },
      { query: '', quoted: false, position: 'leading', signal: new AbortController().signal },
    )).toEqual([{
      name: '文件和文件夹',
      value: 'files',
      description: '引用工作区内容',
      section: '添加',
    }])
  })

  it('hands files to the existing reference picker and opens the current session image picker', () => {
    const openA = vi.fn()
    const openB = vi.fn()
    const disposeA = bindComposerImagePicker(sid('a'), openA)
    const disposeB = bindComposerImagePicker(sid('b'), openB)
    const source = createComposerAddSource({
      files: 'Files and folders', filesDescription: '', image: 'Add image', imageDescription: '', section: 'Add',
    })
    const base = {
      position: 'leading' as const,
      via: 'menu' as const,
      span: { start: 0, end: 0, draftRev: 1 },
    }

    expect(source.onPick({
      ...base, session: { sessionId: sid('a') }, candidate: { name: 'files', value: 'files' },
    })).toEqual({ text: '@', continue: true })
    expect(source.onPick({
      ...base, session: { sessionId: sid('b') }, candidate: { name: 'image', value: 'image' },
    })).toBe('handled')
    expect(openA).not.toHaveBeenCalled()
    expect(openB).toHaveBeenCalledTimes(1)

    disposeA()
    disposeB()
  })

  it('does not let a stale cleanup remove a newer image-picker binding', () => {
    const stale = vi.fn()
    const current = vi.fn()
    const disposeStale = bindComposerImagePicker(sid('a'), stale)
    const disposeCurrent = bindComposerImagePicker(sid('a'), current)
    disposeStale()

    const source = createComposerAddSource({
      files: 'Files and folders', filesDescription: '', image: 'Add image', imageDescription: '', section: 'Add',
    })
    source.onPick({
      session: { sessionId: sid('a') },
      candidate: { name: 'image', value: 'image' },
      position: 'leading',
      via: 'menu',
      span: { start: 0, end: 0, draftRev: 1 },
    })

    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(1)
    disposeCurrent()
  })

  it('promotes Goal and Plan without dropping, duplicating, or mutating any original command and sections skills as plugins', () => {
    const sources = composerAddLauncherSources({
      addSection: '添加', commandsSection: '命令', pluginsSection: '插件',
    })
    const command = sources.find(source => source.name === 'command')!
    const skill = sources.find(source => source.name === 'skill')!
    const commands = [
      { name: 'status', value: 'status' },
      { name: 'plan', value: 'plan' },
      { name: 'goal', value: 'goal' },
      { name: 'compact', value: 'compact' },
    ]

    expect(command.project?.(commands)).toEqual([
      { name: 'goal', value: 'goal', section: '添加' },
      { name: 'plan', value: 'plan', section: '添加' },
      { name: 'status', value: 'status', section: '命令' },
      { name: 'compact', value: 'compact', section: '命令' },
    ])
    expect(commands).toEqual([
      { name: 'status', value: 'status' },
      { name: 'plan', value: 'plan' },
      { name: 'goal', value: 'goal' },
      { name: 'compact', value: 'compact' },
    ])
    expect(skill.project?.([{ name: 'github', value: 'github' }])).toEqual([
      { name: 'github', value: 'github', section: '插件' },
    ])
  })
})

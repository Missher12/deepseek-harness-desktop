// Web e2e scenario: the real host serves every user-invocable skill to the
// browser slash source and Codex-style @ Plugins alias — user-only
// (disable-model-invocation) entries appear with their marker while
// user-disabled quadrants stay hidden. A real
// chromium connects a fresh workspace seeded with all four policy quadrants;
// no model call is issued, so a stray stream fails loud on the open LLM seam.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/skill-invocation-policy', import.meta.url))
const MENU_EXPECTED = join(SNAPSHOT_DIR, 'menu.expected.md')
const MODE = webSnapshotMode()

interface SeedSkill {
  name: string
  description: string
  frontmatter: string
}

const SKILLS: readonly SeedSkill[] = [
  {
    name: 'policy-shared',
    description: 'Available to both model and user invocation',
    frontmatter: '',
  },
  {
    name: 'policy-model-only',
    description: 'Available only to model invocation',
    frontmatter: 'user-invocable: false\n',
  },
  {
    name: 'policy-user-only',
    description: 'Available only to user invocation',
    frontmatter: 'disable-model-invocation: true\n',
  },
  {
    name: 'policy-trusted-only',
    description: 'Available only to trusted internal callers',
    frontmatter: 'disable-model-invocation: true\nuser-invocable: false\n',
  },
]

async function seedSkills(workspaceCwd: string): Promise<void> {
  for (const skill of SKILLS) {
    const directory = join(workspaceCwd, '.agents', 'skills', skill.name)
    await mkdir(directory, { recursive: true })
    const policyLines = skill.frontmatter === '' ? [] : skill.frontmatter.trimEnd().split('\n')
    await writeFile(join(directory, 'SKILL.md'), [
      '---',
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      ...policyLines,
      '---',
      '',
      `# ${skill.name}`,
      '',
    ].join('\n'))
  }
}

describe('web e2e: skill invocation policy through the real host', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSkills(scaffold.workspaceCwd)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('textbox', { name: 'Choose workspace' }).click()
    await page.getByRole('menuitem', { name: 'No project', exact: true }).click()
    await page.locator('[data-composer-input][contenteditable="true"]')
      .waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders every user-invocable skill under / and @ Plugins, then inserts a plugin chip', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skill-invocation-policy'))
    const input = page.locator('[data-composer-input]').first()
    await input.fill('/policy')
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    await expect.poll(
      () => menu.getByRole('option', { name: /policy-shared/ }).count(),
      { timeout: 10_000 },
    ).toBe(1)

    // The user-only quadrant is invocable here — its only entry point — and
    // wears the user-only marker; both user-disabled quadrants stay hidden.
    expect(await menu.getByRole('option', { name: /policy-user-only user-only · / }).count()).toBe(1)
    expect(await menu.getByRole('option', { name: /policy-model-only/ }).count()).toBe(0)
    expect(await menu.getByRole('option', { name: /policy-trusted-only/ }).count()).toBe(0)

    const snapshot = await captureStableAria(page, '[role="listbox"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MENU_EXPECTED, snapshot, MODE)

    await input.fill('@policy')
    await expect.poll(
      () => menu.getByRole('option', { name: /policy-shared/ }).count(),
      { timeout: 10_000 },
    ).toBe(1)
    expect(await page.locator('[role="presentation"][data-source="plugin"]').textContent()).toBe('Plugins')
    const plugin = menu.getByRole('option', { name: /policy-shared/ })
    expect(await plugin.locator('svg').count()).toBe(1)
    expect(await menu.getByRole('option', { name: /policy-model-only/ }).count()).toBe(0)
    expect(await menu.getByRole('option', { name: /policy-trusted-only/ }).count()).toBe(0)
    await plugin.click()
    const chip = page.locator('[data-composer-chip="plugin"]')
    expect(await chip.count()).toBe(1)
    expect(await chip.textContent()).toContain('policy-shared')

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['menu.expected.md'])
  })
})

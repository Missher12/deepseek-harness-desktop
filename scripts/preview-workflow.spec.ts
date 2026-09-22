import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const workflow = yaml.load(readFileSync(resolve(import.meta.dirname, '../.github/workflows/build-preview-cloudflare.yml'), 'utf8')) as {
  on: unknown
  permissions: unknown
  concurrency: unknown
  env: Record<string, string>
  jobs: Record<'preview', {
    'runs-on': string
    steps: Array<{
      name?: string
      id?: string
      if?: string
      uses?: string
      run?: string
      with?: Record<string, unknown>
      env?: Record<string, string>
    }>
  }>
}
const preview = workflow.jobs.preview

describe('PR preview workflow', () => {
  it('keeps every PR author on the selected GitHub-hosted runner', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['preview'])
    expect(preview['runs-on']).toBe('ubuntu-24.04')
    expect(workflow.on).toEqual({ pull_request: { types: ['opened', 'synchronize', 'reopened'] } })
    expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' })
    expect(preview.steps.find(step => step.uses === 'actions/checkout@v6')?.with).toEqual({ 'persist-credentials': false })
  })

  it('keeps the immutable full build and restore-only dependency cache', () => {
    expect(workflow.env.PRIMARY_NODE_VERSION).toBe('24')
    expect(workflow.env.DSH_TELEMETRY_DISABLED).toBe('1')
    const commands = preview.steps.map(step => step.run)
    expect(commands).toContain('pnpm install --frozen-lockfile')
    expect(commands).toContain('pnpm run build')
    expect(commands).toContain('pnpm --filter @deepseek-ai/dsh-web-frontend run build:preview')
    expect(commands.indexOf('pnpm run build')).toBeLessThan(commands.indexOf('pnpm --filter @deepseek-ai/dsh-web-frontend run build:preview'))
    expect(preview.steps.filter(step => step.uses?.startsWith('actions/cache'))).toHaveLength(1)
    expect(preview.steps.find(step => step.uses === 'actions/cache/restore@v4')?.with).toMatchObject({
      key: "${{ runner.os }}-node-${{ env.PRIMARY_NODE_VERSION }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}",
    })
  })

  it('retains per-PR deployment, protected image verification, and idempotent URL comments', () => {
    expect(workflow.concurrency).toEqual({
      group: 'build-preview-cloudflare-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true,
    })
    expect(workflow.env.CF_PROJECT).toBe('dsh-build-preview')
    const shape = preview.steps.find(step => step.name === 'Shape the upload')!
    expect(shape.run).toContain("find apps/web/dist -name '*.map' -delete")
    expect(shape.run).toContain('cp apps/web/dist/preview.html apps/web/dist/index.html')
    const deploy = preview.steps.find(step => step.name === 'Upload to Cloudflare Pages')!
    expect(deploy.run).toContain('npx --yes wrangler@4 pages deploy apps/web/dist')
    expect(deploy.run).toContain('--branch "pr-${{ github.event.pull_request.number }}"')
    const verify = preview.steps.find(step => step.name === 'Verify the protected deployment serves the image')!
    expect(verify.run).toContain('/preview/vfs-image.tar.gz')
    expect(verify.run).toContain('"$code" != "200"')
    expect(verify.run).toContain('content-encoding:')
    expect(verify.run).toContain('"$magic" != "1f8b"')
    expect(verify.env?.CF_ACCESS_CLIENT_SECRET).toBe('${{ secrets.CF_ACCESS_CLIENT_SECRET }}')
    const comment = preview.steps.find(step => step.name === 'Comment the preview URL')!
    expect(comment.run).toContain('<!-- dsh-preview-url -->')
    expect(comment.run).toContain('gh pr comment "$PR" --body-file -')
  })

  it('gates only deployment, remote verification, and URL comments on configured credentials', () => {
    const gated = preview.steps.filter(step => step.if)
    expect(gated.map(step => step.name)).toEqual([
      'Upload to Cloudflare Pages', 'Verify the protected deployment serves the image', 'Comment the preview URL',
    ])
    for (const step of gated) expect(step.if).toBe("steps.preview-config.outputs.enabled == 'true'")
    expect(preview.steps.findIndex(step => step.id === 'preview-config'))
      .toBeLessThan(preview.steps.findIndex(step => step.name === 'Upload to Cloudflare Pages'))
  })

  const names = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET']
  it.each([0, 1, 2, 3, 4])('executes the configuration check with %i configured credentials', (count) => {
    const step = preview.steps.find(item => item.id === 'preview-config')!
    const source = step.run?.match(/^node --input-type=module <<'NODE'\n([\s\S]+)\nNODE\s*$/)?.[1]
    expect(source).toBeDefined()
    for (const name of names) expect(step.env?.[name]).toBe('${{ secrets.' + name + ' }}')
    const scratch = mkdtempSync(join(tmpdir(), 'dsh-preview-config-'))
    try {
      const output = join(scratch, 'output')
      const summary = join(scratch, 'summary')
      const credentials = Object.fromEntries(names.map((name, i) => [name, i < count ? `synthetic-private-value-${i}` : '']))
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source!], {
        env: { ...process.env, ...credentials, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8',
      })
      expect(result.error).toBeUndefined()
      expect(result.stdout + result.stderr).not.toContain('synthetic-private-value-')
      if (count === 0 || count === names.length) {
        expect(result.status).toBe(0)
        expect(readFileSync(output, 'utf8')).toBe(`enabled=${count === names.length}\n`)
        if (count === 0) expect(readFileSync(summary, 'utf8')).toContain('no preview was deployed')
      } else {
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('configuration is incomplete')
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})

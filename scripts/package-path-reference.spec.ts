import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ROOT_PACKAGE_REFERENCE } from './package-path-reference.ts'
import { findReferenceViolations } from './repo-files.ts'

it('checks bare checkout paths without mistaking historical permalinks for current files', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-references-'))
  try {
    const file = join(root, 'reference.md')
    writeFileSync(file, [
      'Missing checkout file: `packages/client/ui-chat/src/missing.ts`.',
      '[Historical file](https://github.com/example/project/blob/abc/packages/client/ui-chat/src/old.ts)',
      '[Relative file](../packages/client/ui-chat/src/linked.ts)',
      '[Root file](packages/client/ui-chat/src/broken.ts)',
    ].join('\n'))
    expect(findReferenceViolations(root, file, ROOT_PACKAGE_REFERENCE, ref => ref, () => true)).toEqual([
      { file: 'reference.md', line: 1, ref: 'packages/client/ui-chat/src/missing.ts' },
      { file: 'reference.md', line: 4, ref: 'packages/client/ui-chat/src/broken.ts' },
    ])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

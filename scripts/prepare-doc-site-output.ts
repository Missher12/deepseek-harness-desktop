import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(import.meta.dirname, '..')

/**
 * Remove the one disposable documentation build directory after validating
 * that neither its parent nor the target itself redirects outside the repo.
 *
 * @param root Repository root that owns `website/.dist`.
 */
export function prepareDocSiteOutput(root: string = repositoryRoot): void {
  const canonicalRoot = realpathSync(root)
  const website = resolve(root, 'website')
  const canonicalWebsite = realpathSync(website)
  if (canonicalWebsite !== resolve(canonicalRoot, 'website')) {
    throw new Error('prepare-doc-site-output: refusing output through a linked website directory')
  }

  const output = resolve(website, '.dist')
  if (!existsSync(output)) return
  if (lstatSync(output).isSymbolicLink()) {
    throw new Error('prepare-doc-site-output: refusing linked website/.dist output')
  }
  rmSync(output, { recursive: true, force: true })
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  prepareDocSiteOutput()
}

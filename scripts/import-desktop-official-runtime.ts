/** Read-only reuse of a legacy runtime with an independently reviewed native evidence receipt. */
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { verifyOfficialRuntime } from './desktop-base-runtime.ts'
import type { VerifiedOfficialInputs } from './desktop-official-inputs.ts'

/** Audited runtime identity; the receipt digest is supplied by the build owner, not inferred from the runtime. */
export interface OfficialRuntimeAudit {
  schema: 1
  sourceSha: string
  inputManifestSha256: string
  runtimeInventorySha256: string
  platform: string
  arch: string
  evidence: { path: string; sha256: string }[]
}

/**
 * Validate a trusted external audit and actual runtime bytes without editing or installing into the runtime.
 * @param inputs - verified source/package inputs.
 * @param runtimeDirectory - previously built immutable runtime.
 * @param auditPath - independently reviewed native audit receipt.
 * @param auditSha256 - trusted receipt digest, including its platform and evidence identities.
 * @returns physical runtime identity; this does not grant new installer acceptance.
 */
export async function importOfficialRuntime(
  inputs: VerifiedOfficialInputs, runtimeDirectory: string, auditPath: string, auditSha256: string,
): Promise<{ runtimeDirectory: string; inventorySha256: string; platform: string; arch: string }> {
  const bytes = await readFile(auditPath)
  if (!/^[a-f0-9]{64}$/u.test(auditSha256) || createHash('sha256').update(bytes).digest('hex') !== auditSha256) {
    throw new Error('Runtime audit receipt hash mismatch.')
  }
  const parsed: unknown = JSON.parse(bytes.toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid runtime audit receipt.')
  const audit = parsed as Omit<OfficialRuntimeAudit, 'schema'> & { schema: unknown }
  if (audit.schema !== 1 || audit.sourceSha !== inputs.source.sourceSha
    || audit.inputManifestSha256 !== inputs.descriptorSha256 || audit.platform !== process.platform || audit.arch !== process.arch
    || !Array.isArray(audit.evidence) || audit.evidence.length === 0) throw new Error('Runtime audit does not match official inputs and this native platform.')
  for (const evidence of audit.evidence) {
    if (typeof evidence.path !== 'string' || typeof evidence.sha256 !== 'string'
      || createHash('sha256').update(await readFile(evidence.path)).digest('hex') !== evidence.sha256) {
      throw new Error('Runtime audit native evidence hash mismatch.')
    }
  }
  const provenance = await verifyOfficialRuntime(runtimeDirectory)
  if (provenance.inventorySha256 !== audit.runtimeInventorySha256) throw new Error('Runtime inventory differs from the native audit.')
  return {
    runtimeDirectory: await realpath(runtimeDirectory), inventorySha256: provenance.inventorySha256,
    platform: audit.platform, arch: audit.arch,
  }
}

/** Kernel observations from one Electron renderer and its main process. */
export interface LinuxSandboxObservation {
  mainCommand: readonly string[]
  rendererCommand: readonly string[]
  rendererStatus: string
  mainUserNamespace: string
  rendererUserNamespace: string
}

/**
 * Reject weakened launch flags and verify kernel-enforced renderer isolation.
 * @param observation - Values read from the live process and /proc.
 */
export function assertLinuxSandbox(observation: LinuxSandboxObservation): void {
  // Chromium's Linux setproctitle replaces argv with one space-delimited string.
  // Inspect switch tokens in both native argv and that /proc representation;
  // these tokens are never used to reconstruct or execute a command.
  const mainTokens = observation.mainCommand.flatMap(argument => argument.split(/\s+/u))
  const rendererTokens = observation.rendererCommand.flatMap(argument => argument.split(/\s+/u))
  const forbidden = new Set([
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-seccomp-filter-sandbox',
    '--disable-namespace-sandbox', '--single-process', '--no-zygote',
  ])
  for (const argument of [...mainTokens, ...rendererTokens]) {
    const [flag] = argument.split('=')
    if (flag !== undefined && forbidden.has(flag)) throw new Error('Electron sandbox bypass argument detected')
  }
  if (!rendererTokens.includes('--type=renderer')) throw new Error('Expected a renderer process')
  if (!/^NoNewPrivs:\s+1\s*$/mu.test(observation.rendererStatus)
    || !/^Seccomp:\s+2\s*$/mu.test(observation.rendererStatus)) {
    throw new Error('Renderer lacks kernel NoNewPrivs or Seccomp filtering')
  }
  if (!/^user:\[\d+\]$/u.test(observation.mainUserNamespace)
    || !/^user:\[\d+\]$/u.test(observation.rendererUserNamespace)
    || observation.mainUserNamespace === observation.rendererUserNamespace) {
    throw new Error('Renderer does not have an isolated user namespace')
  }
}

const { chmod, copyFile, rename } = require('node:fs/promises')
const { join } = require('node:path')

/** Install a fail-closed entry in Linux packages before archive generation. */
module.exports = async function installLinuxLauncher(context) {
  if (context.electronPlatformName !== 'linux') throw new Error('Linux launcher hook requires a Linux package')
  const executable = join(context.appOutDir, 'deepseek-harness')
  await rename(executable, join(context.appOutDir, 'deepseek-harness-bin'))
  await copyFile(join(__dirname, 'launcher.sh'), executable)
  await chmod(executable, 0o755)
}

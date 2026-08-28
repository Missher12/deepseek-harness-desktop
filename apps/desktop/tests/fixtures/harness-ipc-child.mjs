if (typeof process.send !== 'function') {
  process.exitCode = 1
} else {
  process.on('message', (message) => {
    if (!(message instanceof Uint8Array) || typeof process.send !== 'function') return
    process.send(new Uint8Array(message))
  })
  process.stdout.write('dsh web: http://127.0.0.1:45678\n')
  setInterval(() => undefined, 1_000)
}

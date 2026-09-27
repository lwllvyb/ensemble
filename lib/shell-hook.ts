import { spawn } from 'child_process'

/** Execute trusted hook code with positional arguments and a bounded process group. */
export function runShellHook(command: string, name: string, args: string[], timeoutMs: number, stdin?: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', `${command} "$@"`, `ensemble-${name}`, ...args], {
      detached: true, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let bytes = 0
    let settled = false
    let exitedSuccessfully = false
    let stdoutClosed = false
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    const resolveOutput = () => {
      if (settled || !exitedSuccessfully) return
      settled = true
      if (closeTimer) clearTimeout(closeTimer)
      clearTimeout(timer)
      child.stdout?.destroy()
      child.stderr?.destroy()
      resolve(output)
    }
    const fail = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (closeTimer) clearTimeout(closeTimer)
      child.stdout?.destroy()
      child.stderr?.destroy()
      // A hook can launch subprocesses; kill its whole process group.
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
      }
      reject(new Error(`${name} command failed`))
    }
    const timer = setTimeout(fail, timeoutMs)
    child.stdin?.on('error', () => {})
    if (stdin !== undefined) {
      try { child.stdin?.end(stdin) } catch { /* hook already closed stdin */ }
    }
    child.stdout!.setEncoding('utf8')
    child.stdout!.once('close', () => {
      stdoutClosed = true
      resolveOutput()
    })
    child.stdout!.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 1024 * 1024) fail()
      else output += chunk
    })
    child.stderr?.resume()
    child.on('error', fail)
    child.on('exit', code => {
      if (settled) return
      if (code !== 0) { fail(); return }
      exitedSuccessfully = true
      if (stdoutClosed) resolveOutput()
      else closeTimer = setTimeout(resolveOutput, 500)
    })
  })
}

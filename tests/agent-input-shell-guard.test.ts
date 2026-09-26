import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AgentNotRunningError, TmuxRuntime } from '../lib/agent-runtime'

// Deze test praat met een ECHTE tmux-server op een eigen socket, zodat hij
// niets van lopende teams raakt. Aanleiding (26-09-2026): Claude sloot zich
// af bij de trustvraag, de lege zsh leek "ready" op de ❯ uit de prompt, en de
// startprompt werd als shellcommando getypt. "the lead's plan" opende een
// aanhalingsteken; de pane bleef hangen op quote> en slikte elk teambericht.

const HAS_TMUX = (() => {
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return true } catch { return false }
})()

const TRICKY_TEXTS = [
  "Let op: dit is Anna's test, zo'n korte klus.",
  'Een "dubbele" quote en een `backtick` en $(echo pwned) en ${HOME}',
  'Sentinel <<COLLAB_DONE>> en een heredoc <<EOF',
  'Lees geen ~/.claude/infra.md; ook niet; & of | of > /tmp/x',
  'Regel een\nRegel twee\n\nRegel vier met \\ backslash en ! uitroep',
]

describe.skipIf(!HAS_TMUX)('agent-invoer via tmux (echte tmux)', () => {
  const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ens-guard-'))
  const socket = path.join(socketDir, 'tmux.sock')
  const oldTmux = process.env.TMUX
  let runtime: TmuxRuntime
  let n = 0

  const tmux = (...args: string[]) => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' })

  beforeAll(() => {
    // TmuxRuntime roept kaal `tmux` aan; via TMUX_TMPDIR is niet genoeg voor
    // -S, dus een wrapper op PATH die altijd onze eigen socket gebruikt.
    const binDir = path.join(socketDir, 'bin')
    fs.mkdirSync(binDir)
    const real = execFileSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).trim()
    fs.writeFileSync(path.join(binDir, 'tmux'), `#!/bin/sh\nexec "${real}" -S "${socket}" "$@"\n`, { mode: 0o755 })
    process.env.PATH = `${binDir}:${process.env.PATH}`
    delete process.env.TMUX
    runtime = new TmuxRuntime()
  })

  afterEach(() => { try { tmux('kill-server') } catch { /* al weg */ } })

  afterAll(() => {
    process.env.PATH = (process.env.PATH ?? '').split(':').slice(1).join(':')
    if (oldTmux !== undefined) process.env.TMUX = oldTmux
    fs.rmSync(socketDir, { recursive: true, force: true })
  })

  const newSession = (command?: string): string => {
    const name = `guard-${process.pid}-${n++}`
    const args = ['new-session', '-d', '-s', name, '-x', '200', '-y', '50']
    if (command) args.push(command)
    else args.push('sh')
    tmux(...args)
    return name
  }

  const waitFor = async (pred: () => boolean, ms = 3000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      if (pred()) return
      await new Promise(r => setTimeout(r, 50))
    }
  }

  it('weigert een prompt te plakken als er een shell op de voorgrond staat', async () => {
    const name = newSession()
    await waitFor(() => /sh$/.test(tmux('display-message', '-p', '-t', name, '#{pane_current_command}').trim()))
    const file = path.join(socketDir, 'prompt.txt')
    fs.writeFileSync(file, TRICKY_TEXTS[0])
    await expect(runtime.pasteFromFile(name, file)).rejects.toBeInstanceOf(AgentNotRunningError)
    const pane = tmux('capture-pane', '-p', '-t', name)
    expect(pane).not.toContain("Anna's")
  })

  it('weigert letterlijke agent-invoer via sendKeys als er een shell op de voorgrond staat', async () => {
    const name = newSession()
    await waitFor(() => /sh$/.test(tmux('display-message', '-p', '-t', name, '#{pane_current_command}').trim()))
    await expect(runtime.sendKeys(name, TRICKY_TEXTS[0], { literal: true, enter: true, agentInput: true }))
      .rejects.toBeInstanceOf(AgentNotRunningError)
  })

  it.each(TRICKY_TEXTS)('levert lastige tekst ongeschonden af bij een draaiende agent: %s', async text => {
    // `cat` speelt de agent: het schrijft precies terug wat er binnenkomt, en
    // is geen shell, dus zou quoting ergens misgaan dan zie je het hier.
    const out = path.join(socketDir, `out-${n}.txt`)
    const name = newSession(`cat > '${out}'`)
    await waitFor(() => tmux('display-message', '-p', '-t', name, '#{pane_current_command}').trim() === 'cat')
    const file = path.join(socketDir, `in-${n}.txt`)
    fs.writeFileSync(file, text)
    await runtime.pasteFromFile(name, file)
    await waitFor(() => fs.existsSync(out) && fs.readFileSync(out, 'utf8').includes(text.split('\n').pop()!))
    expect(fs.readFileSync(out, 'utf8')).toContain(text.split('\n')[0])
    expect(fs.readFileSync(out, 'utf8')).toContain(text.split('\n').pop()!)
  })
})

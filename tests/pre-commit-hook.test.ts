import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = path.resolve(process.cwd(), '.githooks/pre-commit')

let repo: string

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-hook-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

function runHook(): { out: string; code: number } {
  try {
    const out = execFileSync(HOOK, [], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { out, code: 0 }
  } catch (err: any) {
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 }
  }
}

describe('pre-commit hook', () => {
  it('herkent een sessielink ook in een bestandsnaam met een spatie', () => {
    // De ongequote `for file in $STAGED` splitst "session notes.md" op de
    // spatie in "session" en "notes.md", waarna geen van beide delen nog
    // overeenkomt met het echte staged pad en de scan het bestand overslaat.
    const fname = 'session notes.md'
    // De link wordt hier opgebouwd in plaats van uitgeschreven, anders blokkeert
    // de hook die dit bestand test zijn eigen testbestand. Dat is geen theorie:
    // de eerste versie van deze test hield de commit tegen.
    const sessielink = ['claude.ai', '/code/', 'session_', 'AbCdEfGhIj1234567890'].join('')
    fs.writeFileSync(path.join(repo, fname), `zie ${sessielink}\n`)
    execFileSync('git', ['add', fname], { cwd: repo })

    const { out, code } = runHook()
    expect(code).toBe(1)
    expect(out).toMatch(/session link/)
  })
})

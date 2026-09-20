import { spawn } from 'child_process'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const BRIDGE = path.resolve(process.cwd(), 'scripts/ensemble-bridge.sh')
const POLLER = path.resolve(process.cwd(), 'scripts/collab-poller.sh')

let root: string
let server: http.Server
let apiUrl: string

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-sig-'))
  // Minimale nep-API: een health check voor de bridge en een teamstatus voor
  // de poller, anders stoppen beide scripts al vóór ze hun wachtlus bereiken.
  server = http.createServer((req, res) => {
    if (req.url === '/api/v1/health') {
      res.writeHead(200)
      res.end('ok')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'active' }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  apiUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
})

afterEach(async () => {
  fs.rmSync(root, { recursive: true, force: true })
  await new Promise<void>(resolve => server.close(() => resolve()))
})

// Spawnt het script met een echte runtime-map en een lokale nep-API, zodat het
// script zijn wachtlus daadwerkelijk bereikt in plaats van meteen te stoppen
// op een falende health check of een ontbrekende map. Controleert eerst dat
// het proces na 500ms nog leeft: is het dan al gestopt (om een andere reden
// dan het signaal), dan meet de rest van de test niets en faalt hij expliciet
// in plaats van stilzwijgend "geslaagd" te melden.
function stopsOnTerm(script: string, teamId: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const p = spawn(script, [teamId, apiUrl], {
      stdio: 'ignore',
      env: { ...process.env, COLLAB_RUNTIME_ROOT: root },
    })
    setTimeout(() => {
      let leeft = true
      try { process.kill(p.pid!, 0) } catch { leeft = false }
      if (!leeft) {
        reject(new Error('proces was al gestopt vóór het signaal werd gestuurd, test meet niets'))
        return
      }
      p.kill('SIGTERM')
    }, 500)
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(false) }, 3000)
    p.on('exit', () => { clearTimeout(timer); resolve(true) })
  })
}

describe('signaalafhandeling', () => {
  it('bridge stopt op SIGTERM', async () => {
    const teamDir = path.join(root, 'team-x')
    fs.mkdirSync(teamDir, { recursive: true })
    fs.writeFileSync(path.join(teamDir, 'messages.jsonl'), '')
    expect(await stopsOnTerm(BRIDGE, 'team-x')).toBe(true)
  }, 10000)

  it('poller stopt op SIGTERM', async () => {
    const teamDir = path.join(root, 'team-y')
    fs.mkdirSync(teamDir, { recursive: true })
    expect(await stopsOnTerm(POLLER, 'team-y')).toBe(true)
  }, 10000)
})

/**
 * De bridge behandelde elke 4xx als een permanente clientfout en sloeg het
 * bericht dan voorgoed over ("skip permanently, don't retry client errors").
 * Een 429 (rate limit) of een 408 (timeout) is geen kapotte prompt, maar een
 * tijdelijke toestand: die verdiende dezelfde exponential backoff als een
 * serverfout, niet een stille skip. Dit werd urgent zodra taak 16 de rate
 * limiting van de server weer aanzet, want dan gaat de server ook echt 429's
 * teruggeven.
 *
 * De retry-lus zit in een los python3-proces (de bridge is bash). Een
 * SIGTERM op de bridge zette voorheen alleen bash's eigen STOPPEN-vlag: dat
 * python3-proces wist daar niets van en liep zijn backoff (tot 30s) gewoon
 * af. Dat is nu opgelost door de TERM expliciet door te sturen en python3
 * zijn eigen sleep te laten onderbreken via een signal handler.
 */
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const BRIDGE = path.resolve(process.cwd(), 'scripts/ensemble-bridge.sh')

async function waitFor(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(r => setTimeout(r, 30))
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}`)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Neppe API: /api/v1/health is altijd oké, POST-verzoeken worden geteld en beantwoord door `respond`. */
function fakeApi(respond: (postCount: number) => number): Promise<{ url: string; close: () => void; postCount: () => number }> {
  let count = 0
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/v1/health') {
        res.writeHead(200)
        res.end('ok')
        return
      }
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        count += 1
        const status = respond(count)
        res.writeHead(status)
        res.end()
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
      resolve({ url, close: () => server.close(), postCount: () => count })
    })
  })
}

describe('bridge retry op 429/408', () => {
  let root: string
  let bridge: ChildProcess | undefined

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-bridge-retry-'))
  })

  afterEach(() => {
    if (bridge && bridge.pid && isAlive(bridge.pid)) bridge.kill('SIGKILL')
    fs.rmSync(root, { recursive: true, force: true })
  })

  function makeTeam(id: string, message = 'hoi'): string {
    const dir = path.join(root, id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'messages.jsonl'),
      `${JSON.stringify({ from: 'codex-1', to: 'team', content: message, id: 'm1', timestamp: '2026-09-20T10:00:00.000Z' })}\n`,
    )
    return dir
  }

  function postedCount(dir: string): number {
    const raw = fs.readFileSync(path.join(dir, 'bridge-posted'), 'utf8').trim()
    return raw === '' ? 0 : Number(raw)
  }

  it('probeert opnieuw na een 429 en levert het bericht alsnog af', async () => {
    const api = await fakeApi(n => (n === 1 ? 429 : 200))
    const dir = makeTeam('team-retry-429')

    bridge = spawn(BRIDGE, ['team-retry-429', api.url], {
      stdio: 'ignore',
      env: { ...process.env, COLLAB_RUNTIME_ROOT: root },
    })

    await waitFor(() => fs.existsSync(path.join(dir, 'bridge-posted')) && postedCount(dir) >= 1, 8000, 'bericht afgeleverd na 429-retry')

    expect(postedCount(dir)).toBe(1)
    // Minstens twee POSTs: de eerste (429) en de retry die wel lukte.
    expect(api.postCount()).toBeGreaterThanOrEqual(2)

    bridge.kill('SIGTERM')
    api.close()
  }, 10000)

  it('slaat een echte clientfout (bijv. 400) nog steeds permanent over, zonder te retryen', async () => {
    const api = await fakeApi(() => 400)
    const dir = makeTeam('team-permanent-4xx')

    bridge = spawn(BRIDGE, ['team-permanent-4xx', api.url], {
      stdio: 'ignore',
      env: { ...process.env, COLLAB_RUNTIME_ROOT: root },
    })

    await waitFor(() => fs.existsSync(path.join(dir, 'bridge-posted')) && postedCount(dir) >= 1, 8000, 'bericht overgeslagen na 400')

    expect(postedCount(dir)).toBe(1)
    // Geen backoff, dus maar één POST: een 400 is en blijft permanent.
    expect(api.postCount()).toBe(1)

    bridge.kill('SIGTERM')
    api.close()
  }, 10000)

  it('onderbreekt een lopende 429-backoff meteen op SIGTERM, in plaats van de volle duur af te wachten', async () => {
    // Blijft altijd 429 antwoorden: de bridge komt dan in steeds langere
    // backoffs terecht (0.5s, 1.0s, 2.0s, 4.0s, ...) en geeft nooit op uit
    // zichzelf. We wachten tot de 4e POST binnen is (dus de bridge net de
    // 4.0s-backoff is ingegaan) en sturen dan TERM.
    const api = await fakeApi(() => 429)
    makeTeam('team-interrupt-backoff')

    bridge = spawn(BRIDGE, ['team-interrupt-backoff', api.url], {
      stdio: 'ignore',
      env: { ...process.env, COLLAB_RUNTIME_ROOT: root },
    })

    await waitFor(() => api.postCount() >= 4, 8000, 'vierde 429 binnen (bridge zit nu in de 4s-backoff)')

    const start = Date.now()
    bridge.kill('SIGTERM')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('bridge stopte niet snel genoeg na SIGTERM')), 2000)
      bridge!.on('exit', () => { clearTimeout(timer); resolve() })
    })
    const elapsedMs = Date.now() - start

    // De 4e backoff duurt 4s; zonder de fix zou dit tot enkele seconden
    // kunnen duren. Ruim onder de 2s bewijst dat de sleep echt onderbroken
    // werd, niet gewoon afliep.
    expect(elapsedMs).toBeLessThan(2000)

    api.close()
  }, 10000)
})

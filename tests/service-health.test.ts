import fs from 'fs'
import os from 'os'
import path from 'path'
import net from 'net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// De leeftijdscheck in collab-preflight.sh was een proxy voor de vraag die er
// werkelijk toe doet: kan deze service bij de credentials van de agents die
// hij spawnt. Het veld heet naar wat het meet, want leesbaar is niet geldig:
// ANTHROPIC_API_KEY en CLAUDE_CODE_OAUTH_TOKEN staan NIET in de env van de
// echte, gezond draaiende launchd-service (geverifieerd met
// `launchctl print gui/$(id -u)/dev.ensemble.server`: alleen PATH, HOME,
// XPC_SERVICE_NAME en het overgeërfde SSH_AUTH_SOCK). Die vars zijn dus geen
// bruikbaar signaal voor deze service. claude en codex bewaren hun
// login-status op schijf onder $HOME (~/.claude/.credentials.json,
// ~/.codex/auth.json) en $HOME wordt wel correct doorgegeven door de
// launchd-plist, dus daar checkt de fix op.

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to reserve a test port'))
        return
      }
      const { port } = address
      srv.close(err => (err ? reject(err) : resolve(port)))
    })
    srv.on('error', reject)
  })
}

async function waitForHealthy(baseUrl: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      if (response.ok) return
    } catch {
      // Server may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Server did not become healthy at ${baseUrl}`)
}

describe('service-gezondheid', () => {
  const originalEnv = { ...process.env }
  let tempRoot: string
  let port: number
  let baseUrl: string

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-health-'))
    port = await getFreePort()
    baseUrl = `http://127.0.0.1:${port}`
    process.env.ENSEMBLE_DATA_DIR = tempRoot
    process.env.ENSEMBLE_PORT = String(port)
    process.env.ENSEMBLE_URL = baseUrl
    vi.resetModules()
    await import('../server')
    await waitForHealthy(baseUrl)
  })

  afterAll(() => {
    process.env = originalEnv
    fs.rmSync(tempRoot, { recursive: true, force: true })
    vi.resetModules()
  })

  it('health meldt of de credential-opslag leesbaar is, met een geldige waarde', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`)
    const body = await res.json()
    expect(['readable', 'unreachable']).toContain(body.credentialStore)
    expect(typeof body.uptimeSeconds).toBe('number')
  })
})

describe('preflight beslist op de credential-opslag, niet alleen op leeftijd', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-preflight.sh'), 'utf8')
  // Blok tussen de servicecheck en de DNS-sectie: hier stond vroeger alleen
  // de leeftijdsvergelijking.
  const blok = src.slice(src.indexOf('Ensemble service responding'), src.indexOf('TMUX DNS'))

  it('leest het credentialStore-veld van de health-endpoint', () => {
    // Niet zomaar op het woord "credentials" matchen: dat stond al in de oude
    // toelichtende comment bij de leeftijdscheck, dus die test was groen ook
    // zonder de fix. Hier moet de JSON van de health-endpoint daadwerkelijk
    // uitgelezen worden.
    expect(blok).toMatch(/get\('credentialStore'/)
  })

  it('herstart via launchd zodra credentials ontbreken, vóór er over leeftijd gesproken wordt', () => {
    const credsIndex = blok.indexOf("CREDS")
    const ageIndex = blok.indexOf('SERVICE_MAX_AGE_HOURS')
    expect(credsIndex).toBeGreaterThan(-1)
    expect(ageIndex).toBeGreaterThan(-1)
    expect(credsIndex).toBeLessThan(ageIndex)
  })

  it('behoudt de leeftijdscheck als vangnet voor als de health-uitvraag zelf niets bruikbaars teruggeeft', () => {
    expect(blok).toMatch(/val terug op de leeftijdscheck/)
    expect(blok).toMatch(/SERVICE_MAX_AGE_HOURS/)
  })
})

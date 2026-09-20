/**
 * De preflight moet de health-uitvraag ook echt gebruiken.
 *
 * De eerste tests hiervoor controleerden of het script de juiste tekst bevatte.
 * Die waren groen terwijl het script in de praktijk nooit de goede tak nam: het
 * health-endpoint was hernoemd naar credentialStore met de waarde "readable",
 * en één vergelijking stond nog op "ok". Gevolg was dat de preflight altijd op
 * het leeftijdsvangnet terugviel, precies het gedrag dat deze taak wegneemt.
 *
 * Deze test draait de preflight tegen een neppe health-server en kijkt naar wat
 * hij zegt.
 */
import http from 'http'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
import { afterEach, describe, expect, it } from 'vitest'

const PREFLIGHT = path.resolve(process.cwd(), 'scripts/collab-preflight.sh')

let server: http.Server | undefined
afterEach(() => {
  server?.close()
  server = undefined
})

/** Start een health-endpoint dat precies dit antwoord geeft, op een vrije poort. */
async function nepServer(body: unknown): Promise<string> {
  server = http.createServer((req, res) => {
    if (req.url === '/api/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const adres = server!.address()
  if (typeof adres === 'string' || !adres) throw new Error('geen poort gekregen')
  return `http://127.0.0.1:${adres.port}`
}

// Asynchroon, niet execFileSync. De neppe server draait in ditzelfde proces en
// een synchrone aanroep blokkeert de event loop, waardoor die server de
// health-vraag nooit kan beantwoorden en curl blijft hangen tot de timeout.
async function draaiPreflight(url: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(PREFLIGHT, ['claude'], {
      env: {
        ...process.env,
        ENSEMBLE_URL: url,
        // Een label dat niet bestaat, zodat een herstartpoging nooit een echte
        // service op deze machine raakt.
        ENSEMBLE_LAUNCHD_LABEL: 'dev.ensemble.test-bestaat-niet',
      },
      encoding: 'utf8',
      timeout: 25000,
    })
    return `${stdout}${stderr}`
  } catch (err: any) {
    return `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
}

describe('preflight gebruikt de health-uitvraag', () => {
  it('meldt de service gezond als de opslag leesbaar is, zonder over leeftijd te beginnen', async () => {
    const url = await nepServer({ status: 'healthy', credentialStore: 'readable', uptimeSeconds: 7200 })
    const uit = await draaiPreflight(url)
    expect(uit).toMatch(/komt bij de credential-opslag/i)
    expect(uit).not.toMatch(/val terug op de leeftijdscheck/i)
  }, 30000)

  it('valt terug op de leeftijdscheck als het veld ontbreekt', async () => {
    const url = await nepServer({ status: 'healthy', version: '1.0.0' })
    const uit = await draaiPreflight(url)
    expect(uit).toMatch(/val terug op de leeftijdscheck/i)
  }, 30000)

  it('grijpt in als de service niet bij de opslag kan', async () => {
    const url = await nepServer({ status: 'healthy', credentialStore: 'unreachable' })
    const uit = await draaiPreflight(url)
    expect(uit).toMatch(/credential-opslag/i)
    expect(uit).not.toMatch(/val terug op de leeftijdscheck/i)
  }, 30000)
})

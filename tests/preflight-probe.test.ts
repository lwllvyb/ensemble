/**
 * De codex-probe mag niet zoeken naar iets dat hij zelf heeft meegestuurd.
 *
 * Tot 20-09-2026 vroeg de prompt letterlijk om de sentinel PROBE-OK-7391 terug
 * te typen, en grepte de check op diezelfde string. Codex echoot elke prompt
 * terug onder het kopje 'user', dus de sentinel stond altijd in de uitvoer.
 * Gemeten met een ingetrokken refresh token: 401 op alles, geen enkel antwoord,
 * en de preflight meldde "Codex works".
 *
 * Deze test controleert de eigenschap die dat onmogelijk maakt: wat de probe
 * zoekt, mag niet in wat de probe stuurt voorkomen. Een eerdere versie telde
 * unieke sentinels, maar de oude code gebruikte twee keer dezelfde string, dus
 * die telling gaf 1 en de test was groen op precies de bug die hij moest vangen.
 */
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-preflight.sh'), 'utf8')

/** De prompttekst die als argument aan `codex exec` meegaat. */
function probePrompt(): string {
  const m = SRC.match(/codex exec[^\n]*\n?\s*"([^"]+)"/)
  if (!m) throw new Error('geen codex exec prompt gevonden in collab-preflight.sh')
  return m[1]
}

/** De string waarop de probe het antwoord herkent. */
function probeNaald(): string {
  const m = SRC.match(/elif ! echo "\$CODEX_PROBE_OUT" \| grep -q "([^"]+)"/)
  if (!m) throw new Error('geen succes-grep gevonden in collab-preflight.sh')
  return m[1]
}

describe('codex-probe', () => {
  it('zoekt niet naar een string die zelf in de prompt staat', () => {
    const prompt = probePrompt()
    const naald = probeNaald()
    expect(
      prompt.includes(naald),
      `de probe grept op "${naald}" terwijl dat in de prompt "${prompt}" staat, dus de prompt-echo matcht altijd`,
    ).toBe(false)
  })

  it('vraagt om een antwoord dat codex moet uitrekenen', () => {
    expect(probePrompt()).toMatch(/\d+\s*(plus|\+)\s*\d+/i)
  })

  it('de gezochte uitkomst klopt met de som die gevraagd wordt', () => {
    const m = probePrompt().match(/(\d+)\s*(?:plus|\+)\s*(\d+)/i)
    expect(m, 'geen som in de prompt gevonden').not.toBeNull()
    const som = Number(m![1]) + Number(m![2])
    expect(probeNaald()).toBe(String(som))
  })
})

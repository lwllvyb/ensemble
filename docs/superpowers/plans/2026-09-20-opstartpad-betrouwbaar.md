# Opstartpad betrouwbaar maken

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een team start betrouwbaar, meldt nooit succes zonder bewijs, raakt nooit een ander team aan, en ruimt zichzelf op.

**Architecture:** Drie gedeelde bouwstenen lossen het grootste deel op. Een sessieregister per team (`$RD/sessions`) maakt van "elke tmux-sessie die op collab lijkt" een expliciete lijst, zodat postcheck, rescue en cleanup alleen hun eigen team aanraken. Een bewijsfunctie (`team_has_evidence`) vervangt elke groene melding die nu op een timer of een aanname leunt. En een gedeelde stopfunctie (`stop_team_processes`) stopt bridge en poller met escalatie van TERM naar KILL, zodat opruimen ook echt opruimt. De rest zijn losse fixes in TypeScript.

**Tech Stack:** bash 3.2 (macOS systeem-bash), python3 voor JSON, TypeScript met vitest, tmux, launchd.

## Global Constraints

- **bash 3.2.** Geen associatieve arrays, geen `mapfile`, geen `${var^^}`. De Mac draait de oude systeem-bash.
- **Nederlands** in nieuwe comments en commits, zoals de rest van de recente code.
- **Geen gedachtestreepjes** in tekst die een mens leest (meldingen, commits, docs). Bestaande regels niet aanpassen tenzij de taak ze toch al raakt.
- **Chirurgisch wijzigen.** Alleen aanraken wat de taak noemt. Geen aangrenzende opmaak of dode code meenemen.
- **Nooit** een sessielink, transcript of verwijzing naar een AI-gesprek in een commit of bestand. De repo is publiek.
- **Runtime-root altijd via `collab-paths.sh`.** Nooit `/tmp/ensemble` hardcoden, anders is het script niet testbaar.
- Testen draaien met `npx vitest run <pad>`, typecheck met `npm run typecheck`.

---

## Fase 0: testbaarheid eerst

Zonder deze taak zijn postcheck en rescue niet te testen, want ze negeren `COLLAB_RUNTIME_ROOT` en schrijven altijd in de echte `/tmp/ensemble`. Alle latere taken in fase 1 leunen hierop.

### Taak 1: postcheck en rescue via de gedeelde padlaag

**Files:**
- Modify: `scripts/collab-postcheck.sh:16`
- Modify: `scripts/collab-rescue.sh:30`
- Test: `tests/collab-runtime-root.test.ts` (nieuw)

**Interfaces:**
- Consumes: `collab_runtime_dir <team-id>` uit `scripts/collab-paths.sh`, die `$COLLAB_RUNTIME_ROOT` respecteert en terugvalt op `/tmp/ensemble`.
- Produces: beide scripts accepteren `COLLAB_RUNTIME_ROOT`, waarmee latere taken ze in een tijdelijke map kunnen testen.

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const POSTCHECK = path.resolve(process.cwd(), 'scripts/collab-postcheck.sh')
const RESCUE = path.resolve(process.cwd(), 'scripts/collab-rescue.sh')

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-root-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

function run(script: string, args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(script, args, {
      env: { ...process.env, COLLAB_RUNTIME_ROOT: root },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { out, code: 0 }
  } catch (err: any) {
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 }
  }
}

describe('runtime root', () => {
  it('postcheck kijkt in COLLAB_RUNTIME_ROOT, niet in /tmp/ensemble', () => {
    fs.mkdirSync(path.join(root, 'team-x'), { recursive: true })
    fs.writeFileSync(path.join(root, 'team-x', 'messages.jsonl'), '')
    const { out } = run(POSTCHECK, ['team-x'])
    expect(out).not.toMatch(/Team not found/i)
  })

  it('rescue kijkt in COLLAB_RUNTIME_ROOT, niet in /tmp/ensemble', () => {
    fs.mkdirSync(path.join(root, 'team-y', 'prompts'), { recursive: true })
    fs.writeFileSync(path.join(root, 'team-y', 'prompts', 'claude-1.txt'), 'hoi')
    const { out } = run(RESCUE, ['team-y'])
    expect(out).not.toMatch(/team-dir bestaat niet/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collab-runtime-root.test.ts`
Expected: FAIL, beide tests melden dat de map niet gevonden is omdat de scripts in `/tmp/ensemble` kijken.

- [ ] **Step 3: Write minimal implementation**

In `scripts/collab-postcheck.sh`, vervang regel 16:

```bash
# was: RD="/tmp/ensemble/$TEAM_ID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=collab-paths.sh
. "$SCRIPT_DIR/collab-paths.sh"
RD="$(collab_runtime_dir "$TEAM_ID")"
```

In `scripts/collab-rescue.sh`, vervang regel 30 met exact hetzelfde blok. Staat er in een van beide al een `SCRIPT_DIR`-regel, hergebruik die dan en voeg alleen de source en de `RD`-toekenning toe.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collab-runtime-root.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/collab-runtime-root.test.ts scripts/collab-postcheck.sh scripts/collab-rescue.sh
git commit -m "fix(collab): postcheck en rescue gingen buiten de gedeelde padlaag om"
```

---

## Fase 1: een team raakt nooit een ander team aan

Drie scripts denken in team-id's maar handelen op wat er toevallig in tmux staat. Dat is de zwaarste klasse fouten in dit pad.

### Taak 2: launch legt vast welke sessies bij het team horen

**Files:**
- Modify: `scripts/collab-launch.sh` (na het spawnen van de agent-sessies)
- Test: `tests/team-sessions.test.ts` (nieuw)

**Interfaces:**
- Produces: `$RUNTIME_DIR/sessions`, één tmux-sessienaam per regel, geschreven vóór de eerste aflevering. Taken 3, 4 en 8 lezen dit bestand.

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const LAUNCH = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-launch.sh'), 'utf8')

describe('sessieregister', () => {
  it('launch schrijft elke gespawnde sessie naar $RUNTIME_DIR/sessions', () => {
    expect(LAUNCH).toMatch(/RUNTIME_DIR\/sessions/)
  })

  it('het register wordt geschreven voor de prompt-aflevering begint', () => {
    const register = LAUNCH.indexOf('$RUNTIME_DIR/sessions')
    const deliver = LAUNCH.search(/prompts\/.*\.txt|deliver_/)
    expect(register).toBeGreaterThan(-1)
    expect(register).toBeLessThan(deliver)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/team-sessions.test.ts`
Expected: FAIL, "sessions" komt niet voor in het script.

- [ ] **Step 3: Write minimal implementation**

In `scripts/collab-launch.sh`, direct na de lus die de agent-sessies aanmaakt en vóór de aflevering:

```bash
# Leg vast welke tmux-sessies bij dit team horen. Postcheck, rescue en cleanup
# lezen dit in plaats van te raden op de vorm van de sessienaam, want daarmee
# grepen ze ook de sessies van andere teams mee.
: > "$RUNTIME_DIR/sessions"
for s in $SPAWNED_SESSIONS; do
  printf '%s\n' "$s" >> "$RUNTIME_DIR/sessions"
done
```

Bestaat `SPAWNED_SESSIONS` nog niet, voeg dan in de spawn-lus toe: `SPAWNED_SESSIONS="$SPAWNED_SESSIONS $SESSION_NAME"`, met `SPAWNED_SESSIONS=""` vóór de lus.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/team-sessions.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/team-sessions.test.ts scripts/collab-launch.sh
git commit -m "feat(collab): team legt zijn eigen tmux-sessies vast in runtime/sessions"
```

### Taak 3: postcheck kilt alleen zijn eigen sessies

De postcheck haalt nu elke sessie op die op `collab-<cijfers>-<cijfers>-<letters>-<cijfer>` lijkt en kilt bij een fout die hele lijst. Draaien er twee teams, dan sloopt het ene het andere. De comment op regel 50-52 belooft al dat andere teams worden overgeslagen, en `AGENT_NAME="${s##*-collab-*-}"` staat er met de aantekening "imperfect, best effort" maar wordt nergens gelezen.

**Files:**
- Modify: `scripts/collab-postcheck.sh:34-46` en `:81`
- Test: `tests/postcheck-scope.test.ts` (nieuw)

**Interfaces:**
- Consumes: `$RD/sessions` uit taak 2.

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const POSTCHECK = path.resolve(process.cwd(), 'scripts/collab-postcheck.sh')
let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-pc-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

describe('postcheck scope', () => {
  it('leest de sessielijst van het team in plaats van tmux te scannen', () => {
    const src = fs.readFileSync(POSTCHECK, 'utf8')
    expect(src).toMatch(/\$RD\/sessions/)
    expect(src).not.toMatch(/tmux ls .*grep -oE "\^collab-/)
  })

  it('raakt geen sessies aan die niet in het register staan', () => {
    const dir = path.join(root, 'team-a')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'sessions'), 'collab-1-1-claude-1\n')
    fs.writeFileSync(path.join(dir, 'messages.jsonl'), '')
    const out = execFileSync(POSTCHECK, ['team-a'], {
      env: { ...process.env, COLLAB_RUNTIME_ROOT: root, COLLAB_POSTCHECK_WAIT: '0' },
      encoding: 'utf8',
    })
    expect(out).not.toMatch(/collab-2-2-codex-1/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/postcheck-scope.test.ts`
Expected: FAIL, het script bevat nog de tmux-scan.

- [ ] **Step 3: Write minimal implementation**

Vervang in `scripts/collab-postcheck.sh` het blok op regel 34-38:

```bash
# Alleen de sessies van dit team. Eerder stond hier een tmux-scan op de vorm van
# de sessienaam, waardoor een fout in team A alle sessies van team B meenam.
if [ -f "$RD/sessions" ]; then
  SESSIONS=$(cat "$RD/sessions")
else
  echo -e "${YEL}!${R} Geen sessieregister voor $TEAM_ID (ouder team?), postcheck slaat over"
  exit 0
fi
if [ -z "$SESSIONS" ]; then
  echo -e "${YEL}!${R} Sessieregister is leeg, niets te controleren"
  exit 0
fi
```

Verwijder de regel `AGENT_NAME="${s##*-collab-*-}"  # imperfect — best effort` en de twee commentregels erboven die beloven wat de code niet deed. De kill-lus op regel 81 kan blijven staan: die loopt nu over de juiste lijst.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/postcheck-scope.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/postcheck-scope.test.ts scripts/collab-postcheck.sh
git commit -m "fix(postcheck): kilde alle collab-sessies in plaats van alleen die van het team"
```

### Taak 4: rescue levert af in het team dat je vraagt

`TEAM_ID` bepaalt nu alleen waar de prompts vandaan komen. De tmux-basis is de eerste sessie die een `-codex-1` heeft, zonder enige vergelijking met het gevraagde id. Gevolg: `collab-rescue.sh Y` plakt de prompts van Y in de panes van X. En omdat de zoeklus specifiek naar `codex-1` kijkt, weigert rescue volledig bij een team zonder codex, wat precies het geval is dat het noodpad zou moeten redden.

**Files:**
- Modify: `scripts/collab-rescue.sh:44-53` en `:110-116`
- Test: `tests/rescue-scope.test.ts` (nieuw)

**Interfaces:**
- Consumes: `$RD/sessions` uit taak 2.

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const RESCUE = path.resolve(process.cwd(), 'scripts/collab-rescue.sh')
let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-rs-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

describe('rescue scope', () => {
  it('gebruikt het sessieregister en niet de eerste codex-sessie in tmux', () => {
    const src = fs.readFileSync(RESCUE, 'utf8')
    expect(src).toMatch(/\$RD\/sessions/)
    expect(src).not.toMatch(/\$\{s\}-codex-1/)
  })

  it('werkt voor een team zonder codex', () => {
    const dir = path.join(root, 'team-c', 'prompts')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'claude-1.txt'), 'hoi')
    fs.writeFileSync(path.join(root, 'team-c', 'sessions'), 'collab-9-9-claude-1\n')
    let out = ''
    try {
      out = execFileSync(RESCUE, ['team-c'], {
        env: { ...process.env, COLLAB_RUNTIME_ROOT: root },
        encoding: 'utf8',
      })
    } catch (err: any) {
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    expect(out).not.toMatch(/geen actieve tmux collab-sessie/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rescue-scope.test.ts`
Expected: FAIL, het script zoekt nog naar `${s}-codex-1`.

- [ ] **Step 3: Write minimal implementation**

Vervang in `scripts/collab-rescue.sh` de zoeklus op regel 44-53:

```bash
# De sessies van dit team staan in het register dat launch schrijft. Hiervoor
# pakte rescue de eerste tmux-sessie met een codex-1 erin, dus de prompts van
# dit team belandden in de panes van een ander team. En een team zonder codex
# werd nooit gevonden, precies het geval waarvoor rescue bedoeld is.
if [ ! -f "$RD/sessions" ]; then
  echo "FOUT: geen sessieregister voor $TEAM_ID; dit team is niet door deze launcher gestart" >&2
  exit 1
fi
```

Vervang de afleverlus op regel 110-116:

```bash
echo "=== prompt-injectie ==="
while IFS= read -r SESSION; do
  [ -n "$SESSION" ] || continue
  AGENT_NAME="${SESSION##*-}"
  PROMPT_FILE="$RD/prompts/$(basename "$SESSION" | sed 's/^.*-\([a-z]*-[0-9]*\)$/\1/').txt"
  [ -f "$PROMPT_FILE" ] || { echo "  $SESSION: geen promptbestand, overgeslagen"; continue; }
  deliver_to_session "$SESSION" "$PROMPT_FILE" "$AGENT_NAME"
done < "$RD/sessions"
```

Verwijder de regels die `TEAMNAME` zetten en afdrukken, die variabele bestaat niet meer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rescue-scope.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/rescue-scope.test.ts scripts/collab-rescue.sh
git commit -m "fix(rescue): leverde af in het eerste team met codex in plaats van het gevraagde team"
```

### Taak 5: preflight kilt de tmux-server niet onder draaiende teams vandaan

Bij een stale DNS-resolver doet preflight `tmux kill-server`, met als enige rem `tmux list-clients`. Dat telt alleen attached clients, en agent-panes draaien detached. Een draaiend team wordt dus zonder waarschuwing gesloopt, waarna het script meldt dat nieuwe spawns een frisse resolver krijgen.

**Files:**
- Modify: `scripts/collab-preflight.sh:178-186`
- Test: `tests/preflight-killserver.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-preflight.sh'), 'utf8')

describe('preflight kill-server', () => {
  it('weigert kill-server zolang er collab-sessies draaien', () => {
    const blok = SRC.slice(SRC.indexOf('TMUX DNS resolver stale'), SRC.indexOf('TMUX DNS probe inconclusive'))
    expect(blok).toMatch(/collab-/)
    expect(blok).toMatch(/kill-server/)
    const killIndex = blok.indexOf('tmux kill-server')
    const guardIndex = blok.search(/COLLAB_SESSIONS|collab-\*/)
    expect(guardIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(killIndex)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/preflight-killserver.test.ts`
Expected: FAIL, er staat geen controle op collab-sessies vóór de kill.

- [ ] **Step 3: Write minimal implementation**

Voeg in `scripts/collab-preflight.sh` vlak vóór `tmux kill-server` toe:

```bash
  # list-clients telt alleen attached clients, en agent-panes draaien detached.
  # Zonder deze controle sloopt een nieuwe collab de panes van een team dat
  # gewoon aan het werk is.
  COLLAB_SESSIONS=$(tmux ls 2>/dev/null | grep -c '^collab-' || true)
  if [ "${COLLAB_SESSIONS:-0}" -gt 0 ]; then
    fail 5 "TMUX DNS is stale, maar er draaien $COLLAB_SESSIONS collab-sessies.
     Die zouden door een kill-server verdwijnen. Rond die teams eerst af, of draai
     zelf: tmux kill-server"
  fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/preflight-killserver.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add tests/preflight-killserver.test.ts scripts/collab-preflight.sh
git commit -m "fix(preflight): kill-server sloopte draaiende teams, want detached panes tellen niet als client"
```

---

## Fase 2: nooit groen zonder bewijs

### Taak 6: de codex-probe vraagt iets dat niet in de prompt staat

De probe grept op `PROBE-OK-7391` in de hele uitvoer van `codex exec`, terwijl codex elke prompt terugechoot onder het kopje `user`. De sentinel staat er dus altijd in. Bewezen met een ingetrokken token: 401 op alles, en toch groen.

**Files:**
- Modify: `scripts/collab-preflight.sh:235-250`
- Test: `tests/preflight-probe.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-preflight.sh'), 'utf8')

describe('codex-probe', () => {
  it('zoekt niet naar een string die zelf in de prompt staat', () => {
    const probe = SRC.slice(SRC.indexOf('codex exec'), SRC.indexOf('codex exec') + 900)
    const sentinels = probe.match(/PROBE-OK-\d+/g) ?? []
    const uniek = new Set(sentinels)
    expect(uniek.size, 'dezelfde sentinel in prompt en grep betekent dat de echo hem matcht').toBeLessThan(2)
  })

  it('vraagt om een berekend antwoord', () => {
    const probe = SRC.slice(SRC.indexOf('codex exec') - 400, SRC.indexOf('codex exec') + 900)
    expect(probe).toMatch(/7391\s*\+\s*1|som|bereken/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/preflight-probe.test.ts`
Expected: FAIL, prompt en grep gebruiken dezelfde string.

- [ ] **Step 3: Write minimal implementation**

Vervang de probe. De prompt vraagt om een som, de grep zoekt de uitkomst, die nergens in de prompt voorkomt:

```bash
# Vraag om een antwoord dat codex moet uitrekenen. Hiervoor stond de sentinel
# zelf in de prompt, en omdat codex elke prompt terugechoot onder 'user' stond
# de string altijd in de uitvoer: een dode codex met een ingetrokken token gaf
# net zo goed groen licht.
CODEX_PROBE_OUT=$(timeout 30 codex exec "Antwoord met het resultaat van 7391 plus 1. Alleen het getal." </dev/null 2>&1 || true)
if printf '%s' "$CODEX_PROBE_OUT" | grep -q '7392'; then
  ok "Codex works (probe computed the answer)"
else
  fail 4 "Codex antwoordde niet met de uitkomst van de probe.
     Laatste regels: $(printf '%s' "$CODEX_PROBE_OUT" | tail -3)"
fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/preflight-probe.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/preflight-probe.test.ts scripts/collab-preflight.sh
git commit -m "fix(preflight): codex-probe matchte op de prompt-echo en keurde een dode codex goed"
```

### Taak 7: "Team is live" alleen bij bewijs

Launch wacht 12 seconden, ziet nul berichten, schrijft "Agents warming up" en meldt daarna alsnog "Team is live!". De postcheck concludeert later "agents may be in deep work", wat een lege pane niet is.

**Files:**
- Modify: `scripts/collab-launch.sh:236-276`
- Modify: `scripts/collab-postcheck.sh:90-91`
- Test: `tests/launch-evidence.test.ts` (nieuw)

**Interfaces:**
- Produces: `team_has_evidence <runtime-dir>` in `scripts/collab-paths.sh`, gebruikt door launch en postcheck. Geeft 0 als er minstens één regel in `messages.jsonl` staat of een pane niet-leeg is, anders 1.

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-ev-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

function evidence(dir: string): number {
  const paths = path.resolve(process.cwd(), 'scripts/collab-paths.sh')
  try {
    execFileSync('bash', ['-c', `. "${paths}" && team_has_evidence "${dir}"`], { encoding: 'utf8' })
    return 0
  } catch (err: any) {
    return err.status ?? 1
  }
}

describe('team_has_evidence', () => {
  it('is onwaar bij een lege messages.jsonl', () => {
    const dir = path.join(root, 'leeg')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'messages.jsonl'), '')
    expect(evidence(dir)).toBe(1)
  })

  it('is waar zodra er een bericht staat', () => {
    const dir = path.join(root, 'vol')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'messages.jsonl'), '{"from":"claude-1"}\n')
    expect(evidence(dir)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/launch-evidence.test.ts`
Expected: FAIL, `team_has_evidence: command not found`.

- [ ] **Step 3: Write minimal implementation**

Voeg toe aan `scripts/collab-paths.sh`:

```bash
# Bewijs dat een team echt leeft: minstens één regel in messages.jsonl.
# Zonder deze functie meldde launch "Team is live!" terwijl hij net zelf had
# vastgesteld dat er nul berichten waren.
team_has_evidence() {
  local rd="$1"
  [ -s "$rd/messages.jsonl" ]
}
```

Vervang in `scripts/collab-launch.sh` het blok dat "Team is live!" afdrukt:

```bash
if team_has_evidence "$RUNTIME_DIR"; then
  echo -e "${BD}${GRN}Team is live!${R}"
else
  echo -e "${BD}${YEL}Team gestart, maar nog geen enkel bericht na ${WAIT}s.${R}" >&2
  echo -e "  Dat is hetzelfde beeld als een prompt die de TUI niet heeft gehaald." >&2
  echo -e "  Controleer met: tmux attach -t \$(head -1 "$RUNTIME_DIR/sessions")" >&2
  echo -e "  Opnieuw afleveren: scripts/collab-rescue.sh $TEAM_ID" >&2
  exit 3
fi
```

Vervang in `scripts/collab-postcheck.sh` de melding bij nul berichten:

```bash
if [ "$MSG_COUNT" -eq 0 ]; then
  echo -e "${RED}✗${R} Nul berichten na ${WAIT}s. Dat is geen diep werk maar een team dat niets doet." >&2
  echo -e "  Opnieuw afleveren: scripts/collab-rescue.sh $TEAM_ID" >&2
  exit 2
fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/launch-evidence.test.ts && npx vitest run tests/ensemble.test.ts`
Expected: PASS, beide bestanden groen.

- [ ] **Step 5: Commit**

```bash
git add tests/launch-evidence.test.ts scripts/collab-paths.sh scripts/collab-launch.sh scripts/collab-postcheck.sh
git commit -m "fix(collab): team meldde zich live terwijl het nul berichten had"
```

### Taak 8: bridge en poller melden pas succes als ze draaien

Launch start beide met `nohup ... &` en zet er meteen een vinkje achter. Een bridge die direct op zijn health check stukloopt, ziet niemand.

**Files:**
- Modify: `scripts/collab-launch.sh:137-138` en `:234`
- Test: `tests/launch-bridge-alive.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-launch.sh'), 'utf8')

describe('bridge-start', () => {
  it('controleert met kill -0 of het proces nog leeft voor het vinkje', () => {
    const blok = SRC.slice(SRC.indexOf('ensemble-bridge.sh'), SRC.indexOf('ensemble-bridge.sh') + 700)
    expect(blok).toMatch(/kill -0/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/launch-bridge-alive.test.ts`
Expected: FAIL, geen `kill -0` in het blok.

- [ ] **Step 3: Write minimal implementation**

Na het starten van de bridge:

```bash
# Even kijken of hij het overleeft. Hiervoor kwam het vinkje er altijd, ook als
# de bridge meteen stuksloeg op zijn health check en het team dus nooit een
# bericht naar de API zou sturen.
sleep 0.3
BRIDGE_PID=$(cat "$RUNTIME_DIR/bridge.pid" 2>/dev/null || echo "")
if [ -n "$BRIDGE_PID" ] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
  echo -e "  ${CHECK} Bridge started ${D}(pid $BRIDGE_PID)${R}"
else
  echo -e "  ${RED}✗${R} Bridge stopte direct, zie /tmp/ensemble-bridge-$TEAM_ID.log" >&2
  exit 4
fi
```

Doe hetzelfde voor de poller op regel 234, met `poller.pid` en de bijbehorende melding.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/launch-bridge-alive.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add tests/launch-bridge-alive.test.ts scripts/collab-launch.sh
git commit -m "fix(launch): bridge en poller kregen een vinkje zonder dat iemand keek of ze leefden"
```

### Taak 9: team-read faalt luid

`curl -sf ... | python3 ... 2>/dev/null` zonder `set -e`. Server weg of kapotte JSON geeft een lege feed en exit 0, en de agent concludeert dat er niets gezegd is.

**Files:**
- Modify: `scripts/team-read.sh:5-9`
- Test: `tests/team-read.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import path from 'path'
import { execFileSync } from 'child_process'
import { describe, expect, it } from 'vitest'

const READ = path.resolve(process.cwd(), 'scripts/team-read.sh')

describe('team-read', () => {
  it('geeft een niet-nul exitcode als de API onbereikbaar is', () => {
    let code = 0
    try {
      execFileSync(READ, ['team-x'], {
        env: { ...process.env, ENSEMBLE_API: 'http://127.0.0.1:1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err: any) {
      code = err.status ?? 1
    }
    expect(code).not.toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/team-read.test.ts`
Expected: FAIL, exitcode is 0.

- [ ] **Step 3: Write minimal implementation**

```bash
set -euo pipefail

RESPONSE=$(curl -sf "$API/api/ensemble/teams/$TEAM_ID/feed") || {
  echo "team-read: API niet bereikbaar op $API" >&2
  exit 1
}
printf '%s' "$RESPONSE" | python3 "$SCRIPT_DIR/parse-messages.py" || {
  echo "team-read: antwoord van de API was geen bruikbare JSON" >&2
  exit 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/team-read.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add tests/team-read.test.ts scripts/team-read.sh
git commit -m "fix(team-read): lege feed bij een dode API zag eruit als stilte"
```

---

## Fase 3: opruimen ruimt echt op

### Taak 10: bridge en poller stoppen op SIGTERM

47 runtime-mappen, 28 zonder `.finished`, een bridge die 2 dagen doorliep, en een gewone `kill` die niets deed.

**Files:**
- Modify: `scripts/ensemble-bridge.sh`, `scripts/collab-poller.sh`
- Test: `tests/signal-handling.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import { spawn } from 'child_process'
import path from 'path'
import { describe, expect, it } from 'vitest'

function stopsOnTerm(script: string): Promise<boolean> {
  return new Promise(resolve => {
    const p = spawn(path.resolve(process.cwd(), script), ['team-x'], { stdio: 'ignore' })
    setTimeout(() => p.kill('SIGTERM'), 500)
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(false) }, 3000)
    p.on('exit', () => { clearTimeout(timer); resolve(true) })
  })
}

describe('signaalafhandeling', () => {
  it('bridge stopt op SIGTERM', async () => {
    expect(await stopsOnTerm('scripts/ensemble-bridge.sh')).toBe(true)
  }, 10000)

  it('poller stopt op SIGTERM', async () => {
    expect(await stopsOnTerm('scripts/collab-poller.sh')).toBe(true)
  }, 10000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/signal-handling.test.ts`
Expected: FAIL, beide blijven draaien tot de SIGKILL.

- [ ] **Step 3: Write minimal implementation**

Bovenaan beide scripts, na de `set`-regel:

```bash
# Zonder deze trap negeert de lus een gewone kill: de sleep loopt door en de
# subshell krijgt het signaal niet. Daardoor bleven er bridges dagenlang staan.
STOPPEN=0
trap 'STOPPEN=1' TERM INT
```

En in de hoofdlus, direct na elke `sleep`:

```bash
  [ "$STOPPEN" -eq 1 ] && { echo "[$(basename "$0")] gestopt op signaal" >&2; exit 0; }
```

Vervang elke `sleep N` in de lus door `sleep N & wait $!`, zodat het signaal de sleep onderbreekt in plaats van erop te wachten.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/signal-handling.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/signal-handling.test.ts scripts/ensemble-bridge.sh scripts/collab-poller.sh
git commit -m "fix(runtime): bridge en poller negeerden SIGTERM en bleven dagen draaien"
```

### Taak 11: cleanup stopt processen voordat het mappen weggooit

Cleanup verwijdert mappen maar stuurt nooit een signaal naar `bridge.pid` of `poller.pid`. Mappen mét `messages.jsonl` en zonder `.finished` blijven bovendien altijd staan, wat precies de 28 wezen verklaart.

**Files:**
- Modify: `scripts/collab-cleanup.sh:73-84`, `:167-168`, `:195-196`
- Modify: `scripts/collab-paths.sh` (nieuwe functie)
- Test: `tests/collab-cleanup.test.ts` (bestaand, uitbreiden)

**Interfaces:**
- Produces: `stop_team_processes <runtime-dir>` in `collab-paths.sh`. Stuurt TERM naar de pids uit `bridge.pid` en `poller.pid`, wacht tot 2 seconden, escaleert naar KILL, en verwijdert de pid-bestanden. Ook gebruikt door taak 12.

- [ ] **Step 1: Write the failing test**

Voeg toe aan `tests/collab-cleanup.test.ts`:

```typescript
it('stopt het bridge-proces voordat de map verdwijnt', () => {
  const dir = makeDir(root, 'team-live', { 'messages.jsonl': '{}\n' }, true)
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  fs.writeFileSync(path.join(dir, 'bridge.pid'), String(child.pid))
  run(root, '--force')
  let leeft = true
  try { process.kill(child.pid!, 0) } catch { leeft = false }
  expect(leeft, 'bridge moet gestopt zijn').toBe(false)
})
```

Voeg bovenaan het bestand `import { spawn } from 'child_process'` toe.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collab-cleanup.test.ts`
Expected: FAIL, het proces leeft nog.

- [ ] **Step 3: Write minimal implementation**

In `scripts/collab-paths.sh`:

```bash
# Stop de achtergrondprocessen van een team. Cleanup gooide alleen de map weg,
# waarna de bridge doorliep zonder map: dagenlang, in een lus die nooit eindigt.
stop_team_processes() {
  local rd="$1" naam pid wacht
  for naam in bridge poller; do
    [ -f "$rd/$naam.pid" ] || continue
    pid=$(cat "$rd/$naam.pid" 2>/dev/null)
    case "$pid" in ''|*[!0-9]*) rm -f "$rd/$naam.pid"; continue ;; esac
    kill "$pid" 2>/dev/null || true
    wacht=0
    while [ "$wacht" -lt 20 ] && kill -0 "$pid" 2>/dev/null; do
      sleep 0.1
      wacht=$((wacht + 1))
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    rm -f "$rd/$naam.pid"
  done
}
```

In `scripts/collab-cleanup.sh`, direct vóór elke `rm -rf` van een runtime-map:

```bash
  stop_team_processes "$dir"
```

Breid de abandoned-definitie uit: een map zonder `.finished` waarvan de pids niet meer leven en die ouder is dan de drempel, telt ook als verlaten.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collab-cleanup.test.ts`
Expected: PASS, alle tests inclusief de nieuwe.

- [ ] **Step 5: Commit**

```bash
git add tests/collab-cleanup.test.ts scripts/collab-paths.sh scripts/collab-cleanup.sh
git commit -m "fix(cleanup): mappen werden opgeruimd maar de processen bleven draaien"
```

### Taak 12: cleanupStaleTeams ruimt echt op

Deze functie draait bij elke service-start en zet elk team ouder dan 2 uur op `disbanded`, zonder sessies te killen of de poller te stoppen. Daarna slaan de watchdog en `checkIdleTeams()` het team voorgoed over, want die filteren op `status === 'active'`. Dat is een tweede bron van dezelfde wezen.

**Files:**
- Modify: `services/ensemble-service.ts:218-238`
- Test: `tests/ensemble.test.ts` (bestaand, uitbreiden)

- [ ] **Step 1: Write the failing test**

```typescript
it('cleanupStaleTeams stopt de processen van het team dat het opruimt', async () => {
  const team = maakTeam({ status: 'active', createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() })
  const gestopt: string[] = []
  const service = new EnsembleService({
    loadTeams: () => [team],
    updateTeam: () => {},
    stopTeamProcesses: (id: string) => { gestopt.push(id) },
  } as any)
  expect(gestopt).toContain(team.id)
})
```

Pas `maakTeam` aan de bestaande helper in dit bestand aan als die anders heet.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ensemble.test.ts -t cleanupStaleTeams`
Expected: FAIL, `stopTeamProcesses` wordt nooit aangeroepen.

- [ ] **Step 3: Write minimal implementation**

In `cleanupStaleTeams()`, vóór de `updateTeam`-aanroep:

```typescript
        // Een team dat op disbanded gaat zonder dat zijn processen stoppen, wordt
        // daarna door de watchdog en checkIdleTeams overgeslagen omdat die op
        // status 'active' filteren. De tmux-sessies en de poller blijven dan voor
        // altijd draaien.
        this.stopTeamProcesses(team.id)
```

Implementeer `stopTeamProcesses(teamId)` als een methode die `scripts/collab-cleanup.sh` niet nodig heeft: kill de sessies uit `$RD/sessions` via `tmux kill-session` en roep de bash-functie `stop_team_processes` aan met `execFileSync('bash', ['-c', `. scripts/collab-paths.sh && stop_team_processes "${rd}"`])`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ensemble.test.ts && npm run typecheck`
Expected: PASS en geen typefouten.

- [ ] **Step 5: Commit**

```bash
git add tests/ensemble.test.ts services/ensemble-service.ts
git commit -m "fix(service): stale teams gingen op disbanded terwijl hun processen doorliepen"
```

---

## Fase 4: geen bericht raakt zoek

### Taak 13: de bridge retryt een 429

`400 <= e.code < 500` zet `success = True` en slaat de regel permanent over. Een rate limit of een timeout betekent dus een verloren bericht. Let op de volgorde: taak 16 zet rate limiting weer aan, dus deze taak moet daarvóór.

**Files:**
- Modify: `scripts/ensemble-bridge.sh:133-137`
- Test: `tests/bridge-retry.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/ensemble-bridge.sh'), 'utf8')

describe('bridge retry', () => {
  it('behandelt 429 en 408 als tijdelijk', () => {
    expect(SRC).toMatch(/429/)
    expect(SRC).not.toMatch(/400 <= e\.code < 500:\s*\n\s*print.*skipping/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge-retry.test.ts`
Expected: FAIL, 429 komt niet voor.

- [ ] **Step 3: Write minimal implementation**

```python
            except urllib.error.HTTPError as e:
                # 429 en 408 zijn tijdelijk. Die vielen hiervoor onder "client error,
                # permanent overslaan", waardoor een bericht bij een rate limit
                # definitief verdween.
                if e.code in (408, 429):
                    delay = min(30.0, 0.5 * (2 ** attempt))
                    print(f'[bridge] {e.code} on line {i}, retry {attempt+1}/10 in {delay:.1f}s', file=sys.stderr, flush=True)
                    if attempt == 9:
                        break
                    time.sleep(delay)
                    continue
                if 400 <= e.code < 500:
                    print(f'[bridge] client error {e.code} on line {i}, skipping: {e}', file=sys.stderr, flush=True)
                    success = True
                    break
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bridge-retry.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add tests/bridge-retry.test.ts scripts/ensemble-bridge.sh
git commit -m "fix(bridge): een 429 gold als permanent en het bericht verdween"
```

### Taak 14: de paste-retry levert niet dubbel af

De retry-lus omvat het plakken én de twee Enters erna. Faalt alleen die laatste Enter, dan wordt de hele prompt opnieuw geplakt.

**Files:**
- Modify: `lib/agent-runtime.ts:249-262`
- Test: `tests/agent-runtime-paste.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest'

describe('pasteFromFile', () => {
  it('plakt niet opnieuw als alleen de Enter faalt', async () => {
    const calls: string[] = []
    const exec = vi.fn(async (cmd: string) => {
      calls.push(cmd)
      if (cmd.includes('send-keys') && calls.filter(c => c.includes('send-keys')).length === 1) {
        throw new Error('tmux busy')
      }
    })
    const { pasteFromFile } = await import('../lib/agent-runtime')
    await pasteFromFile('sess', '/tmp/x.txt', { exec } as any)
    expect(calls.filter(c => c.includes('paste-buffer')).length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent-runtime-paste.test.ts`
Expected: FAIL, paste-buffer wordt twee keer aangeroepen.

- [ ] **Step 3: Write minimal implementation**

Splits de lus: retry alleen het plakken, en daarna een eigen lus voor de Enters.

```typescript
    let lastErr: unknown
    let geplakt = false
    for (let attempt = 1; attempt <= 3 && !geplakt; attempt++) {
      try {
        await execAsync(cmd, { shell: '/bin/bash' })
        geplakt = true
      } catch (err) {
        lastErr = err
        if (attempt < 3) await new Promise(r => setTimeout(r, 200 * 2 ** (attempt - 1)))
      }
    }
    if (!geplakt) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))

    // De Enters apart, want opnieuw plakken na een geslaagde paste levert de
    // prompt een tweede keer af in dezelfde pane.
    await new Promise(r => setTimeout(r, 1000))
    for (const wacht of [0, 300]) {
      if (wacht) await new Promise(r => setTimeout(r, wacht))
      try {
        await execAsync(`tmux send-keys -t "${sName}" Enter`)
      } catch (err) {
        console.error(`[runtime] Enter naar ${sName} mislukte:`, err)
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent-runtime-paste.test.ts && npm run typecheck`
Expected: PASS en geen typefouten.

- [ ] **Step 5: Commit**

```bash
git add tests/agent-runtime-paste.test.ts lib/agent-runtime.ts
git commit -m "fix(runtime): een mislukte Enter liet de hele prompt opnieuw plakken"
```

### Taak 15: de .completed-uitzondering werkt

De negatieve lookbehind staat vóór de boundary-groep, die de punt zelf opsnoept. `task.completed` matcht dus nog steeds en kan auto-disband triggeren.

**Files:**
- Modify: `services/ensemble-service.ts:67`
- Test: `tests/premature-disband.test.ts` (bestaand, uitbreiden)

- [ ] **Step 1: Write the failing test**

```typescript
it('een property met .completed is geen afrondingssignaal', () => {
  expect(isCompletionStatement('ik kijk naar promise.completed in de logs')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/premature-disband.test.ts`
Expected: FAIL, geeft true.

- [ ] **Step 3: Write minimal implementation**

```typescript
  // De punt hoort in de boundary-groep zelf, anders kijkt de lookbehind naar het
  // teken vóór de punt en doet de uitzondering niets.
  /(?:^|[^\p{L}\p{N}_.])completed(?:[^\p{L}\p{N}_]|$)/iu,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/premature-disband.test.ts`
Expected: PASS, alle tests.

- [ ] **Step 5: Commit**

```bash
git add tests/premature-disband.test.ts services/ensemble-service.ts
git commit -m "fix(service): de uitzondering voor .completed stond op de verkeerde plek"
```

### Taak 16: rate limiting geldt weer

`path.startsWith('/api/ensemble/')` matcht elke route die de server heeft, dus de limiet van 100 per minuut is dode code. Taak 13 moet af zijn, anders verdwijnen berichten zodra dit weer aanstaat.

**Files:**
- Modify: `server.ts:130-134`
- Test: `tests/ensemble.test.ts` (bestaand, uitbreiden)

- [ ] **Step 1: Write the failing test**

```typescript
it('de teams-route is niet vrijgesteld van rate limiting', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8')
  expect(src).not.toMatch(/startsWith\('\/api\/ensemble\/'\)/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ensemble.test.ts -t "rate limiting"`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
    // Hier stond een uitzondering op '/api/ensemble/', wat elke route is die deze
    // server heeft. De limiet stond daarmee volledig uit. Alleen de feed van een
    // lopend team blijft vrij, want de agents pollen die zelf.
    const isFeedPoll = method === 'GET' && /^\/api\/ensemble\/teams\/[^/]+\/feed$/.test(path)
    if (!isFeedPoll && isRateLimited(getClientIp(req))) {
      return json(res, { error: 'Rate limit exceeded' }, 429, origin)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ensemble.test.ts && npm run typecheck`
Expected: PASS en geen typefouten.

- [ ] **Step 5: Commit**

```bash
git add tests/ensemble.test.ts server.ts
git commit -m "fix(server): de uitzondering op rate limiting dekte elke route"
```

### Taak 17: de export bij disband kan de service niet neerhalen

`void exportObservation(...).then(...)` zonder `.catch()`. Gooit `appendMessage()` daarbinnen, dan is het een unhandled rejection en stopt het proces.

**Files:**
- Modify: `services/ensemble-service.ts:1201-1222`
- Test: `tests/memory-export.test.ts` (bestaand, uitbreiden)

- [ ] **Step 1: Write the failing test**

```typescript
it('een fout in de afhandeling van de export blijft binnen de handler', async () => {
  const boom = () => { throw new Error('schijf vol') }
  await expect(
    afhandelenExport(Promise.resolve({ ok: false }), boom),
  ).resolves.toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/memory-export.test.ts`
Expected: FAIL, de fout ontsnapt.

- [ ] **Step 3: Write minimal implementation**

```typescript
      void exportObservation(payload)
        .then(result => { /* bestaande afhandeling ongewijzigd */ })
        .catch(err => {
          // exportObservation gooit zelf nooit, maar appendMessage in de handler
          // wel. Zonder deze catch is dat een unhandled rejection, en die haalt
          // met de standaardinstelling van Node het hele proces neer.
          console.error('[Ensemble] Afhandeling van de memory-export mislukte:', err)
        })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/memory-export.test.ts && npm run typecheck`
Expected: PASS en geen typefouten.

- [ ] **Step 5: Commit**

```bash
git add tests/memory-export.test.ts services/ensemble-service.ts
git commit -m "fix(service): een schijffout bij het exporteren kon de service neerhalen"
```

---

## Fase 5: sneller, en niet meer herstarten zonder reden

### Taak 18: de server wordt beoordeeld op gezondheid, niet op leeftijd

Dit is de directe aanleiding voor "moet die server nou echt telkens herstart worden". Nee. De leeftijdscheck is een proxy voor de vraag die er werkelijk toe doet: is deze server gestart met werkende credentials. Een server die 30 uur draait en prima werkt, herstarten kost tijd en levert niets op. Een server die na 10 minuten al zonder credentials draait, glipt er nu juist doorheen.

**Files:**
- Modify: `scripts/collab-preflight.sh:69-122`
- Modify: `server.ts` (health-endpoint uitbreiden)
- Test: `tests/service-health.test.ts` (nieuw)

**Interfaces:**
- Produces: `/api/v1/health` geeft `{ status, version, credentials: 'ok' | 'missing', uptimeSeconds }`. De preflight herstart alleen bij `credentials: 'missing'`.

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

describe('service-gezondheid', () => {
  it('health meldt of de credentials bruikbaar zijn', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8')
    expect(src).toMatch(/credentials/)
  })

  it('preflight herstart op credentials, niet op leeftijd alleen', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-preflight.sh'), 'utf8')
    const blok = src.slice(src.indexOf('Service age'), src.indexOf('TMUX DNS'))
    expect(blok).toMatch(/credentials/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/service-health.test.ts`
Expected: FAIL, `credentials` komt in geen van beide voor.

- [ ] **Step 3: Write minimal implementation**

In `server.ts`, bij het health-endpoint:

```typescript
    if (path === '/api/v1/health') {
      // De preflight herstartte de service ooit puur op leeftijd, als proxy voor
      // "is hij met credentials gestart". Dat herstart een gezonde server en laat
      // een jonge kapotte server door. Hier is het antwoord zelf te halen.
      const credentials = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN
        ? 'ok'
        : 'missing'
      return json(res, {
        status: 'healthy',
        version: '1.0.0',
        credentials,
        uptimeSeconds: Math.round(process.uptime()),
      }, 200, origin)
    }
```

In `scripts/collab-preflight.sh`, vervang de hele leeftijdsvergelijking door:

```bash
HEALTH=$(curl -sf "$API/api/v1/health" 2>/dev/null || echo "")
CREDS=$(printf '%s' "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('credentials','onbekend'))" 2>/dev/null || echo "onbekend")
if [ "$CREDS" = "missing" ]; then
  warn "Service draait zonder credentials, herstarten via launchd ($LAUNCHD_LABEL)"
  # bestaande kickstart-code hier
elif [ "$CREDS" = "ok" ]; then
  UP=$(printf '%s' "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('uptimeSeconds',0))" 2>/dev/null || echo 0)
  ok "Service gezond (draait $((UP / 3600))h, credentials in orde)"
else
  warn "Kon de gezondheid van de service niet uitlezen, val terug op de leeftijdscheck"
  # bestaande leeftijdscode als fallback
fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/service-health.test.ts && npm run typecheck`
Expected: PASS en geen typefouten.

- [ ] **Step 5: Commit**

```bash
git add tests/service-health.test.ts server.ts scripts/collab-preflight.sh
git commit -m "feat(preflight): service wordt beoordeeld op credentials in plaats van op leeftijd"
```

### Taak 19: wachten gaat sneller

De wachtlus slaapt een hele seconde voordat hij voor het eerst kijkt, acht keer achter elkaar. Een server die na 100ms klaar is kost zo altijd minstens een seconde.

**Files:**
- Modify: `scripts/collab-launch.sh:64`
- Test: `tests/launch-wait.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-launch.sh'), 'utf8')

describe('wachtlus', () => {
  it('checkt voordat hij slaapt', () => {
    const lus = SRC.slice(SRC.indexOf('for i in'), SRC.indexOf('for i in') + 320)
    const check = lus.indexOf('curl')
    const slaap = lus.indexOf('sleep')
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(slaap)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/launch-wait.test.ts`
Expected: FAIL, de sleep staat vóór de check.

- [ ] **Step 3: Write minimal implementation**

```bash
# Eerst kijken, dan pas slapen, en in kleinere stappen. Andersom kostte een
# server die na 100ms klaar was altijd minstens een volle seconde.
for i in $(seq 1 40); do
  if curl -sf "$API/api/v1/health" > /dev/null 2>&1; then
    SERVER_OK=1
    break
  fi
  sleep 0.2
done
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/launch-wait.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add tests/launch-wait.test.ts scripts/collab-launch.sh
git commit -m "perf(launch): wachtlus sliep voor hij keek, elke start kostte een seconde extra"
```

---

## Fase 6: hygiëne

### Taak 20: sleutels worden niet meer als toetsaanslagen getypt

`export ${k}="${v}"` zonder escaping, terwijl `shellEscape()` drie regels hoger staat en wel voor het startcommando gebruikt wordt. Gevolg: de API-sleutels staan letterlijk in de scrollback van elke pane.

**Files:**
- Modify: `lib/agent-spawner.ts:83-89`
- Test: `tests/agent-spawner-env.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'lib/agent-spawner.ts'), 'utf8')

describe('env-forwarding', () => {
  it('escapet de waarde', () => {
    expect(SRC).not.toMatch(/export \$\{k\}="\$\{v\}"/)
    expect(SRC).toMatch(/export \$\{k\}=\$\{shellEscape/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent-spawner-env.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```typescript
    .map(([k, v]) => `export ${k}=${shellEscape(v as string)}`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent-spawner-env.test.ts && npm run typecheck`
Expected: PASS en geen typefouten.

- [ ] **Step 5: Commit**

```bash
git add tests/agent-spawner-env.test.ts lib/agent-spawner.ts
git commit -m "fix(spawner): doorgegeven env-waarden werden ongeescaped de pane in getypt"
```

### Taak 21: het geheim van de alert-hub staat niet meer in de argv

`${ALERT_HUB_URL}?key=${...}` gaat als argv naar curl en is daarmee leesbaar in `ps`.

**Files:**
- Modify: `services/ensemble-service.ts:392-401`
- Test: `tests/ensemble.test.ts` (bestaand, uitbreiden)

- [ ] **Step 1: Write the failing test**

```typescript
it('het hub-geheim staat niet in de URL', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'services/ensemble-service.ts'), 'utf8')
  expect(src).not.toMatch(/\?key=\$\{encodeURIComponent\(ALERT_HUB_SECRET\)\}/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ensemble.test.ts -t "hub-geheim"`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Vervang het curl-subproces door de ingebouwde fetch, dan bestaat er geen argv om uit te lezen:

```typescript
      // Het geheim ging als URL-parameter mee in de argv van curl en was daarmee
      // leesbaar in ps voor elke andere gebruiker op de machine.
      void fetch(ALERT_HUB_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Alert-Key': ALERT_HUB_SECRET },
        body: hubPayload,
        signal: AbortSignal.timeout(5000),
      }).catch(err => console.error('[Ensemble] Alert-hub onbereikbaar:', err))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ensemble.test.ts && npm run typecheck`
Expected: PASS en geen typefouten.

- [ ] **Step 5: Commit**

```bash
git add tests/ensemble.test.ts services/ensemble-service.ts
git commit -m "fix(service): het geheim van de alert-hub stond leesbaar in ps"
```

### Taak 22: de transcript-hook slaat geen bestanden over

`for file in $STAGED` zonder quotes, dus een bestandsnaam met een spatie wordt gesplitst en de scan op sessielinks slaat hem over. Gezien waar die hook voor staat, is dat het gat dat je niet wil hebben.

**Files:**
- Modify: `.githooks/pre-commit:36`
- Test: `tests/pre-commit-hook.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), '.githooks/pre-commit'), 'utf8')

describe('pre-commit', () => {
  it('leest de bestandslijst regel voor regel', () => {
    expect(SRC).not.toMatch(/for file in \$STAGED/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pre-commit-hook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```bash
# Regel voor regel, net als de controle hierboven. Met een gewone for-lus
# splitst de shell op spaties en glipt een bestandsnaam met een spatie erin
# ongezien langs deze scan.
while IFS= read -r file; do
  [ -n "$file" ] || continue
  if git show ":$file" 2>/dev/null | grep -qE 'claude\.ai/code/session_[A-Za-z0-9]{10,}'; then
    note "$file contains a claude.ai session link"
  fi
done <<< "$STAGED"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pre-commit-hook.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add tests/pre-commit-hook.test.ts .githooks/pre-commit
git commit -m "fix(hooks): bestandsnamen met een spatie glipten langs de scan op sessielinks"
```

### Taak 23: het dode vangnet weg of echt maken

`park()` schrijft `pending-observation.json` en niets leest het ooit terug, terwijl de melding aan de gebruiker zegt dat de payload bewaard is voor een latere poging. Elke nieuwe mislukking overschrijft bovendien de vorige.

**Files:**
- Modify: `lib/memory-export.ts:108-123`
- Modify: `services/ensemble-service.ts:1219` (de melding)
- Test: `tests/memory-export.test.ts` (bestaand, uitbreiden)

- [ ] **Step 1: Write the failing test**

```typescript
it('een tweede mislukking overschrijft de eerste niet', () => {
  park(dir, { id: 'een' })
  park(dir, { id: 'twee' })
  const bestanden = fs.readdirSync(dir).filter(f => f.startsWith('pending-observation'))
  expect(bestanden.length).toBe(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/memory-export.test.ts`
Expected: FAIL, er is één bestand.

- [ ] **Step 3: Write minimal implementation**

```typescript
export function pendingExportFile(runtimeDir: string): string {
  // Een vaste naam betekende dat de tweede mislukking de eerste overschreef, en
  // niets las het bestand ooit terug. Een unieke naam per poging maakt de map
  // tenminste een eerlijke lijst van wat er niet is aangekomen.
  return path.join(runtimeDir, `pending-observation-${Date.now()}-${process.pid}.json`)
}
```

Pas de melding in `services/ensemble-service.ts` aan naar wat er werkelijk gebeurt: "Payload bewaard in de runtime-map; er is geen automatische nieuwe poging."

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/memory-export.test.ts && npm run typecheck`
Expected: PASS en geen typefouten.

- [ ] **Step 5: Commit**

```bash
git add tests/memory-export.test.ts lib/memory-export.ts services/ensemble-service.ts
git commit -m "fix(export): geparkeerde payloads overschreven elkaar en de melding klopte niet"
```

### Taak 24: één shellEscape

`lib/agent-config.ts:123` en `lib/agent-spawner.ts:38` hebben allebei een `shellEscape` met verschillend gedrag. Na taak 20 hangt de veiligheid van de spawner aan de tweede, dus dit moet er één worden.

**Files:**
- Modify: `lib/agent-spawner.ts:38-40`
- Modify: `lib/agent-config.ts:123-127` (exporteren)
- Test: `tests/agent-config-contract.test.ts` (bestaand, uitbreiden)

- [ ] **Step 1: Write the failing test**

```typescript
it('er is maar één shellEscape in de codebase', () => {
  const spawner = fs.readFileSync(path.resolve(process.cwd(), 'lib/agent-spawner.ts'), 'utf8')
  expect(spawner).not.toMatch(/function shellEscape/)
  expect(spawner).toMatch(/import .*shellEscape.* from '\.\/agent-config'/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent-config-contract.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Exporteer de functie in `lib/agent-config.ts` (`export function shellEscape`), verwijder de kopie uit `lib/agent-spawner.ts` en importeer hem daar. Controleer daarna dat taak 20 nog werkt: de variant in agent-config slaat quoting over voor tokens die al veilig zijn, wat voor env-waarden prima is.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ && npm run typecheck`
Expected: PASS, de hele suite groen.

- [ ] **Step 5: Commit**

```bash
git add tests/agent-config-contract.test.ts lib/agent-config.ts lib/agent-spawner.ts
git commit -m "refactor(lib): twee versies van shellEscape teruggebracht tot een"
```

---

### Taak 25: de agent-override is niet meer globaal

`/tmp/collab-agents-override.txt` en `/tmp/collab-team-id.txt` zijn vaste paden die elke launch deelt. Twee starts binnen een seconde en het ene team krijgt de agents van het andere. Dat versterkt taak 4, want rescue zonder argument pakt dan ook nog het verkeerde id.

**Files:**
- Modify: `scripts/collab-preflight.sh:450-455`
- Modify: `scripts/collab-launch.sh:39-43` en `:130`
- Test: `tests/override-scope.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const PRE = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-preflight.sh'), 'utf8')
const LAUNCH = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-launch.sh'), 'utf8')

describe('override', () => {
  it('gebruikt geen vast pad in /tmp dat elke launch deelt', () => {
    expect(PRE).not.toMatch(/\/tmp\/collab-agents-override\.txt/)
    expect(LAUNCH).not.toMatch(/\/tmp\/collab-team-id\.txt/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/override-scope.test.ts`
Expected: FAIL, beide vaste paden staan er nog.

- [ ] **Step 3: Write minimal implementation**

In `scripts/collab-preflight.sh`, schrijf de override naar een pad dat de aanroeper meegeeft en druk dat pad af op stdout:

```bash
# Een vast pad in /tmp is van iedereen: twee gelijktijdige starts lazen elkaars
# override. De aanroeper bepaalt nu waar het bestand staat.
OVERRIDE_FILE="${COLLAB_OVERRIDE_FILE:-$(mktemp -t collab-agents-override)}"
printf '%s\n' "$AGENTS_FALLBACK" > "$OVERRIDE_FILE"
echo "override_file=$OVERRIDE_FILE"
```

In `scripts/collab-launch.sh`, lees de override alleen uit `$COLLAB_OVERRIDE_FILE` als die gezet is, en schrijf het team-id niet meer naar `/tmp/collab-team-id.txt` maar alleen naar stdout als `TEAM_ID=<id>`, zoals de comment daar al voorstelt.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/override-scope.test.ts && npx vitest run tests/ensemble.test.ts`
Expected: PASS, beide groen.

- [ ] **Step 5: Commit**

```bash
git add tests/override-scope.test.ts scripts/collab-preflight.sh scripts/collab-launch.sh
git commit -m "fix(collab): gedeelde override-bestanden in /tmp lieten teams elkaars agents pakken"
```

### Taak 26: het herdr-vinkje komt pas als de pane-id er is

`collab-launch.sh:182` drukt "Monitor opened" af, en pas op regel 184 wordt geprobeerd de pane-id uit te lezen. Vindt die `sed` niets, dan komt er geen `herdr-pane-id` op schijf en blijft de pane na afloop openstaan, terwijl de gebruiker een vinkje zag.

**Files:**
- Modify: `scripts/collab-launch.sh:181-187`
- Test: `tests/herdr-vinkje.test.ts` (nieuw)

- [ ] **Step 1: Write the failing test**

```typescript
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-launch.sh'), 'utf8')

describe('herdr-monitor', () => {
  it('leest de pane-id voordat het vinkje verschijnt', () => {
    const blok = SRC.slice(SRC.indexOf('open-herdr-monitor.sh'), SRC.indexOf('Falling back to tmux'))
    expect(blok.indexOf('HERDR_PANE=')).toBeLessThan(blok.indexOf('Monitor opened'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/herdr-vinkje.test.ts`
Expected: FAIL, het vinkje staat eerst.

- [ ] **Step 3: Write minimal implementation**

```bash
    HERDR_PANE=$(printf '%s\n' "$HERDR_RESULT" | sed -n 's/.*new_pane_id=\([^ ]*\).*/\1/p' | tail -1)
    if [ -n "$HERDR_PANE" ]; then
      printf '%s\n' "$HERDR_PANE" > "$RUNTIME_DIR/herdr-pane-id"
      echo -e "  ${CHECK} Monitor opened ${D}(herdr ${HERDR_MODE})${R}"
    else
      # Zonder pane-id kan de monitor zijn eigen pane straks niet sluiten, dus dat
      # is geen geslaagde start om een vinkje voor te geven.
      echo -e "  ${YEL}!${R} Monitor gestart maar herdr gaf geen pane-id terug (zie /tmp/collab-herdr-last.log)"
    fi
    MONITOR_MODE="herdr"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/herdr-vinkje.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add tests/herdr-vinkje.test.ts scripts/collab-launch.sh
git commit -m "fix(launch): herdr-vinkje verscheen voordat de pane-id gelezen was"
```

---

## Afsluiten

- [ ] **Volledige suite en typecheck**

Run: `npm run test && npm run typecheck`
Expected: alles groen.

- [ ] **Echte rookproef**

Start een team met twee agents en een opdracht die één antwoord vraagt. Controleer dat `runtime/sessions` bestaat, dat er berichten in `messages.jsonl` komen, dat er geen "Team is live" verschijnt als de pane leeg blijft, en dat na afloop geen bridge of poller meer draait (`ps aux | grep ensemble-bridge`).

- [ ] **Controle op wezen**

Run: `ls /tmp/ensemble | wc -l` vóór en na een volledige cyclus met `scripts/collab-cleanup.sh --force`. Het aantal moet dalen en er mag geen proces overblijven.

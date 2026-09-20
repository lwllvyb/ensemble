import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function render(messages: Array<Record<string, string>>) {
  const payload = JSON.stringify(messages)
  return execFileSync('python3', ['-B', '-c', `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location('generate_replay', 'scripts/generate-replay.py'); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(module.generate_html(json.loads(sys.stdin.read()), 'team', '<task>'))`], {
    cwd: process.cwd(),
    input: payload,
    encoding: 'utf8',
  })
}
function escapedRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('replay HTML', () => {
  it('toont ensemble-servicemeldingen in beide views met dezelfde nadruk als monitor', () => {
    const html = render([
      { from: 'ensemble', content: 'claude-1 (claude -> claude @ local) has joined #collab', timestamp: '2026-09-20T17:59:59Z' },
      { from: 'ensemble', content: '1 agents received their task', timestamp: '2026-09-20T18:00:00Z' },
      { from: 'ensemble', content: 'Watchdog nudged claude-1: Are you still working?', timestamp: '2026-09-20T18:00:01Z' },
      { from: 'ensemble', content: 'Watchdog marked claude-1 as stalled after 180s without progress', timestamp: '2026-09-20T18:00:02Z' },
      { from: 'ensemble', content: 'ordinary service <notice>', timestamp: '2026-09-20T18:00:03Z' },
      { from: 'ensemble', content: '❌ memory-export-failure: <disk>', timestamp: '2026-09-20T18:00:03Z' },
      { from: 'claude-1', content: 'agent message', timestamp: '2026-09-20T18:00:04Z' },
    ])

    for (const [level, content] of [
      ['gray', 'has joined #collab'],
      ['green', 'agents received their task'],
      ['yellow', 'Watchdog nudged claude-1'],
      ['red', 'Watchdog marked claude-1 as stalled'],
      ['gray', 'ordinary service &lt;notice&gt;'],
      ['red', 'memory-export-failure: &lt;disk&gt;'],
    ]) {
      const contentPattern = escapedRegex(content)
      expect(html).toMatch(new RegExp(`<div class="line service service-${level}"[^>]*>(?:(?!<div class=").)*${contentPattern}`))
      expect(html).toMatch(new RegExp(`<div class="m-message m-service service-${level}"[^>]*>(?:(?!<div class="m-message m-service)[\\s\\S])*${contentPattern}`))
    }
    const ircOrder = ['has joined #collab', 'agents received their task', 'Watchdog nudged', 'Watchdog marked', 'ordinary service', 'memory-export-failure'].map((text) => html.indexOf(text))
    expect(ircOrder).toEqual([...ircOrder].sort((a, b) => a - b))
  })

  it('filtert ensemble uit agentstatistieken en escaped taak en agentinhoud', () => {
    const html = render([
      { from: 'ensemble', content: '1 agents received their task', timestamp: '2026-09-20T18:00:00Z' },
      { from: 'codex<script>', content: '<agent>', timestamp: '2026-09-20T18:00:01Z' },
    ])

    expect(html).toContain('1 agents')
    expect(html).toContain('1 msgs')
    expect(html).not.toContain('2 agents')
    expect(html).not.toContain('2 msgs')
    expect(html).toContain('&lt;task&gt;')
    expect(html).toContain('codex&lt;script&gt;')
    expect(html).toContain('&lt;agent&gt;')
  })

  it('laat moderne servicetekst en sterke tekst de servicekleur erven', () => {
    const html = render([{ from: 'ensemble', content: '**Watchdog** service', timestamp: '2026-09-20T18:00:00Z' }])
    expect(html).toContain('body.modern .m-service .m-body, body.modern .m-service .m-body strong { color:inherit; }')
  })
})

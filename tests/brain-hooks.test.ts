import fs from 'fs'
import path from 'path'
import { afterAll, expect, it, vi } from 'vitest'
import { runRoster, runPlan, emitEvent, type BrainEvent } from '../lib/brain-hooks'
import { shellEscape } from '../lib/agent-config'

const root = fs.mkdtempSync(path.resolve('tmp/brain-hooks-'))
const defaults = { fallbackOrder: [], graceMinutes: 3, alertHubUrl: '' }
let sequence = 0
function hook(body: string): string {
  const file = path.join(root, `hook-${sequence++}.sh`)
  fs.writeFileSync(file, body)
  return `/bin/bash ${shellEscape(file)}`
}
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
it('reads a roster with the health schema', async () => {
  const roster = { mimo: { status: 'ok', detail: 'cached' }, codex: { status: 'limit' } }
  expect(await runRoster({ ...defaults, rosterCommand: hook(`test "$#" = 0 || exit 1\nprintf '%s' '${JSON.stringify(roster)}'`) })).toEqual(roster)
})
it('passes the exact task as the only positional argument and ignores extra plan fields', async () => {
  const task = 'Quotes " and $HOME; $(exit 9)\nsecond line'
  const file = path.join(root, 'task')
  const planCommand = hook(`test "$#" = 1 || exit 1\nprintf '%s' "$1" > ${shellEscape(file)}\nprintf '%s' '{"agents":["mimo","codex"],"template":"implement","reason":"capacity","extra":true}'`)
  expect(await runPlan(task, { ...defaults, planCommand })).toEqual({ agents: ['mimo', 'codex'], template: 'implement', reason: 'capacity' })
  expect(fs.readFileSync(file, 'utf8')).toBe(task)
})
it.each(['printf bad', 'printf "[]"', 'exit 7', 'sleep 5'])('contains roster and plan failure: %s', async body => {
  const command = hook(body)
  expect(await runRoster({ ...defaults, rosterCommand: command }, 100)).toBeUndefined()
  expect(await runPlan('task', { ...defaults, planCommand: command }, 100)).toBeUndefined()
})
it.each(['{"a":{"status":"invalid"}}', '{"a":{"status":"ok","detail":1}}', '{"a":null}'])('rejects invalid roster entries: %s', async json => {
  expect(await runRoster({ ...defaults, rosterCommand: hook(`printf '%s' '${json}'`) })).toBeUndefined()
})
it.each(['{"agents":[]}', '{"agents":[1]}', '{"agents":["mimo"],"template":false}'])('rejects invalid plans: %s', async json => {
  expect(await runPlan('task', { ...defaults, planCommand: hook(`printf '%s' '${json}'`) })).toBeUndefined()
})
it('sends one JSON line followed by EOF, without arguments', async () => {
  const file = path.join(root, 'event')
  const event: BrainEvent = { event: 'team_started', teamId: 'alpha', team: 'example', ts: new Date(0).toISOString(), agents: ['mimo'], detail: 'line one\nline two' }
  await emitEvent(event, { ...defaults, eventsCommand: hook(`test "$#" = 0 || exit 1\ncat > ${shellEscape(file)}`) })
  expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify(event) + '\n')
})
it('never throws and warns only once per team across exit and timeout failures', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const event: BrainEvent = { event: 'agent_failed', teamId: 'warning-test', team: 'example', ts: new Date(0).toISOString() }
    for (const body of ['exit 2', 'sleep 5', 'exit 1']) await emitEvent(event, { ...defaults, eventsCommand: hook(body) }, 100)
    expect(warn).toHaveBeenCalledTimes(1)
  } finally { warn.mockRestore() }
})
it('does nothing without configured hooks', async () => {
  expect(await runRoster(defaults)).toBeUndefined()
  expect(await runPlan('task', defaults)).toBeUndefined()
  await expect(emitEvent({ event: 'agent_done', teamId: 'none', team: 'none', ts: new Date(0).toISOString() }, defaults)).resolves.toBeUndefined()
})
it('kills hook descendants on timeout', async () => {
  const marker = path.join(root, 'descendant-survived')
  const command = hook(`(sleep 0.3; printf survived > ${shellEscape(marker)}) &\nwait`)
  expect(await runRoster({ ...defaults, rosterCommand: command }, 50)).toBeUndefined()
  await new Promise(resolve => setTimeout(resolve, 450))
  expect(fs.existsSync(marker)).toBe(false)
})

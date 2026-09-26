import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { afterAll, expect, it } from 'vitest'

const root = fs.mkdtempSync(path.resolve('tmp/launch-selection-'))
const scripts = path.join(root, 'scripts')
fs.mkdirSync(scripts)
for (const name of ['collab-launch.sh', 'collab-paths.sh']) fs.copyFileSync(path.resolve('scripts', name), path.join(scripts, name))
fs.writeFileSync(path.join(scripts, 'collab-preflight.sh'), '#!/bin/bash\nprintf "%s" "$1" > "$TEST_REQUEST"\nprintf "glm,claude\\n" > "$COLLAB_OVERRIDE_FILE"\nexit "${TEST_PREFLIGHT_EXIT:-0}"\n', { mode: 0o755 })
fs.writeFileSync(path.join(root, 'curl'), '#!/bin/bash\nfor arg in "$@"; do\ncase "$arg" in @*) cp "${arg#@}" "$TEST_PAYLOAD"; exit 23;; esac\ndone\necho "{}"\n', { mode: 0o755 })
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
function run(agents = '', exit = '0') {
  fs.writeFileSync(path.join(root, 'override'), 'grok')
  return spawnSync('/bin/bash', [path.join(scripts, 'collab-launch.sh'), root, 'Inspect code', agents], {
    encoding: 'utf8', env: { ...process.env, PATH: `${root}:${process.env.PATH}`, TMPDIR: root,
      COLLAB_AGENTS: '', COLLAB_SKIP_PREFLIGHT: '0', COLLAB_OVERRIDE_FILE: path.join(root, 'override'),
      ENSEMBLE_URL: 'http://unused.invalid', TEST_REQUEST: path.join(root, 'request'),
      TEST_PAYLOAD: path.join(root, 'payload'), TEST_PREFLIGHT_EXIT: exit,
    },
  })
}
it('uses the new preflight selection for the same launch, ignoring stale overrides', () => {
  run()
  expect(fs.readFileSync(path.join(root, 'request'), 'utf8')).toBe('')
  const payload = JSON.parse(fs.readFileSync(path.join(root, 'payload'), 'utf8'))
  expect(payload.agents.map((a: {program: string}) => a.program)).toEqual(['glm', 'claude'])
})
it('preserves an explicit composition', () => {
  run('gemini,claude')
  const payload = JSON.parse(fs.readFileSync(path.join(root, 'payload'), 'utf8'))
  expect(payload.agents.map((a: {program: string}) => a.program)).toEqual(['gemini', 'claude'])
})
it('propagates health exit code 7 to the caller', () => {
  expect(run('', '7').status).toBe(7)
})

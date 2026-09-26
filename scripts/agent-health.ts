import { readEnsembleConfig } from '../lib/ensemble-config'
import { checkAgentHealth } from '../lib/agent-health'

const requested = (process.argv[2] || 'codex,claude').split(',').map(key => key.trim().toLowerCase())
const result = await checkAgentHealth(requested, process.argv[3] === '1', readEnsembleConfig())
for (const warning of result.warnings) console.error(`Warning: ${warning}`)
if (result.blocked?.length) {
  console.error(`Requested agents unavailable: ${result.blocked.join(', ')}. Healthy agents: ${result.healthy?.join(', ') || 'none'}`)
  process.exitCode = 7
} else if (result.agents) {
  console.log(result.agents.join(','))
}
process.exit(process.exitCode ?? 0)

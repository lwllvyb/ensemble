/**
 * Orchestra Service — Standalone
 * No dependency on ai-maestro's agent-registry or agents-core-service.
 * Uses agent-spawner.ts for local/remote agent lifecycle.
 */

import { v4 as uuidv4 } from 'uuid'
import type { OrchestraTeam, OrchestraMessage, CreateTeamRequest } from '../types/orchestra'
import {
  createTeam, getTeam, updateTeam, loadTeams,
  appendMessage, getMessages,
} from '../lib/orchestra-registry'
import {
  spawnLocalAgent, killLocalAgent,
  spawnRemoteAgent as spawnRemote, killRemoteAgent,
  postRemoteSessionCommand, isRemoteSessionReady,
} from '../lib/agent-spawner'
import { isSelf, getHostById, getSelfHostId } from '../lib/hosts-config'
import { getRuntime } from '../lib/agent-runtime'
import fs from 'fs'

interface ServiceResult<T> {
  data?: T
  error?: string
  status: number
}

async function routeToHost(_program: string, preferredHostId?: string): Promise<string> {
  if (preferredHostId) {
    const host = getHostById(preferredHostId)
    if (host) return preferredHostId
    console.warn(`[Orchestra] Unknown host ${preferredHostId}, falling back to self`)
  }
  return getSelfHostId()
}

export async function createOrchestraTeam(
  request: CreateTeamRequest
): Promise<ServiceResult<{ team: OrchestraTeam }>> {
  const team = createTeam(request)
  const cwd = request.workingDirectory || process.cwd()

  const buildPrompt = (agentName: string, otherNames: string[]) => {
    const teamSayCmd = `/usr/local/bin/team-say ${team.id} ${agentName} ${otherNames[0] || 'team'}`
    const teamReadCmd = `/usr/local/bin/team-read ${team.id}`
    return [
      `You are ${agentName} in team "${team.name}" with teammate ${otherNames.join(', ')}.`,
      `Task: ${team.description}`,
      `COMMUNICATION RULES:`,
      `1. Send findings: ${teamSayCmd} "your message"`,
      `2. Read teammate messages: ${teamReadCmd}`,
      `3. After EVERY analysis step, run team-say to share what you found`,
      `4. After EVERY team-say, run team-read to check for responses`,
      `5. If teammate shared findings, RESPOND to them`,
      `6. Keep alternating: analyze, share, read, respond, analyze`,
      `Start NOW: greet your teammate with team-say, then begin.`,
    ].join(' ')
  }

  const isCodex = (program: string) => program.toLowerCase().includes('codex')

  // Phase 1: Spawn all agents
  for (let i = 0; i < team.agents.length; i++) {
    const agentSpec = team.agents[i]
    const hostId = await routeToHost(agentSpec.program, request.agents[i].hostId)
    const agentName = `${team.name}-${agentSpec.name}`
    const prompt = buildPrompt(agentSpec.name, team.agents.filter((_, j) => j !== i).map(a => a.name))

    const promptFile = `/tmp/orchestra-prompt-${agentName}.txt`
    fs.writeFileSync(promptFile, prompt)

    try {
      let agentId: string
      console.log(`[Orchestra] Spawning ${agentName} (${agentSpec.program}) on ${hostId} (self=${isSelf(hostId)})`)

      if (isSelf(hostId)) {
        const spawned = await spawnLocalAgent({
          name: agentName,
          program: agentSpec.program,
          workingDirectory: cwd,
          hostId,
        })
        agentId = spawned.id
      } else {
        const host = getHostById(hostId)
        if (!host) throw new Error(`Unknown host: ${hostId}`)
        const remote = await spawnRemote(host.url, agentName, agentSpec.program, cwd, team.description, team.name)
        agentId = remote.id
      }

      team.agents[i].agentId = agentId
      team.agents[i].hostId = hostId
      team.agents[i].status = 'active'

      appendMessage(team.id, {
        id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
        content: `${agentSpec.name} (${agentSpec.program} @ ${hostId}) has joined #${team.name}`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Orchestra] Failed to spawn ${agentName}:`, message)
      team.agents[i].status = 'idle'
      appendMessage(team.id, {
        id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
        content: `Failed to spawn ${agentName}: ${message}`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
    }
  }

  updateTeam(team.id, { ...team, status: 'active' })

  // Phase 2: Wait for ALL agents to be ready, then inject prompts
  const activeAgents = team.agents.filter(a => a.status === 'active')
  if (activeAgents.length >= 2) {
    const runtime = getRuntime()

    const waitForReady = async (
      sessionName: string, program: string, hostId?: string, maxWait = 60000,
    ): Promise<boolean> => {
      const start = Date.now()
      const readyMarker = isCodex(program) ? '›' : '❯'
      while (Date.now() - start < maxWait) {
        try {
          if (hostId && !isSelf(hostId)) {
            const host = getHostById(hostId)
            if (host && await isRemoteSessionReady(host.url, sessionName)) {
              console.log(`[Orchestra] ${sessionName} is remotely reachable (${Math.round((Date.now() - start) / 1000)}s)`)
              return true
            }
          } else {
            const output = await runtime.capturePane(sessionName, 50)
            if (output.includes(readyMarker)) {
              console.log(`[Orchestra] ${sessionName} is ready (${Math.round((Date.now() - start) / 1000)}s)`)
              return true
            }
          }
        } catch { /* not ready yet */ }
        await new Promise(r => setTimeout(r, 1000))
      }
      console.error(`[Orchestra] ${sessionName} did not become ready within ${maxWait / 1000}s`)
      return false
    }

    console.log(`[Orchestra] Waiting for all ${activeAgents.length} agents to be ready...`)
    const readyResults = await Promise.all(
      activeAgents.map(agent => {
        const sessionName = `${team.name}-${agent.name}`
        return waitForReady(sessionName, agent.program, agent.hostId).then(ready => ({ agent, sessionName, ready }))
      })
    )

    const ready = readyResults.filter(r => r.ready)
    const notReady = readyResults.filter(r => !r.ready)

    for (const nr of notReady) {
      appendMessage(team.id, {
        id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
        content: `❌ ${nr.agent.name} failed to start — timed out`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
    }

    if (ready.length < 2) {
      appendMessage(team.id, {
        id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
        content: `❌ Team start aborted: only ${ready.length}/${activeAgents.length} agents ready`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
      return { data: { team }, status: 201 }
    }

    await new Promise(r => setTimeout(r, 2000))

    // Phase 3: Inject prompts simultaneously
    console.log(`[Orchestra] All ${ready.length} agents ready — injecting prompts simultaneously`)
    await Promise.all(
      ready.map(async ({ agent, sessionName }) => {
        const promptFile = `/tmp/orchestra-prompt-${sessionName}.txt`
        try {
          if (agent.hostId && !isSelf(agent.hostId)) {
            const host = getHostById(agent.hostId)
            if (host) {
              const prompt = fs.readFileSync(promptFile, 'utf-8')
              await postRemoteSessionCommand(host.url, sessionName, prompt)
            }
          } else if (isCodex(agent.program)) {
            await runtime.pasteFromFile(sessionName, promptFile)
          } else {
            const prompt = fs.readFileSync(promptFile, 'utf-8')
            await runtime.sendKeys(sessionName, prompt, { literal: true, enter: true })
          }
          console.log(`[Orchestra] ✓ Prompt injected into ${sessionName}`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          appendMessage(team.id, {
            id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
            content: `❌ Delivery to ${agent.name} failed: ${message}`,
            type: 'chat', timestamp: new Date().toISOString(),
          })
          console.error(`[Orchestra] ✗ Failed to inject prompt into ${sessionName}:`, err)
        }
      })
    )

    appendMessage(team.id, {
      id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
      content: `🚀 All ${ready.length} agents received their task — collaboration started`,
      type: 'chat', timestamp: new Date().toISOString(),
    })
  }

  return { data: { team }, status: 201 }
}

export function getOrchestraTeam(teamId: string): ServiceResult<{ team: OrchestraTeam; messages: OrchestraMessage[] }> {
  const team = getTeam(teamId)
  if (!team) return { error: 'Team not found', status: 404 }
  return { data: { team, messages: getMessages(teamId) }, status: 200 }
}

export function listOrchestraTeams(): ServiceResult<{ teams: OrchestraTeam[] }> {
  return { data: { teams: loadTeams() }, status: 200 }
}

export function getTeamFeed(teamId: string, since?: string): ServiceResult<{ messages: OrchestraMessage[] }> {
  const team = getTeam(teamId)
  if (!team) return { error: 'Team not found', status: 404 }
  return { data: { messages: getMessages(teamId, since) }, status: 200 }
}

export async function sendTeamMessage(
  teamId: string, to: string, content: string, from?: string,
): Promise<ServiceResult<{ message: OrchestraMessage }>> {
  const team = getTeam(teamId)
  if (!team) return { error: 'Team not found', status: 404 }

  const message: OrchestraMessage = {
    id: uuidv4(), teamId, from: from || 'user', to, content,
    type: 'chat', timestamp: new Date().toISOString(),
  }
  appendMessage(teamId, message)

  // Determine which agents should receive this message in their tmux pane
  const sender = from || 'user'
  const recipients = to === 'team'
    ? team.agents.filter(a => a.status === 'active' && a.name !== sender)
    : team.agents.filter(a => a.status === 'active' && a.name === to)

  const runtime = getRuntime()
  const isCodex = (program: string) => program.toLowerCase().includes('codex')

  for (const targetAgent of recipients) {
    try {
      const sessionName = `${team.name}-${targetAgent.name}`
      // Wrap message with sender context + response nudge
      const deliveryText = [
        `[Team message from ${sender}]: ${content}`,
        `→ Respond with team-say. Then run team-read to check for more messages.`,
      ].join('\n')

      if (targetAgent.hostId && !isSelf(targetAgent.hostId)) {
        const host = getHostById(targetAgent.hostId)
        if (host) await postRemoteSessionCommand(host.url, sessionName, deliveryText)
      } else if (isCodex(targetAgent.program)) {
        // Codex works better with paste-buffer for multi-line input
        const tmpFile = `/tmp/orchestra-delivery-${sessionName}.txt`
        fs.writeFileSync(tmpFile, deliveryText)
        await runtime.pasteFromFile(sessionName, tmpFile)
      } else {
        await runtime.sendKeys(sessionName, deliveryText, { literal: true, enter: true })
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      appendMessage(teamId, {
        id: uuidv4(), teamId, from: 'orchestra', to: 'team',
        content: `❌ Delivery to ${targetAgent.name} failed: ${reason}`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
    }
  }

  return { data: { message }, status: 200 }
}

export async function disbandTeam(teamId: string): Promise<ServiceResult<{ team: OrchestraTeam }>> {
  const team = getTeam(teamId)
  if (!team) return { error: 'Team not found', status: 404 }

  for (const agent of team.agents) {
    if (agent.status === 'active') {
      appendMessage(teamId, {
        id: uuidv4(), teamId, from: 'orchestra', to: 'team',
        content: `${agent.name} has left #${team.name}`,
        type: 'chat', timestamp: new Date().toISOString(),
      })

      try {
        if (agent.hostId && !isSelf(agent.hostId)) {
          const host = getHostById(agent.hostId)
          if (host && agent.agentId) await killRemoteAgent(host.url, agent.agentId)
        } else {
          await killLocalAgent(`${team.name}-${agent.name}`)
        }
      } catch { /* session may already be gone */ }
    }
  }

  const updated = updateTeam(teamId, {
    status: 'disbanded',
    completedAt: new Date().toISOString(),
  })

  // Optional: save findings to claude-mem
  try {
    const messages = getMessages(teamId)
    const agentMessages = messages.filter(m => m.from !== 'orchestra' && m.from !== 'user')
    if (agentMessages.length > 0) {
      const summary = agentMessages.map(m => `${m.from}: ${m.content}`).join('\n\n')
      const duration = updated!.completedAt && team.createdAt
        ? Math.round((new Date(updated!.completedAt).getTime() - new Date(team.createdAt).getTime()) / 60000)
        : 0

      fetch('http://localhost:37777/api/observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Team "${team.name}" Complete`,
          subtitle: `${team.agents.map(a => a.name).join(' + ')} — ${team.description.slice(0, 100)}`,
          type: 'discovery',
          narrative: `Orchestra team "${team.name}": ${team.agents.map(a => `${a.name} (${a.program})`).join(', ')}. Duration: ${duration}min. ${agentMessages.length} messages.\n\n${summary.slice(0, 3000)}`,
          project: 'orchestra',
        }),
      }).catch(() => {})
    }
  } catch { /* non-fatal */ }

  return { data: { team: updated! }, status: 200 }
}

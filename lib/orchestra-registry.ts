import fs from 'fs'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type { OrchestraTeam, OrchestraMessage, CreateTeamRequest } from '../types/orchestra'
import { getOrchestraDataDir } from './ensemble-paths'

const ORCHESTRA_DIR = getOrchestraDataDir()
const TEAMS_FILE = path.join(ORCHESTRA_DIR, 'teams.json')
const MESSAGES_DIR = path.join(ORCHESTRA_DIR, 'messages')

function getCreatedBy(): string {
  return process.env.ENSEMBLE_CREATED_BY?.trim()
    || process.env.USER
    || process.env.LOGNAME
    || os.hostname()
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function loadTeams(): OrchestraTeam[] {
  ensureDir(ORCHESTRA_DIR)
  if (!fs.existsSync(TEAMS_FILE)) return []
  return JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf-8'))
}

export function saveTeams(teams: OrchestraTeam[]): void {
  ensureDir(ORCHESTRA_DIR)
  fs.writeFileSync(TEAMS_FILE, JSON.stringify(teams, null, 2))
}

export function getTeam(id: string): OrchestraTeam | undefined {
  return loadTeams().find(t => t.id === id)
}

export function createTeam(request: CreateTeamRequest): OrchestraTeam {
  const teams = loadTeams()
  const team: OrchestraTeam = {
    id: uuidv4(),
    name: request.name,
    description: request.description,
    status: 'forming',
    agents: request.agents.map((a, i) => ({
      agentId: '',
      name: `${a.program.toLowerCase().includes('codex') ? 'codex' : 'claude'}-${i + 1}`,
      program: a.program,
      role: a.role || (i === 0 ? 'lead' : 'member'),
      hostId: a.hostId || '',
      status: 'spawning' as const,
    })),
    createdBy: getCreatedBy(),
    createdAt: new Date().toISOString(),
    feedMode: request.feedMode || 'live',
  }
  teams.push(team)
  saveTeams(teams)
  return team
}

export function updateTeam(id: string, updates: Partial<OrchestraTeam>): OrchestraTeam | undefined {
  const teams = loadTeams()
  const idx = teams.findIndex(t => t.id === id)
  if (idx === -1) return undefined
  teams[idx] = { ...teams[idx], ...updates }
  saveTeams(teams)
  return teams[idx]
}

export function appendMessage(teamId: string, message: OrchestraMessage): void {
  const dir = path.join(MESSAGES_DIR, teamId)
  ensureDir(dir)
  const file = path.join(dir, 'feed.jsonl')
  fs.appendFileSync(file, JSON.stringify(message) + '\n')
}

export function getMessages(teamId: string, since?: string): OrchestraMessage[] {
  const file = path.join(MESSAGES_DIR, teamId, 'feed.jsonl')
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean)
  let messages = lines.map(l => JSON.parse(l) as OrchestraMessage)
  if (since) {
    messages = messages.filter(m => m.timestamp > since)
  }
  return messages
}

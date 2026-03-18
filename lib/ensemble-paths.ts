import os from 'os'
import path from 'path'

function trimConfiguredDir(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function getEnsembleDataDir(): string {
  return trimConfiguredDir(process.env.ENSEMBLE_DATA_DIR)
    || path.join(os.homedir(), '.aimaestro')
}

export function getOrchestraDataDir(): string {
  return path.join(getEnsembleDataDir(), 'orchestra')
}

export function getHostsConfigPath(): string {
  return path.join(getEnsembleDataDir(), 'hosts.json')
}

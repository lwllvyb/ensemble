import fs from 'fs'
import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

// Keep test artifacts and user configuration isolated from the host machine.
const temporary = path.resolve('tmp')
const home = path.join(temporary, 'home')
fs.mkdirSync(home, { recursive: true })

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tmp/**'],
    env: {
      TMPDIR: temporary,
      HOME: home,
      COLLAB_RUNTIME_ROOT: path.join(temporary, 'test-runtime'),
      ENSEMBLE_DATA_DIR: path.join(temporary, 'data'),
      ENSEMBLE_CONFIG: path.join(temporary, 'absent-config.json'),
      ENSEMBLE_MEMORY_URL: 'http://localhost:1/api/memory/save',
    },
  },
})

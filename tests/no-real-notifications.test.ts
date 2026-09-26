import { describe, expect, it } from 'vitest'

// Guard: a test run must never be able to send real notifications.
describe('test environment', () => {
  it('has no notification credentials', () => {
    for (const key of ['ENSEMBLE_TELEGRAM_BOT_TOKEN', 'ENSEMBLE_TELEGRAM_CHAT_ID', 'ALERT_HUB_SECRET']) {
      expect(process.env[key] ?? '', key).toBe('')
    }
  })
})

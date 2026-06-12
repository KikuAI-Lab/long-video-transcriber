const EVENT_SCHEMA_VERSION = 'long-video-transcriber.local-event.v1'
const STORAGE_KEY = 'long-video-transcriber-events'

export function createLocalEvent({
  event,
  funnelStep,
  outcome = 'unknown',
  metrics = {},
  properties = {},
}) {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    event: sanitizeText(event),
    funnelStep: sanitizeText(funnelStep),
    outcome: sanitizeText(outcome),
    timestamp: new Date().toISOString(),
    metrics: sanitizeRecord(metrics),
    properties: sanitizeRecord(properties),
  }
}

export function recordLocalEvent(event, storage = globalThis.localStorage) {
  if (!event || !storage) return null
  const events = readLocalEvents(storage)
  const nextEvents = [...events.slice(-99), event]
  storage.setItem(STORAGE_KEY, JSON.stringify(nextEvents))
  return event
}

export function readLocalEvents(storage = globalThis.localStorage) {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function bucketBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown'
  if (bytes < 1024 * 1024) return 'lt_1mb'
  if (bytes < 10 * 1024 * 1024) return '1mb_10mb'
  if (bytes < 100 * 1024 * 1024) return '10mb_100mb'
  if (bytes < 1024 * 1024 * 1024) return '100mb_1gb'
  return 'gt_1gb'
}

export function bucketDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'unknown'
  if (milliseconds < 1000) return 'lt_1s'
  if (milliseconds < 5000) return '1s_5s'
  if (milliseconds < 30000) return '5s_30s'
  if (milliseconds < 120000) return '30s_2m'
  return 'gt_2m'
}

function sanitizeRecord(value) {
  const output = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output

  for (const [key, item] of Object.entries(value)) {
    if (!isSafeKey(key)) continue
    if (typeof item === 'number') output[key] = Number.isFinite(item) ? item : null
    else if (typeof item === 'boolean') output[key] = item
    else if (typeof item === 'string') output[key] = sanitizeText(item)
  }

  return output
}

function isSafeKey(key) {
  return !/(path|url|file(name)?|email|prompt|token|secret|cookie|bytes|base64)/i.test(key)
}

function sanitizeText(value) {
  if (typeof value !== 'string') return 'unknown'
  const trimmed = value.trim()
  return trimmed.length > 96 ? `${trimmed.slice(0, 96)}...` : trimmed
}

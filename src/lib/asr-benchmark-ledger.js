import { OUTPUT_FILES } from './asr-candidates.js'

const PRIVATE_FIELD_KEYS = new Set([
  'audiopath',
  'filename',
  'localpath',
  'mediaurl',
  'rawaudiopath',
  'rawtranscript',
  'sourceurl',
  'transcripttext',
  'url',
  'videopath',
])
const PATHLIKE_VALUE_PATTERN = /(^\/|[A-Za-z]:\\|file:\/\/|https?:\/\/|\/Users\/|\/private\/|\\)/i

export function requiredBenchmarkMatrix(manifest) {
  const adapters = (manifest?.adaptersUnderTest || []).filter((adapter) => adapter.required)
  const samples = (manifest?.sampleMatrix || []).filter((sample) => sample.requiredForP1Benchmark)
  const cases = []

  for (const adapter of adapters) {
    for (const sample of samples) {
      cases.push({
        adapterId: adapter.id,
        sampleId: sample.id,
        language: sample.language,
        durationBucket: sample.durationBucket,
      })
    }
  }

  return cases
}

export function validateBenchmarkRecord(record, manifest) {
  const errors = []
  if (!isRecord(record)) {
    return ['record must be an object']
  }

  const adapters = new Set((manifest?.adaptersUnderTest || []).map((adapter) => adapter.id))
  const sampleById = new Map((manifest?.sampleMatrix || []).map((sample) => [sample.id, sample]))
  const failureCodes = new Set(manifest?.failureCodes || [])
  const metrics = new Set(manifest?.requiredMetrics || [])

  requireString(record, 'runId', errors)
  requireString(record, 'adapterId', errors)
  requireString(record, 'sampleId', errors)
  requireString(record, 'runtime', errors)
  requireString(record, 'hardwareLane', errors)
  requireNumber(record, 'durationSeconds', errors)
  requireNumber(record, 'realTimeFactor', errors)
  requireNumber(record, 'transcriptQualityScore20', errors, { min: 0, max: 20 })
  requireNumber(record, 'subtitleUsefulnessScore20', errors, { min: 0, max: 20 })

  if (record.adapterId && !adapters.has(record.adapterId)) {
    errors.push(`adapterId ${record.adapterId} is not in the manifest`)
  }

  const sample = sampleById.get(record.sampleId)
  if (!sample) {
    errors.push(`sampleId ${record.sampleId} is not in the manifest`)
  } else {
    if (record.language && record.language !== sample.language) {
      errors.push(`language ${record.language} does not match sample ${sample.id}`)
    }
    if (record.durationBucket && record.durationBucket !== sample.durationBucket) {
      errors.push(`durationBucket ${record.durationBucket} does not match sample ${sample.id}`)
    }
  }

  if (!Array.isArray(record.exportedFiles)) {
    errors.push('exportedFiles must be an array')
  } else {
    for (const fileName of OUTPUT_FILES) {
      if (!record.exportedFiles.includes(fileName)) {
        errors.push(`exportedFiles is missing ${fileName}`)
      }
    }
  }

  if (record.failureCode !== null && record.failureCode !== undefined && !failureCodes.has(record.failureCode)) {
    errors.push(`failureCode ${record.failureCode} is not allowed`)
  }

  for (const field of metrics) {
    if (!(field in record)) {
      errors.push(`required metric ${field} is missing`)
    }
  }

  errors.push(...findPrivatePayloadLeaks(record))
  return errors
}

export function summarizeBenchmarkLedger(records, manifest) {
  const rows = Array.isArray(records) ? records : []
  const requiredCases = requiredBenchmarkMatrix(manifest)
  const errors = []
  const validRows = []

  for (const [index, record] of rows.entries()) {
    const recordErrors = validateBenchmarkRecord(record, manifest)
    if (recordErrors.length) {
      errors.push({
        index,
        runId: isRecord(record) ? record.runId || null : null,
        errors: recordErrors,
      })
      continue
    }
    validRows.push(record)
  }

  const covered = new Set(validRows.map((record) => `${record.adapterId}:${record.sampleId}`))
  const missingCases = requiredCases.filter((item) => !covered.has(`${item.adapterId}:${item.sampleId}`))
  const completedRows = validRows.filter((record) => !record.failureCode)
  const failedRows = validRows.filter((record) => record.failureCode)

  return {
    status: errors.length === 0 && missingCases.length === 0 ? 'complete' : 'incomplete',
    requiredCaseCount: requiredCases.length,
    validRowCount: validRows.length,
    completedRowCount: completedRows.length,
    failedRowCount: failedRows.length,
    missingCases,
    errors,
  }
}

function requireString(record, field, errors) {
  if (typeof record[field] !== 'string' || !record[field].trim()) {
    errors.push(`${field} must be a non-empty string`)
  }
}

function requireNumber(record, field, errors, options = {}) {
  const value = record[field]
  if (!Number.isFinite(value)) {
    errors.push(`${field} must be a finite number`)
    return
  }
  if (options.min !== undefined && value < options.min) {
    errors.push(`${field} must be >= ${options.min}`)
  }
  if (options.max !== undefined && value > options.max) {
    errors.push(`${field} must be <= ${options.max}`)
  }
}

function findPrivatePayloadLeaks(value, path = '') {
  const errors = []
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      errors.push(...findPrivatePayloadLeaks(item, `${path}[${index}]`))
    }
    return errors
  }
  if (!isRecord(value)) {
    if (typeof value === 'string' && PATHLIKE_VALUE_PATTERN.test(value)) {
      errors.push(`${path || 'value'} contains a path-like private value`)
    }
    return errors
  }

  for (const [key, item] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key
    if (PRIVATE_FIELD_KEYS.has(key.toLowerCase())) {
      errors.push(`${nextPath} is not allowed in benchmark ledger records`)
      continue
    }
    errors.push(...findPrivatePayloadLeaks(item, nextPath))
  }
  return errors
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

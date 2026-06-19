const REQUIRED_SAMPLE_FIELDS = [
  'id',
  'language',
  'durationBucket',
  'durationSecondsTarget',
  'consentStatus',
  'storageBoundary',
  'sourceKind',
  'transcriptOracleStatus',
  'qualityRubricId',
]

const ALLOWED_SAMPLE_FIELDS = new Set([
  ...REQUIRED_SAMPLE_FIELDS,
  'notes',
])

const CONSENT_STATUSES = new Set(['pending', 'approved', 'rejected'])
const STORAGE_BOUNDARIES = new Set(['operator-local-not-committed', 'synthetic-public-fixture'])
const SOURCE_KINDS = new Set(['operator-owned-or-approved', 'synthetic-public-fixture'])
const ORACLE_STATUSES = new Set(['pending', 'ready'])

const DURATION_BUCKET_RANGES = {
  '5m': { min: 240, max: 420 },
  '30m': { min: 1500, max: 2100 },
  '60m': { min: 3300, max: 3900 },
}

const PRIVATE_KEYS = new Set([
  'audiopath',
  'filename',
  'localpath',
  'mediaurl',
  'rawtranscript',
  'sourceurl',
  'transcripttext',
  'url',
  'videopath',
])
const PRIVATE_VALUE_PATTERN = /(^\/|[A-Za-z]:\\|file:\/\/|https?:\/\/|\/Users\/|\/private\/|\\)/i

export function validateCorpusManifest(corpusManifest, benchmarkManifest) {
  const errors = []
  if (!isRecord(corpusManifest)) {
    return ['corpus manifest must be an object']
  }

  errors.push(...findPrivatePayloadLeaks(corpusManifest))

  if (!Array.isArray(corpusManifest.samples)) {
    errors.push('samples must be an array')
    return errors
  }

  const requiredSamples = requiredSampleMap(benchmarkManifest)
  const observedSampleIds = new Set()

  for (const [index, sample] of corpusManifest.samples.entries()) {
    if (!isRecord(sample)) {
      errors.push(`samples[${index}] must be an object`)
      continue
    }

    validateSample(sample, index, requiredSamples, observedSampleIds, errors)
  }

  for (const sampleId of requiredSamples.keys()) {
    if (!observedSampleIds.has(sampleId)) {
      errors.push(`required sample ${sampleId} is missing from corpus manifest`)
    }
  }

  return errors
}

export function summarizeCorpusReadiness(corpusManifest, benchmarkManifest) {
  const errors = validateCorpusManifest(corpusManifest, benchmarkManifest)
  if (errors.length > 0 || !isRecord(corpusManifest) || !Array.isArray(corpusManifest.samples)) {
    return {
      status: 'invalid',
      requiredSampleCount: requiredSampleMap(benchmarkManifest).size,
      observedSampleCount: 0,
      approvedSampleCount: 0,
      oracleReadySampleCount: 0,
      blockedReasons: errors,
    }
  }

  const requiredSamples = requiredSampleMap(benchmarkManifest)
  const requiredEntries = corpusManifest.samples.filter((sample) => isRecord(sample) && requiredSamples.has(sample.id))
  const approvedSampleCount = requiredEntries.filter((sample) => sample.consentStatus === 'approved').length
  const oracleReadySampleCount = requiredEntries.filter((sample) => sample.transcriptOracleStatus === 'ready').length
  const blockedReasons = []

  for (const sample of requiredEntries) {
    if (sample.consentStatus !== 'approved') {
      blockedReasons.push(`${sample.id} is not approved for benchmark use`)
    }
    if (sample.transcriptOracleStatus !== 'ready') {
      blockedReasons.push(`${sample.id} has no ready transcript oracle criteria`)
    }
  }

  return {
    status: blockedReasons.length === 0 ? 'ready' : 'blocked',
    requiredSampleCount: requiredSamples.size,
    observedSampleCount: requiredEntries.length,
    approvedSampleCount,
    oracleReadySampleCount,
    blockedReasons,
  }
}

function validateSample(sample, index, requiredSamples, observedSampleIds, errors) {
  for (const key of Object.keys(sample)) {
    if (!ALLOWED_SAMPLE_FIELDS.has(key)) {
      errors.push(`samples[${index}].${key} is not an allowed corpus field`)
    }
  }

  for (const field of REQUIRED_SAMPLE_FIELDS) {
    requirePresent(sample, field, `samples[${index}]`, errors)
  }

  if (typeof sample.id === 'string') {
    if (observedSampleIds.has(sample.id)) {
      errors.push(`samples[${index}].id ${sample.id} is duplicated`)
    }
    observedSampleIds.add(sample.id)
  }

  const requiredSample = requiredSamples.get(sample.id)
  if (!requiredSample) {
    errors.push(`samples[${index}].id ${sample.id || '<missing>'} is not required by benchmark manifest`)
  } else {
    if (sample.language !== requiredSample.language) {
      errors.push(`samples[${index}].language ${sample.language} does not match ${requiredSample.id}`)
    }
    if (sample.durationBucket !== requiredSample.durationBucket) {
      errors.push(`samples[${index}].durationBucket ${sample.durationBucket} does not match ${requiredSample.id}`)
    }
  }

  requireEnum(sample, 'consentStatus', CONSENT_STATUSES, `samples[${index}]`, errors)
  requireEnum(sample, 'storageBoundary', STORAGE_BOUNDARIES, `samples[${index}]`, errors)
  requireEnum(sample, 'sourceKind', SOURCE_KINDS, `samples[${index}]`, errors)
  requireEnum(sample, 'transcriptOracleStatus', ORACLE_STATUSES, `samples[${index}]`, errors)
  requireString(sample, 'qualityRubricId', `samples[${index}]`, errors)
  requireDurationTarget(sample, index, errors)
}

function requireDurationTarget(sample, index, errors) {
  const value = sample.durationSecondsTarget
  if (!Number.isFinite(value)) {
    errors.push(`samples[${index}].durationSecondsTarget must be a finite number`)
    return
  }

  const range = DURATION_BUCKET_RANGES[sample.durationBucket]
  if (!range) {
    errors.push(`samples[${index}].durationBucket has no accepted target range`)
    return
  }

  if (value < range.min || value > range.max) {
    errors.push(`samples[${index}].durationSecondsTarget must fit ${sample.durationBucket}`)
  }
}

function requirePresent(record, field, prefix, errors) {
  if (!(field in record)) {
    errors.push(`${prefix}.${field} is required`)
  }
}

function requireString(record, field, prefix, errors) {
  if (typeof record[field] !== 'string' || !record[field].trim()) {
    errors.push(`${prefix}.${field} must be a non-empty string`)
  }
}

function requireEnum(record, field, allowedValues, prefix, errors) {
  if (typeof record[field] !== 'string' || !allowedValues.has(record[field])) {
    errors.push(`${prefix}.${field} must be one of ${Array.from(allowedValues).join(', ')}`)
  }
}

function requiredSampleMap(benchmarkManifest) {
  return new Map(
    (benchmarkManifest?.sampleMatrix || [])
      .filter((sample) => sample.requiredForP1Benchmark)
      .map((sample) => [sample.id, sample])
  )
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
    if (typeof value === 'string' && PRIVATE_VALUE_PATTERN.test(value)) {
      errors.push(`${path || 'value'} contains a path-like private value`)
    }
    return errors
  }

  for (const [key, item] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key
    if (PRIVATE_KEYS.has(key.toLowerCase())) {
      errors.push(`${nextPath} is not allowed in corpus manifests`)
      continue
    }
    errors.push(...findPrivatePayloadLeaks(item, nextPath))
  }
  return errors
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

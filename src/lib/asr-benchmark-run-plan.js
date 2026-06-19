import { summarizeCorpusReadiness } from './asr-benchmark-corpus.js'
import { requiredBenchmarkMatrix } from './asr-benchmark-ledger.js'

export function buildBenchmarkRunPlan(corpusManifest, benchmarkManifest) {
  const corpusSummary = summarizeCorpusReadiness(corpusManifest, benchmarkManifest)
  if (corpusSummary.status !== 'ready') {
    return {
      status: corpusSummary.status,
      requiredCaseCount: requiredBenchmarkMatrix(benchmarkManifest).length,
      assignmentCount: 0,
      assignments: [],
      blockedReasons: corpusSummary.blockedReasons,
    }
  }

  const samplesById = new Map((corpusManifest.samples || []).map((sample) => [sample.id, sample]))
  const assignments = requiredBenchmarkMatrix(benchmarkManifest).map((benchmarkCase) => {
    const sample = samplesById.get(benchmarkCase.sampleId)
    return {
      runId: `p3-${benchmarkCase.adapterId}-${benchmarkCase.sampleId}`,
      adapterId: benchmarkCase.adapterId,
      sampleId: benchmarkCase.sampleId,
      language: benchmarkCase.language,
      durationBucket: benchmarkCase.durationBucket,
      durationSecondsTarget: sample.durationSecondsTarget,
      qualityRubricId: sample.qualityRubricId,
      mediaBoundary: 'operator-local-not-committed',
      resultPolicy: 'write-sanitized-benchmark-ledger-row-only',
    }
  })

  return {
    status: 'ready',
    requiredCaseCount: assignments.length,
    assignmentCount: assignments.length,
    assignments,
    blockedReasons: [],
  }
}

export function validateBenchmarkRunPlanArtifact(plan) {
  const errors = []
  errors.push(...findPrivatePayloadLeaks(plan))

  if (!isRecord(plan)) {
    errors.push('plan must be an object')
    return errors
  }

  if (!['ready', 'blocked', 'invalid'].includes(plan.status)) {
    errors.push('status must be ready, blocked or invalid')
  }
  if (!Number.isInteger(plan.requiredCaseCount) || plan.requiredCaseCount < 0) {
    errors.push('requiredCaseCount must be a non-negative integer')
  }
  if (!Number.isInteger(plan.assignmentCount) || plan.assignmentCount < 0) {
    errors.push('assignmentCount must be a non-negative integer')
  }
  if (!Array.isArray(plan.assignments)) {
    errors.push('assignments must be an array')
  } else if (plan.assignmentCount !== plan.assignments.length) {
    errors.push('assignmentCount must equal assignments.length')
  }
  if (!Array.isArray(plan.blockedReasons)) {
    errors.push('blockedReasons must be an array')
  }

  if (plan.status === 'ready' && plan.assignmentCount !== plan.requiredCaseCount) {
    errors.push('ready plans must assign every required case')
  }
  if (plan.status !== 'ready' && plan.assignmentCount !== 0) {
    errors.push('blocked or invalid plans must not contain assignments')
  }
  if (plan.status === 'ready' && Array.isArray(plan.blockedReasons) && plan.blockedReasons.length > 0) {
    errors.push('ready plans must not contain blocked reasons')
  }

  if (Array.isArray(plan.assignments)) {
    for (const [index, assignment] of plan.assignments.entries()) {
      if (!isRecord(assignment)) {
        errors.push(`assignments[${index}] must be an object`)
        continue
      }
      requireString(assignment, 'runId', `assignments[${index}]`, errors)
      requireString(assignment, 'adapterId', `assignments[${index}]`, errors)
      requireString(assignment, 'sampleId', `assignments[${index}]`, errors)
      requireString(assignment, 'language', `assignments[${index}]`, errors)
      requireString(assignment, 'durationBucket', `assignments[${index}]`, errors)
      requireString(assignment, 'qualityRubricId', `assignments[${index}]`, errors)
      requireString(assignment, 'mediaBoundary', `assignments[${index}]`, errors)
      requireString(assignment, 'resultPolicy', `assignments[${index}]`, errors)
      if (!Number.isFinite(assignment.durationSecondsTarget) || assignment.durationSecondsTarget <= 0) {
        errors.push(`assignments[${index}].durationSecondsTarget must be a positive number`)
      }
    }
  }

  return errors
}

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

function requireString(record, field, prefix, errors) {
  if (typeof record[field] !== 'string' || !record[field].trim()) {
    errors.push(`${prefix}.${field} must be a non-empty string`)
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
      errors.push(`${nextPath} is not allowed in benchmark run plans`)
      continue
    }
    errors.push(...findPrivatePayloadLeaks(item, nextPath))
  }
  return errors
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

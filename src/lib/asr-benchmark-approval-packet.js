import { summarizeCorpusReadiness } from './asr-benchmark-corpus.js'
import { buildBenchmarkRunPlan } from './asr-benchmark-run-plan.js'

export function buildBenchmarkApprovalPacket(corpusManifest, benchmarkManifest) {
  const corpusSummary = summarizeCorpusReadiness(corpusManifest, benchmarkManifest)
  const runPlan = buildBenchmarkRunPlan(corpusManifest, benchmarkManifest)
  const samples = Array.isArray(corpusManifest?.samples) ? corpusManifest.samples : []
  const approvals = samples
    .filter((sample) => isRecord(sample))
    .map((sample) => buildSampleApproval(sample))

  return {
    product: 'Long Video Transcriber',
    packetType: 'p4-operator-benchmark-approval',
    status: corpusSummary.status,
    approvalCount: approvals.length,
    requiredSampleCount: corpusSummary.requiredSampleCount,
    readySampleCount: corpusSummary.status === 'ready' ? corpusSummary.requiredSampleCount : 0,
    approvals,
    executionGate: {
      canRun: corpusSummary.status === 'ready',
      runPlanStatus: runPlan.status,
      requiredCaseCount: runPlan.requiredCaseCount,
      assignmentCount: runPlan.assignmentCount,
      resultArtifactPolicy: 'sanitized-benchmark-ledger-rows-only',
      providerCallPolicy: 'operator-run-only-after-approval',
    },
    blockedReasons: corpusSummary.blockedReasons,
    validationErrors: corpusSummary.status === 'invalid' ? corpusSummary.blockedReasons : [],
  }
}

export function validateBenchmarkApprovalPacketArtifact(packet) {
  const errors = []
  errors.push(...findPrivatePayloadLeaks(packet))

  if (!isRecord(packet)) {
    errors.push('packet must be an object')
    return errors
  }

  requireLiteral(packet, 'product', 'Long Video Transcriber', errors)
  requireLiteral(packet, 'packetType', 'p4-operator-benchmark-approval', errors)
  requireStatus(packet, errors)
  requireNonNegativeInteger(packet, 'approvalCount', errors)
  requireNonNegativeInteger(packet, 'requiredSampleCount', errors)
  requireNonNegativeInteger(packet, 'readySampleCount', errors)

  if (!Array.isArray(packet.approvals)) {
    errors.push('approvals must be an array')
  } else {
    if (packet.approvalCount !== packet.approvals.length) {
      errors.push('approvalCount must equal approvals.length')
    }
    for (const [index, approval] of packet.approvals.entries()) {
      validateSampleApproval(approval, index, errors)
    }
  }

  validateExecutionGate(packet.executionGate, packet.status, errors)
  if (!Array.isArray(packet.blockedReasons)) {
    errors.push('blockedReasons must be an array')
  }
  if (!Array.isArray(packet.validationErrors)) {
    errors.push('validationErrors must be an array')
  }

  if (packet.status === 'ready') {
    if (packet.readySampleCount !== packet.requiredSampleCount) {
      errors.push('ready packets must mark every required sample ready')
    }
    if (Array.isArray(packet.approvals) && packet.approvals.some((approval) => hasRequiredActions(approval))) {
      errors.push('ready packets must not contain required approval actions')
    }
    if (Array.isArray(packet.blockedReasons) && packet.blockedReasons.length > 0) {
      errors.push('ready packets must not contain blocked reasons')
    }
  }

  return errors
}

function buildSampleApproval(sample) {
  const requiredActions = []
  if (sample.consentStatus !== 'approved') {
    requiredActions.push('approve-sample-use')
  }
  if (sample.transcriptOracleStatus !== 'ready') {
    requiredActions.push('prepare-transcript-oracle-criteria')
  }

  return {
    sampleId: sample.id,
    language: sample.language,
    durationBucket: sample.durationBucket,
    durationSecondsTarget: sample.durationSecondsTarget,
    consentStatus: sample.consentStatus,
    transcriptOracleStatus: sample.transcriptOracleStatus,
    qualityRubricId: sample.qualityRubricId,
    requiredActions,
  }
}

function validateSampleApproval(approval, index, errors) {
  const prefix = `approvals[${index}]`
  if (!isRecord(approval)) {
    errors.push(`${prefix} must be an object`)
    return
  }

  requireString(approval, 'sampleId', prefix, errors)
  requireString(approval, 'language', prefix, errors)
  requireString(approval, 'durationBucket', prefix, errors)
  requirePositiveNumber(approval, 'durationSecondsTarget', prefix, errors)
  requireString(approval, 'consentStatus', prefix, errors)
  requireString(approval, 'transcriptOracleStatus', prefix, errors)
  requireString(approval, 'qualityRubricId', prefix, errors)
  if (!Array.isArray(approval.requiredActions)) {
    errors.push(`${prefix}.requiredActions must be an array`)
  } else if (approval.requiredActions.some((action) => typeof action !== 'string' || !action.trim())) {
    errors.push(`${prefix}.requiredActions must contain non-empty strings`)
  }
}

function validateExecutionGate(gate, packetStatus, errors) {
  if (!isRecord(gate)) {
    errors.push('executionGate must be an object')
    return
  }

  if (typeof gate.canRun !== 'boolean') {
    errors.push('executionGate.canRun must be boolean')
  }
  requireStatusField(gate, 'runPlanStatus', errors)
  requireNonNegativeInteger(gate, 'requiredCaseCount', errors, 'executionGate')
  requireNonNegativeInteger(gate, 'assignmentCount', errors, 'executionGate')
  requireLiteral(gate, 'resultArtifactPolicy', 'sanitized-benchmark-ledger-rows-only', errors, 'executionGate')
  requireLiteral(gate, 'providerCallPolicy', 'operator-run-only-after-approval', errors, 'executionGate')

  if (packetStatus === 'ready' && gate.canRun !== true) {
    errors.push('ready packets must set executionGate.canRun true')
  }
  if (packetStatus === 'ready' && gate.assignmentCount !== gate.requiredCaseCount) {
    errors.push('ready packets must assign every required benchmark case')
  }
  if (packetStatus !== 'ready' && gate.canRun !== false) {
    errors.push('blocked or invalid packets must set executionGate.canRun false')
  }
  if (packetStatus !== 'ready' && gate.assignmentCount !== 0) {
    errors.push('blocked or invalid packets must not have execution assignments')
  }
}

function hasRequiredActions(approval) {
  return isRecord(approval) && Array.isArray(approval.requiredActions) && approval.requiredActions.length > 0
}

function requireStatus(packet, errors) {
  requireStatusField(packet, 'status', errors)
}

function requireStatusField(record, field, errors) {
  if (!['ready', 'blocked', 'invalid'].includes(record[field])) {
    errors.push(`${field} must be ready, blocked or invalid`)
  }
}

function requireLiteral(record, field, expected, errors, prefix = '') {
  if (record[field] !== expected) {
    errors.push(`${prefix ? `${prefix}.` : ''}${field} must be ${expected}`)
  }
}

function requireString(record, field, prefix, errors) {
  if (typeof record[field] !== 'string' || !record[field].trim()) {
    errors.push(`${prefix}.${field} must be a non-empty string`)
  }
}

function requirePositiveNumber(record, field, prefix, errors) {
  if (!Number.isFinite(record[field]) || record[field] <= 0) {
    errors.push(`${prefix}.${field} must be a positive number`)
  }
}

function requireNonNegativeInteger(record, field, errors, prefix = '') {
  if (!Number.isInteger(record[field]) || record[field] < 0) {
    errors.push(`${prefix ? `${prefix}.` : ''}${field} must be a non-negative integer`)
  }
}

const PRIVATE_FIELD_KEYS = new Set([
  'audiopath',
  'filename',
  'localpath',
  'mediaurl',
  'rawaudiopath',
  'rawtranscript',
  'sourceurl',
  'telegramfileid',
  'transcripttext',
  'url',
  'videopath',
])
const PRIVATE_VALUE_PATTERN = /(^\/|[A-Za-z]:\\|file:\/\/|https?:\/\/|\/Users\/|\/private\/|\\)/i

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
    if (PRIVATE_FIELD_KEYS.has(key.toLowerCase())) {
      errors.push(`${nextPath} is not allowed in benchmark approval packets`)
      continue
    }
    errors.push(...findPrivatePayloadLeaks(item, nextPath))
  }
  return errors
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

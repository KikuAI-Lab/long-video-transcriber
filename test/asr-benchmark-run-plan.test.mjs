import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  buildBenchmarkRunPlan,
  validateBenchmarkRunPlanArtifact,
} from '../src/lib/asr-benchmark-run-plan.js'

const benchmarkManifest = JSON.parse(await readFile('docs/benchmarks/asr-benchmark-manifest-2026-06-18.json', 'utf8'))
const corpusTemplate = JSON.parse(await readFile('docs/benchmarks/asr-benchmark-corpus.p2.template.json', 'utf8'))

test('P3 run planner blocks pending corpus without producing assignments', () => {
  const plan = buildBenchmarkRunPlan(corpusTemplate, benchmarkManifest)

  assert.equal(plan.status, 'blocked')
  assert.equal(plan.requiredCaseCount, 27)
  assert.equal(plan.assignmentCount, 0)
  assert.deepEqual(plan.assignments, [])
  assert.ok(plan.blockedReasons.includes('ru-5m is not approved for benchmark use'))
  assert.deepEqual(validateBenchmarkRunPlanArtifact(plan), [])
})

test('P3 run planner emits deterministic sanitized assignments from ready corpus', () => {
  const readyCorpus = {
    ...corpusTemplate,
    samples: corpusTemplate.samples.map((sample) => ({
      ...sample,
      consentStatus: 'approved',
      transcriptOracleStatus: 'ready',
    })),
  }

  const plan = buildBenchmarkRunPlan(readyCorpus, benchmarkManifest)

  assert.equal(plan.status, 'ready')
  assert.equal(plan.requiredCaseCount, 27)
  assert.equal(plan.assignmentCount, 27)
  assert.deepEqual(validateBenchmarkRunPlanArtifact(plan), [])
  assert.ok(plan.assignments.some((assignment) => assignment.runId === 'p3-sherpa-parakeet-v3-int8-mixed-60m'))
  assert.ok(plan.assignments.every((assignment) => assignment.resultPolicy === 'write-sanitized-benchmark-ledger-row-only'))
  assert.ok(plan.assignments.every((assignment) => !('mediaUrl' in assignment)))
  assert.ok(plan.assignments.every((assignment) => !('rawTranscript' in assignment)))
})

test('P3 run plan artifact validator rejects media URLs and private source fields', () => {
  const errors = validateBenchmarkRunPlanArtifact({
    status: 'ready',
    requiredCaseCount: 1,
    assignmentCount: 1,
    blockedReasons: [],
    assignments: [
      {
        runId: 'p3-bad',
        adapterId: 'transformers-whisper-large-v3-turbo',
        sampleId: 'ru-5m',
        language: 'ru',
        durationBucket: '5m',
        durationSecondsTarget: 300,
        qualityRubricId: 'asr-qa-v1',
        mediaBoundary: 'operator-local-not-committed',
        resultPolicy: 'write-sanitized-benchmark-ledger-row-only',
        sourceUrl: 'https://example.invalid/private-media',
      },
    ],
  })

  assert.ok(errors.includes('assignments[0].sourceUrl is not allowed in benchmark run plans'))
})

test('P3 run plan artifact validator rejects inconsistent summary counts', () => {
  const errors = validateBenchmarkRunPlanArtifact({
    status: 'ready',
    requiredCaseCount: 3,
    assignmentCount: 2,
    blockedReasons: [],
    assignments: [
      {
        runId: 'p3-transformers-whisper-large-v3-turbo-ru-5m',
        adapterId: 'transformers-whisper-large-v3-turbo',
        sampleId: 'ru-5m',
        language: 'ru',
        durationBucket: '5m',
        durationSecondsTarget: 300,
        qualityRubricId: 'asr-qa-v1',
        mediaBoundary: 'operator-local-not-committed',
        resultPolicy: 'write-sanitized-benchmark-ledger-row-only',
      },
    ],
  })

  assert.ok(errors.includes('assignmentCount must equal assignments.length'))
  assert.ok(errors.includes('ready plans must assign every required case'))
})

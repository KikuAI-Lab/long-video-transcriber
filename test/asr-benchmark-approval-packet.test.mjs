import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  buildBenchmarkApprovalPacket,
  validateBenchmarkApprovalPacketArtifact,
} from '../src/lib/asr-benchmark-approval-packet.js'

const benchmarkManifest = JSON.parse(await readFile('docs/benchmarks/asr-benchmark-manifest-2026-06-18.json', 'utf8'))
const corpusTemplate = JSON.parse(await readFile('docs/benchmarks/asr-benchmark-corpus.p2.template.json', 'utf8'))

test('P4 approval packet blocks execution while corpus approvals are pending', () => {
  const packet = buildBenchmarkApprovalPacket(corpusTemplate, benchmarkManifest)

  assert.equal(packet.status, 'blocked')
  assert.equal(packet.approvalCount, 9)
  assert.equal(packet.executionGate.canRun, false)
  assert.equal(packet.executionGate.assignmentCount, 0)
  assert.ok(packet.approvals[0].requiredActions.includes('approve-sample-use'))
  assert.ok(packet.approvals[0].requiredActions.includes('prepare-transcript-oracle-criteria'))
  assert.deepEqual(validateBenchmarkApprovalPacketArtifact(packet), [])
})

test('P4 approval packet permits operator execution only after corpus readiness', () => {
  const readyCorpus = {
    ...corpusTemplate,
    samples: corpusTemplate.samples.map((sample) => ({
      ...sample,
      consentStatus: 'approved',
      transcriptOracleStatus: 'ready',
    })),
  }

  const packet = buildBenchmarkApprovalPacket(readyCorpus, benchmarkManifest)

  assert.equal(packet.status, 'ready')
  assert.equal(packet.executionGate.canRun, true)
  assert.equal(packet.executionGate.assignmentCount, 27)
  assert.ok(packet.approvals.every((approval) => approval.requiredActions.length === 0))
  assert.deepEqual(validateBenchmarkApprovalPacketArtifact(packet), [])
})

test('P4 approval packet validator rejects private payloads and inconsistent execution gates', () => {
  const errors = validateBenchmarkApprovalPacketArtifact({
    product: 'Long Video Transcriber',
    packetType: 'p4-operator-benchmark-approval',
    status: 'blocked',
    approvalCount: 1,
    requiredSampleCount: 1,
    readySampleCount: 0,
    approvals: [
      {
        sampleId: 'ru-5m',
        language: 'ru',
        durationBucket: '5m',
        durationSecondsTarget: 300,
        consentStatus: 'pending',
        transcriptOracleStatus: 'pending',
        qualityRubricId: 'asr-qa-v1',
        requiredActions: ['approve-sample-use'],
        mediaUrl: 'https://example.invalid/private-media',
      },
    ],
    executionGate: {
      canRun: true,
      runPlanStatus: 'blocked',
      requiredCaseCount: 27,
      assignmentCount: 1,
      resultArtifactPolicy: 'sanitized-benchmark-ledger-rows-only',
      providerCallPolicy: 'operator-run-only-after-approval',
    },
    blockedReasons: ['pending approvals'],
    validationErrors: [],
  })

  assert.ok(errors.includes('approvals[0].mediaUrl is not allowed in benchmark approval packets'))
  assert.ok(errors.includes('blocked or invalid packets must set executionGate.canRun false'))
  assert.ok(errors.includes('blocked or invalid packets must not have execution assignments'))
})

test('P4 approval packet validator rejects ready packets with incomplete counts', () => {
  const errors = validateBenchmarkApprovalPacketArtifact({
    product: 'Long Video Transcriber',
    packetType: 'p4-operator-benchmark-approval',
    status: 'ready',
    approvalCount: 1,
    requiredSampleCount: 2,
    readySampleCount: 1,
    approvals: [
      {
        sampleId: 'ru-5m',
        language: 'ru',
        durationBucket: '5m',
        durationSecondsTarget: 300,
        consentStatus: 'approved',
        transcriptOracleStatus: 'ready',
        qualityRubricId: 'asr-qa-v1',
        requiredActions: [],
      },
    ],
    executionGate: {
      canRun: true,
      runPlanStatus: 'ready',
      requiredCaseCount: 27,
      assignmentCount: 26,
      resultArtifactPolicy: 'sanitized-benchmark-ledger-rows-only',
      providerCallPolicy: 'operator-run-only-after-approval',
    },
    blockedReasons: [],
    validationErrors: [],
  })

  assert.ok(errors.includes('ready packets must mark every required sample ready'))
  assert.ok(errors.includes('ready packets must assign every required benchmark case'))
})

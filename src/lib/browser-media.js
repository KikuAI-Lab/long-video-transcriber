export function readMediaDuration(file) {
  return new Promise((resolve, reject) => {
    const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio')
    const objectUrl = URL.createObjectURL(file)
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
      element.removeAttribute('src')
      element.load()
    }

    element.preload = 'metadata'
    element.muted = true
    element.onloadedmetadata = () => {
      const duration = Number.isFinite(element.duration) ? element.duration : null
      cleanup()
      resolve(duration)
    }
    element.onerror = () => {
      cleanup()
      reject(new Error('Unable to read media metadata'))
    }
    element.src = objectUrl
  })
}

export async function decodeMediaAudioBuffer(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) {
    throw new Error('This browser does not expose AudioContext.')
  }

  const audioContext = new AudioContextClass()
  try {
    const audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer())
    return {
      adapterId: file.type.startsWith('video/') ? 'native-video-audio-decode' : 'native-audio-decode',
      audioBuffer,
      durationSeconds: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channelCount: audioBuffer.numberOfChannels,
    }
  } catch (error) {
    const fileKind = file.type.startsWith('video/') ? 'video audio track' : 'audio file'
    const reason = error instanceof Error ? error.message : 'unknown decode error'
    throw new Error(`This browser could not decode the ${fileKind} locally: ${reason}`)
  } finally {
    if (typeof audioContext.close === 'function') {
      await audioContext.close()
    }
  }
}

export function encodeAudioBufferChunkAsWav(audioBuffer, chunk) {
  const sampleRate = audioBuffer.sampleRate
  const startFrame = Math.max(0, Math.floor(chunk.startSeconds * sampleRate))
  const endFrame = Math.min(audioBuffer.length, Math.ceil(chunk.endSeconds * sampleRate))
  const frameCount = Math.max(1, endFrame - startFrame)
  const bytesPerSample = 2
  const headerBytes = 44
  const wavBytes = new Uint8Array(headerBytes + (frameCount * bytesPerSample))
  const view = new DataView(wavBytes.buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, wavBytes.length - 8, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, frameCount * bytesPerSample, true)

  let offset = headerBytes
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    let sample = 0
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      sample += audioBuffer.getChannelData(channel)[frame] || 0
    }
    sample /= Math.max(1, audioBuffer.numberOfChannels)
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Blob([wavBytes], { type: 'audio/wav' })
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

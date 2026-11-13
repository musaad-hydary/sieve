import { computeChroma, matchChord, estimateKey } from '../lib/chroma.js';

let port = null;

function connectPort() {
  if (port) return;  // already connected
  const p = chrome.runtime.connect({ name: 'offscreen' });
  port = p;
  p.onMessage.addListener(async (msg) => {
    if (msg.type === 'START_STREAM')         await startCapture(msg.streamId);
    else if (msg.type === 'STOP_STREAM')     stopCapture();
    else if (msg.type === 'DOWNLOAD_STREAM') await handleDownload(msg);
    else if (msg.type === 'DOWNLOAD_RECORDING') {
      if (!pendingRecUrl) return;
      const fmt = msg.format || 'webm';
      if (fmt === 'webm') {
        const ext = pendingRecMime?.includes('mp4') ? 'm4a' : 'webm';
        postToBackground({ type: 'TRIGGER_DOWNLOAD', url: pendingRecUrl,
                           filename: (msg.filename || 'recording') + '.' + ext,
                           isRecording: true });
      } else {
        convertRecording(pendingRecUrl, fmt, msg.filename || 'recording');
      }
    }
  });
  p.onDisconnect.addListener(() => {
    if (port !== p) return;  // stale port
    port = null;
    setTimeout(connectPort, 300);
  });
  // Tell background whether we're currently capturing so it can sync state after SW restart.
  try { p.postMessage({ type: 'OFFSCREEN_STATE', capturing: !!intervalId }); } catch {}
}

connectPort();

function postToBackground(msg) {
  try { if (port) port.postMessage(msg); } catch { port = null; }
}

let audioCtx  = null;
let analyser  = null;
let source    = null;
let stream    = null;
let intervalId = null;

let recorder        = null;
let recordingChunks = [];
let pendingRecUrl   = null;
let pendingRecMime  = null;

const SMOOTH_FRAMES    = 10;
const MIN_HOLD_MS      = 350;
const KEY_ACCUM_FRAMES = 50;

// Pre-allocated ring buffer — avoids per-frame Float32Array allocations
const _chromaRing  = Array.from({ length: SMOOTH_FRAMES }, () => new Float32Array(12));
const _smoothed    = new Float32Array(12);
let   _ringIdx     = 0;
let   _ringFill    = 0;

let keyAccumulator = new Float32Array(12).fill(0);
let keyFrameCount  = 0;
let lastChord      = { name: '—', root: -1, type: 'none', confidence: 0 };
let lastChordTime  = 0;

async function startCapture(streamId) {
  if (audioCtx) stopCapture();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    });
  } catch (err) {
    postToBackground({ type: 'ERROR', message: err.message });
    return;
  }

  stream.getAudioTracks().forEach(track => {
    track.addEventListener('ended', () => {
      stopCapture();
      postToBackground({ type: 'STREAM_ENDED' });
    });
  });

  audioCtx = new AudioContext({ sampleRate: 44100 });
  source   = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0.4;

  source.connect(analyser);
  analyser.connect(audioCtx.destination);
  await audioCtx.resume();

  // Record the tab audio in parallel with analysis so the user can download it
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  recordingChunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) recordingChunks.push(e.data); };
  recorder.start(1000);

  _ringIdx  = 0;
  _ringFill = 0;
  keyAccumulator = new Float32Array(12).fill(0);
  keyFrameCount  = 0;
  lastChord      = { name: '—', root: -1, type: 'none', confidence: 0 };
  lastChordTime  = 0;

  intervalId = setInterval(analyzeAudio, 100);
}

function stopCapture() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  if (source)     { source.disconnect(); source = null; }
  if (stream) {
    const s = stream;
    stream = null;
    s.getTracks().forEach(t => t.stop());
  }
  if (audioCtx)   { audioCtx.close(); audioCtx = null; }
  analyser = null;

  // Finalise the recording → notify panel once blob is ready
  if (recorder && recorder.state !== 'inactive') {
    const rec = recorder;
    recorder = null;
    rec.addEventListener('stop', () => {
      if (!recordingChunks.length) return;
      if (pendingRecUrl) URL.revokeObjectURL(pendingRecUrl);
      pendingRecUrl  = URL.createObjectURL(new Blob(recordingChunks, { type: rec.mimeType }));
      pendingRecMime = rec.mimeType;
      recordingChunks = [];
      postToBackground({ type: 'RECORDING_READY' });
    }, { once: true });
    rec.stop();
  } else {
    recorder = null;
  }
}

// ── Recording format conversion ────────────────────────────────────────────

async function convertRecording(blobUrl, format, basename) {
  try {
    postToBackground({ type: 'REC_CONVERTING' });
    const r   = await fetch(blobUrl);
    const ab  = await r.arrayBuffer();
    const ctx = new AudioContext();
    let buf;
    try { buf = await ctx.decodeAudioData(ab); }
    finally { ctx.close(); }

    let outBlob, ext;
    if (format === 'wav') {
      outBlob = encodeWav(buf);
      ext = 'wav';
    } else {
      outBlob = encodeMp3(buf);
      ext = 'mp3';
    }
    const url = URL.createObjectURL(outBlob);
    postToBackground({ type: 'TRIGGER_DOWNLOAD', url, filename: basename + '.' + ext, isRecording: true });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    postToBackground({ type: 'DL_ERROR', message: err.message });
  }
}

function encodeMp3(audioBuffer, bitrate = 128) {
  const nCh = audioBuffer.numberOfChannels;
  const sr  = audioBuffer.sampleRate;
  const enc = new lamejs.Mp3Encoder(nCh > 1 ? 2 : 1, sr, bitrate);

  const toInt16 = (f32) => {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i]  = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  };

  const ch0 = toInt16(audioBuffer.getChannelData(0));
  const ch1 = nCh > 1 ? toInt16(audioBuffer.getChannelData(1)) : ch0;

  const block = 1152;
  const parts = [];
  for (let i = 0; i < ch0.length; i += block) {
    const encoded = nCh > 1
      ? enc.encodeBuffer(ch0.subarray(i, i + block), ch1.subarray(i, i + block))
      : enc.encodeBuffer(ch0.subarray(i, i + block));
    if (encoded.length > 0) parts.push(new Uint8Array(encoded));
  }
  const tail = enc.flush();
  if (tail.length > 0) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: 'audio/mp3' });
}

// ── Download via blob (fetch → blob URL → chrome.downloads via panel) ─────

async function handleDownload({ url, filename, startSec, endSec, format }) {
  try {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`Stream unavailable (${r.status})`);

    const total  = parseInt(r.headers.get('content-length') || '0', 10);
    let loaded   = 0;
    const chunks = [];
    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      postToBackground({
        type: 'DL_PROGRESS',
        pct: total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : -1,
      });
    }

    let blobUrl, dlFilename;

    if (format === 'video') {
      blobUrl    = URL.createObjectURL(new Blob(chunks));
      dlFilename = filename;
    } else {
      // Audio: decode PCM then encode to mp3 or wav (with optional trim)
      const ab = new Uint8Array(loaded);
      let off = 0;
      for (const c of chunks) { ab.set(c, off); off += c.byteLength; }

      const ctx = new AudioContext();
      let buf;
      try { buf = await ctx.decodeAudioData(ab.buffer); }
      catch { throw new Error('Could not decode audio — stream may be encrypted'); }
      finally { ctx.close(); }

      if (startSec != null || endSec != null) {
        const start    = startSec ?? 0;
        const end      = Math.min(endSec ?? buf.duration, buf.duration);
        const duration = Math.max(0, end - start);
        if (duration <= 0) throw new Error('Trim start must be before end');
        const offline  = new OfflineAudioContext(
          buf.numberOfChannels, Math.ceil(duration * buf.sampleRate), buf.sampleRate,
        );
        const src = offline.createBufferSource();
        src.buffer = buf;
        src.connect(offline.destination);
        src.start(0, start, duration);
        buf = await offline.startRendering();
      }

      if (format === 'wav') {
        blobUrl    = URL.createObjectURL(encodeWav(buf));
        dlFilename = filename.replace(/\.\w+$/, '.wav');
      } else {
        blobUrl    = URL.createObjectURL(encodeMp3(buf));
        dlFilename = filename.replace(/\.\w+$/, '.mp3');
      }
    }

    postToBackground({ type: 'TRIGGER_DOWNLOAD', url: blobUrl, filename: dlFilename });
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    postToBackground({ type: 'DL_ERROR', message: err.message });
  }
}

function encodeWav(buf) {
  const nCh  = buf.numberOfChannels;
  const sr   = buf.sampleRate;
  const len  = buf.length;
  const data = len * nCh * 2;
  const ab   = new ArrayBuffer(44 + data);
  const v    = new DataView(ab);
  const s    = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };

  s(0, 'RIFF');  v.setUint32(4,  36 + data, true);   s(8, 'WAVE');
  s(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);               // PCM
  v.setUint16(22, nCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 2, true);   // byte rate
  v.setUint16(32, nCh * 2, true);        // block align
  v.setUint16(34, 16, true);             // bits per sample
  s(36, 'data'); v.setUint32(40, data, true);

  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < nCh; ch++) {
      const x = buf.getChannelData(ch)[i];
      v.setInt16(off, (x < 0 ? x * 0x8000 : x * 0x7FFF) | 0, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

function analyzeAudio() {
  if (!analyser) return;
  if (audioCtx?.state === 'suspended') { audioCtx.resume(); return; }

  computeChroma(analyser, _chromaRing[_ringIdx]);
  _ringIdx = (_ringIdx + 1) % SMOOTH_FRAMES;
  if (_ringFill < SMOOTH_FRAMES) _ringFill++;

  _smoothed.fill(0);
  for (let f = 0; f < _ringFill; f++) {
    for (let i = 0; i < 12; i++) _smoothed[i] += _chromaRing[f][i] / _ringFill;
  }

  const result = matchChord(_smoothed);
  const now    = Date.now();
  if (result.name !== lastChord.name && (now - lastChordTime) >= MIN_HOLD_MS) {
    lastChord     = result;
    lastChordTime = now;
  }

  for (let i = 0; i < 12; i++) keyAccumulator[i] += _smoothed[i];
  keyFrameCount++;

  let key = null;
  if (keyFrameCount >= KEY_ACCUM_FRAMES) {
    key = estimateKey(keyAccumulator);
    for (let i = 0; i < 12; i++) keyAccumulator[i] *= 0.5;
    keyFrameCount = Math.floor(KEY_ACCUM_FRAMES / 2);
  }

  postToBackground({
    type: 'CHORD_DATA',
    chord: lastChord.name, root: lastChord.root, chordType: lastChord.type,
    confidence: lastChord.confidence, chroma: Array.from(_smoothed), key,
  });
}

// Chromagram computation and chord template matching.
// Pure functions — no side effects, no Web Audio API references.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ── Chord templates (intervals from root) ──────────────────────────────────

const CHORD_TYPES = [
  { type: 'maj',  suffix: '',      intervals: [0, 4, 7]       },
  { type: 'min',  suffix: 'm',     intervals: [0, 3, 7]       },
  { type: '7',    suffix: '7',     intervals: [0, 4, 7, 10]   },
  { type: 'maj7', suffix: 'maj7',  intervals: [0, 4, 7, 11]   },
  { type: 'm7',   suffix: 'm7',    intervals: [0, 3, 7, 10]   },
  { type: 'dim',  suffix: 'dim',   intervals: [0, 3, 6]       },
  { type: 'aug',  suffix: 'aug',   intervals: [0, 4, 8]       },
  { type: 'sus2', suffix: 'sus2',  intervals: [0, 2, 7]       },
  { type: 'sus4', suffix: 'sus4',  intervals: [0, 5, 7]       },
];

// Pre-build and L2-normalize all 108 templates (12 roots × 9 types)
const ALL_TEMPLATES = [];
for (const { type, suffix, intervals } of CHORD_TYPES) {
  for (let root = 0; root < 12; root++) {
    const vec = new Float32Array(12).fill(0);
    for (const interval of intervals) vec[(root + interval) % 12] = 1;
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < 12; i++) vec[i] /= mag;
    ALL_TEMPLATES.push({ vec, root, type, name: NOTE_NAMES[root] + suffix });
  }
}

// ── computeChroma ──────────────────────────────────────────────────────────
// Reads frequency data from a Web Audio AnalyserNode and returns a
// 12-element Float32Array (one value per pitch class, C=0 … B=11).

let _fftBuf = null;

export function computeChroma(analyser, chroma) {
  const bufLen = analyser.frequencyBinCount;
  if (!_fftBuf || _fftBuf.length !== bufLen) _fftBuf = new Float32Array(bufLen);
  analyser.getFloatFrequencyData(_fftBuf);
  const fftData = _fftBuf;

  const sr = analyser.context.sampleRate;
  const fftSize = analyser.fftSize;
  if (!chroma) chroma = new Float32Array(12);
  chroma.fill(0);

  for (let k = 1; k < bufLen; k++) {
    const freq = (k * sr) / fftSize;
    // Restrict to audible musical range: C2 (65 Hz) → C8 (4186 Hz)
    if (freq < 65) continue;
    if (freq > 4200) break;

    const db = fftData[k];
    if (!isFinite(db)) continue;

    // Map frequency → pitch class via MIDI note number (A4 = MIDI 69 = 440 Hz)
    const midi = 12 * Math.log2(freq / 440) + 69;
    const pitchClass = ((Math.round(midi) % 12) + 12) % 12;

    // dB → linear power
    chroma[pitchClass] += Math.pow(10, Math.max(db, -100) / 10);
  }

  // Normalize to [0, 1]
  const max = Math.max(...chroma, 1e-10);
  for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

// ── matchChord ─────────────────────────────────────────────────────────────
// Cosine-similarity match of a chroma vector against all templates.
// Returns { name, root, type, confidence } where confidence ∈ [0, 1].

const _norm = new Float32Array(12);

export function matchChord(chroma) {
  let mag = 0;
  for (let i = 0; i < 12; i++) mag += chroma[i] * chroma[i];
  mag = Math.sqrt(mag);
  if (mag < 1e-10) return { name: '—', root: -1, type: 'none', confidence: 0 };
  for (let i = 0; i < 12; i++) _norm[i] = chroma[i] / mag;

  let best = -Infinity;
  let match = null;
  for (const tmpl of ALL_TEMPLATES) {
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += _norm[i] * tmpl.vec[i];
    if (dot > best) { best = dot; match = tmpl; }
  }

  return {
    name: match.name,
    root: match.root,
    type: match.type,
    confidence: Math.max(0, Math.min(1, best)),
  };
}

// ── estimateKey ────────────────────────────────────────────────────────────
// Krumhansl-Schmuckler key-finding over an accumulated chroma vector.
// Returns { name, mode } e.g. { name: 'G', mode: 'major' }.

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function ksCorrelate(chroma, profile) {
  const n = 12;
  const meanC = chroma.reduce((a, b) => a + b, 0) / n;
  const meanP = profile.reduce((a, b) => a + b, 0) / n;
  let num = 0, dC = 0, dP = 0;
  for (let i = 0; i < n; i++) {
    const dc = chroma[i] - meanC, dp = profile[i] - meanP;
    num += dc * dp; dC += dc * dc; dP += dp * dp;
  }
  return num / (Math.sqrt(dC * dP) + 1e-10);
}

export function estimateKey(accumulated) {
  let best = -Infinity, bestRoot = 0, bestMode = 'major';
  for (let root = 0; root < 12; root++) {
    const rotated = accumulated.map((_, i) => accumulated[(i + root) % 12]);
    const majR = ksCorrelate(rotated, KS_MAJOR);
    const minR = ksCorrelate(rotated, KS_MINOR);
    if (majR > best) { best = majR; bestRoot = root; bestMode = 'major'; }
    if (minR > best) { best = minR; bestRoot = root; bestMode = 'minor'; }
  }
  return { name: NOTE_NAMES[bestRoot], mode: bestMode };
}

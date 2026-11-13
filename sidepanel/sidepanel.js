// ── Canvas setup ───────────────────────────────────────────────────────────

const canvas = document.getElementById('bh-canvas');
const ctx    = canvas.getContext('2d');

const LW = 356, LH = 262;
const dpr = window.devicePixelRatio || 1;
// Set physical resolution; CSS width:100%/height:auto handles display scaling.
// Do NOT set canvas.style.width/height — that would overflow narrow side panels.
canvas.width  = LW * dpr;
canvas.height = LH * dpr;
ctx.scale(dpr, dpr);

const CX = LW / 2;
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const FLAT_MAP = {'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb'};
let useFlatNotation = localStorage.getItem('sieve_flats') === '1';

function toFlat(str) {
  if (!str || !useFlatNotation) return str;
  if (str.length >= 2 && str[1] === '#') return (FLAT_MAP[str.slice(0,2)] || str.slice(0,2)) + str.slice(2);
  return str;
}
function noteName(i) { const n = NOTE_NAMES[i]; return useFlatNotation && FLAT_MAP[n] ? FLAT_MAP[n] : n; }

const CHORD_TYPES = {
  '':    [0,4,7], 'maj': [0,4,7],   '5':   [0,7],
  'm':   [0,3,7], 'min': [0,3,7],
  '7':   [0,4,7,10],  'maj7': [0,4,7,11],  'm7':  [0,3,7,10],
  'dim': [0,3,6],     'dim7': [0,3,6,9],   'm7b5':[0,3,6,10],
  'aug': [0,4,8],
  'sus2':[0,2,7],     'sus4': [0,5,7],
  '6':   [0,4,7,9],   'm6':   [0,3,7,9],
  'add9':[0,4,7,2],   '9':    [0,4,7,10,2], 'maj9':[0,4,7,11,2], 'm9':[0,3,7,10,2],
};
function chordNotes(name) {
  if (!name || name === '—') return null;
  const root = name.length >= 2 && name[1] === '#' ? name.slice(0,2) : name[0];
  const type = name.slice(root.length);
  const idx  = NOTE_NAMES.indexOf(root);
  if (idx === -1) return null;
  const ivs  = CHORD_TYPES[type];
  if (!ivs) return null;
  return ivs.map(i => noteName((idx + i) % 12));
}

// Sieve geometry
const SV_X  = 14;
const SV_W  = LW - 28;
const SV_Y  = 105;
const SV_H  = 52;
const HR    = 9.5;      // hole radius
const COLS  = 6;
const COL_W = SV_W / COLS;

function holePos(noteIdx) {
  const col = noteIdx % COLS;
  const row = Math.floor(noteIdx / COLS);
  return {
    x: SV_X + (col + 0.5) * COL_W,
    y: SV_Y + 6 + row * (SV_H / 2) + HR,
  };
}

// ── Animation state ────────────────────────────────────────────────────────

let chromaVis        = new Float32Array(12);
let displayChord     = '—';
let displayConf      = 0;
let chordFlashAt     = 0;
let particles        = [];   // all particles
let pBelow           = [];   // passing particles below sieve (drawn behind it)
let frameCount       = 0;
let captureStartTime = null;

// Sieve shake — fixed amplitude stored separately from decaying position
let shakeAmp0 = 0;   // original amplitude set by trigger
let shakeT    = 0;   // time since trigger (frames)
let shakeX    = 0;   // current pixel offset

function triggerShake(amp = 5) {
  shakeAmp0 = amp;
  shakeT    = 0;
}

function spawnParticle() {
  const noteIdx = Math.floor(Math.random() * 12);
  const { x: tx } = holePos(noteIdx);
  particles.push({
    noteIdx,
    x:  SV_X + 10 + Math.random() * (SV_W - 20),
    tx,                               // column target x — drifts toward it
    y:  -8 - Math.random() * 24,
    vy: 0.6 + Math.random() * 0.55,
    state: 'falling',                 // → 'passing' | 'filtered'
    alpha: 0.45 + Math.random() * 0.4,
  });
}

// ── Themes ─────────────────────────────────────────────────────────────────

function rgba(rgb, a) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }

const THEMES = {
  navy:     { label:'NAVY',     bg:'#07091a', text:'#d4b85a',
    ct:{ bg:'#07091a', sieve:'#131a48', hole:'#080c28', ink:[212,184,90],  hot:[255,230,140] },
    css:{'--bg':'#07091a','--surface':'#0b0d22','--surface2':'#0f1230','--border':'rgba(200,168,75,0.18)','--border2':'rgba(200,168,75,0.40)','--accent':'#c8a84b','--accent-dim':'rgba(200,168,75,.14)','--accent-glow':'rgba(200,168,75,.40)','--text':'#d4b85a','--text-dim':'rgba(212,184,90,0.5)','--muted':'rgba(212,184,90,0.65)','--danger':'#ff9944','--key':'#131a48','--key-dark':'#080c28','--key-border':'rgba(200,168,75,0.65)'} },
  crimson:  { label:'CRIMSON',  bg:'#6e0d0d', text:'#f5ede4',
    ct:{ bg:'#6e0d0d', sieve:'#420808', hole:'#1e0404', ink:[245,237,228], hot:[255,240,210] },
    css:{'--bg':'#6e0d0d','--surface':'#5a0b0b','--surface2':'#4a0909','--border':'rgba(0,0,0,0.25)','--border2':'rgba(0,0,0,0.45)','--accent':'#f5ede4','--accent-dim':'rgba(245,237,228,.12)','--accent-glow':'rgba(245,237,228,.30)','--text':'#f5ede4','--text-dim':'rgba(245,237,228,0.5)','--muted':'rgba(245,237,228,0.65)','--danger':'#fff0e0','--key':'#5a0b0b','--key-dark':'#380808','--key-border':'rgba(245,237,228,0.30)'} },
  amber:    { label:'AMBER',    bg:'#4a3200', text:'#e8c050',
    ct:{ bg:'#4a3200', sieve:'#2e1e00', hole:'#1e1200', ink:[232,192,80], hot:[255,224,100] },
    css:{'--bg':'#4a3200','--surface':'#3c2800','--surface2':'#301e00','--border':'rgba(255,160,0,0.18)','--border2':'rgba(255,160,0,0.40)','--accent':'#e8c050','--accent-dim':'rgba(232,192,80,.12)','--accent-glow':'rgba(232,192,80,.40)','--text':'#e8c050','--text-dim':'rgba(232,192,80,0.5)','--muted':'rgba(232,192,80,0.65)','--danger':'#ff8822','--key':'#3c2800','--key-dark':'#261800','--key-border':'rgba(232,192,80,0.65)'} },
  violet:   { label:'VIOLET',   bg:'#180030', text:'#dab8ff',
    ct:{ bg:'#180030', sieve:'#380068', hole:'#120024', ink:[218,184,255], hot:[248,220,255] },
    css:{'--bg':'#180030','--surface':'#220045','--surface2':'#2c0058','--border':'rgba(200,140,255,0.20)','--border2':'rgba(200,140,255,0.45)','--accent':'#cc88ff','--accent-dim':'rgba(204,136,255,.16)','--accent-glow':'rgba(204,136,255,.45)','--text':'#dab8ff','--text-dim':'rgba(218,184,255,0.52)','--muted':'rgba(218,184,255,0.68)','--danger':'#ff88cc','--key':'#380068','--key-dark':'#1e0040','--key-border':'rgba(200,140,255,0.70)'} },
  mono:     { label:'MONO',     bg:'#1a1a1a', text:'#dcdcdc',
    ct:{ bg:'#1a1a1a', sieve:'#2a2a2a', hole:'#0d0d0d', ink:[79,200,208], hot:[240,128,48] },
    css:{'--bg':'#1a1a1a','--surface':'#242424','--surface2':'#2e2e2e','--border':'rgba(255,255,255,0.09)','--border2':'rgba(255,255,255,0.20)','--accent':'#4fc8d0','--accent-dim':'rgba(79,200,208,.13)','--accent-glow':'rgba(79,200,208,.38)','--text':'#dcdcdc','--text-dim':'rgba(220,220,220,0.48)','--muted':'rgba(220,220,220,0.62)','--danger':'#f08030','--key':'#2a2a2a','--key-dark':'#111111','--key-border':'rgba(255,255,255,0.20)'} },
};

let CT = THEMES.navy.ct;
CT.c = {
  ink18: rgba(CT.ink, 0.18), ink22: rgba(CT.ink, 0.22),
  ink50: rgba(CT.ink, 0.50), ink55: rgba(CT.ink, 0.55),
  ink60: rgba(CT.ink, 0.60), ink65: rgba(CT.ink, 0.65),
  ink95: rgba(CT.ink, 0.95), inkShadow: rgba(CT.ink, 0.20),
  hot40: rgba(CT.hot, 0.40),
};
let _fogGradient = null;

// ── Draw helpers ───────────────────────────────────────────────────────────

function rrect(x, y, w, h, r) {
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); }
  else               { ctx.rect(x, y, w, h); }
}

function drawParticle(p, sx = 0) {
  const passing = p.state === 'passing';
  const px = p.y >= SV_Y - 20 && p.y <= SV_Y + SV_H ? p.x + sx : p.x;

  if (passing) {
    ctx.shadowColor = CT.c.hot40;
    ctx.shadowBlur  = 5;
  }

  const hs = passing ? 6 : 5;
  ctx.beginPath();
  ctx.rect(px - hs, p.y - hs, hs * 2, hs * 2);
  ctx.fillStyle = passing ? rgba(CT.hot, p.alpha * 0.9) : rgba(CT.ink, p.alpha * 0.55);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.font         = `9px 'Windraw','Courier New',serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = passing ? rgba(CT.hot, p.alpha) : rgba(CT.ink, p.alpha * 0.65);
  ctx.fillText(noteName(p.noteIdx), px, p.y);
}

function drawSieve() {
  // Body
  ctx.beginPath();
  ctx.rect(SV_X, SV_Y, SV_W, SV_H);
  ctx.fillStyle   = CT.sieve;
  ctx.fill();
  const anyActive = chromaVis.some(v => v > 0.25);
  ctx.strokeStyle = anyActive ? CT.c.ink60 : CT.c.ink18;
  ctx.lineWidth   = anyActive ? 1.5 : 1;
  ctx.shadowColor = anyActive ? CT.c.inkShadow : 'transparent';
  ctx.shadowBlur  = anyActive ? 10 : 0;
  ctx.stroke();
  ctx.shadowBlur  = 0;

  // Mesh lines — single batched path
  ctx.save();
  ctx.beginPath();
  ctx.rect(SV_X, SV_Y, SV_W, SV_H);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth   = 0.5;
  ctx.beginPath();
  for (let gx = SV_X + 10; gx < SV_X + SV_W; gx += 10) {
    ctx.moveTo(gx, SV_Y); ctx.lineTo(gx, SV_Y + SV_H);
  }
  for (let gy = SV_Y + 8; gy < SV_Y + SV_H; gy += 8) {
    ctx.moveTo(SV_X, gy); ctx.lineTo(SV_X + SV_W, gy);
  }
  ctx.stroke();
  ctx.restore();

  // Holes
  for (let i = 0; i < 12; i++) {
    const { x, y } = holePos(i);
    const v        = chromaVis[i];
    const active   = v > 0.25;

    // Hole fill
    ctx.beginPath();
    ctx.rect(x - HR, y - HR, HR * 2, HR * 2);
    ctx.fillStyle = active ? rgba(CT.ink, 0.1 + v * 0.18) : CT.hole;
    ctx.fill();

    // Hole rim
    ctx.beginPath();
    ctx.rect(x - HR, y - HR, HR * 2, HR * 2);
    if (active) {
      ctx.strokeStyle = rgba(CT.ink, 0.4 + v * 0.6);
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = rgba(CT.hot, v * 0.7);
      ctx.shadowBlur  = 10;
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth   = 1;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Note label inside hole
    ctx.font         = `8px 'Windraw','Courier New',serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = active ? rgba(CT.ink, 0.65 + v * 0.35) : CT.c.ink22;
    ctx.fillText(noteName(i), x, y);
  }
}

function drawChordDisplay() {
  const flashAge = Math.min(1, (Date.now() - chordFlashAt) / 600);
  const pulse    = flashAge < 1 ? Math.sin(flashAge * Math.PI) : 0;

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  if (displayChord !== '—') {
    ctx.shadowColor = rgba(CT.ink, 0.25 + pulse * 0.4);
    ctx.shadowBlur  = 6 + pulse * 12;
  }
  ctx.font      = `36px 'Windraw','Courier New',serif`;
  ctx.fillStyle = displayChord !== '—'
    ? (pulse > 0 ? rgba(CT.ink, 0.95 + pulse * 0.05) : CT.c.ink95)
    : CT.c.ink22;
  ctx.fillText(toFlat(displayChord), CX, 207);
  ctx.shadowBlur = 0;

  if (displayConf > 0) {
    ctx.font      = `11px 'Windraw','Courier New',serif`;
    ctx.fillStyle = CT.c.ink50;
    ctx.fillText(`${Math.round(displayConf * 100)}%`, CX, 235);
  }
}

// ── Main draw loop ─────────────────────────────────────────────────────────

function draw() {
  requestAnimationFrame(draw);
  frameCount++;

  if (captureStartTime) {
    if (frameCount % 12 === 0) spawnParticle();
    if (frameCount % 12 === 6) spawnParticle();
  }

  // Clear
  ctx.fillStyle = CT.bg;
  ctx.fillRect(0, 0, LW, LH);

  if (!_fogGradient) {
    _fogGradient = ctx.createLinearGradient(0, 0, 0, LH);
    _fogGradient.addColorStop(0,   'rgba(0,0,0,0.28)');
    _fogGradient.addColorStop(0.4, 'rgba(0,0,0,0)');
    _fogGradient.addColorStop(1,   'rgba(0,0,0,0.38)');
  }
  ctx.fillStyle = _fogGradient;
  ctx.fillRect(0, 0, LW, LH);

  // Tick shake — damped sine. shakeAmp0 stays fixed; only shakeT advances.
  if (shakeAmp0 > 0.05) {
    shakeT += 0.2;
    shakeX  = shakeAmp0 * Math.sin(shakeT * 10) * Math.exp(-shakeT * 1.8);
    if (shakeT > 3.5) { shakeAmp0 = 0; shakeX = 0; shakeT = 0; }
  } else {
    shakeX = 0;
  }

  // Draw passing particles BELOW the sieve (pre-sorted list)
  for (const p of pBelow) drawParticle(p, 0);

  // Sieve mesh — translated by shake offset
  ctx.save();
  ctx.translate(shakeX, 0);
  drawSieve();
  ctx.restore();

  // Draw all other particles (above/on sieve, translated with shake)
  for (const p of particles) drawParticle(p, shakeX);

  // Chord name + confidence
  drawChordDisplay();

  // ── Update particles ──
  pBelow.length = 0;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    if (p.state === 'falling') {
      p.y  += p.vy;
      p.x  += (p.tx - p.x) * 0.022;
      if (p.y + 4.5 >= SV_Y) {
        p.state = chromaVis[p.noteIdx] > 0.25 ? 'passing' : 'filtered';
      }
    } else if (p.state === 'passing') {
      p.y += p.vy * 0.8;
      if (p.y > SV_Y + SV_H + 50) p.alpha -= 0.022;
    } else {
      p.alpha -= 0.05;
      p.y     -= 0.3;
    }

    if (p.alpha <= 0 || p.y > LH + 10) {
      particles.splice(i, 1);
    } else if (p.state === 'passing' && p.y > SV_Y + SV_H) {
      pBelow.push(p);
    }
  }
}

draw();

// ── Port to service worker ─────────────────────────────────────────────────
// MV3 service workers are killed after ~30 s of idle. We reconnect automatically
// so a user clicking the button after a pause never hits a silent throw.

let bgPort = null;

function connectBg() {
  if (bgPort) return;  // already connected; don't create a second port
  const p = chrome.runtime.connect({ name: 'sidepanel' });
  bgPort = p;
  p.onMessage.addListener((msg) => {
    if (msg.type === 'CHORD_DATA') {
      onChordData(msg);
    } else if (msg.type === 'STREAM_ENDED') {
      doStop();
    } else if (msg.type === 'ERROR') {
      captureStartTime = null;
      stopTimer();
      setStatus(msg.message || 'capture failed', 'error');
      document.getElementById('btn-start').disabled = false;
      document.getElementById('btn-stop').disabled  = true;
    } else if (msg.type === 'RECORDING_READY') {
      const dlBtn = document.getElementById('btn-results-dl');
      dlBtn.textContent = '[ download ]';
      dlBtn.disabled = false;
      document.getElementById('res-fmt-picker').style.display = 'flex';
    } else if (msg.type === 'TRIGGER_DOWNLOAD') {
      const btn = document.getElementById('btn-results-dl');
      chrome.downloads.download({ url: msg.url, filename: msg.filename, saveAs: true }, () => {
        if (chrome.runtime.lastError) {
          btn.textContent = '[ download ]'; btn.disabled = false;
        } else {
          btn.textContent = '[ saved ]'; btn.disabled = true;
        }
      });
    } else if (msg.type === 'DL_ERROR') {
      const rdl = document.getElementById('btn-results-dl');
      rdl.textContent = '[ download ]';
      rdl.disabled = false;
    } else if (msg.type === 'INVOKE_CAPTURE') {
      // Icon was clicked — store tab + pre-obtained stream ID for when user clicks capture.
      invokedTab       = { id: msg.tabId, url: msg.url, title: msg.title, favIconUrl: msg.favIconUrl };
      _pendingStreamId = msg.streamId || null;
    } else if (msg.type === 'INVOKED_TAB') {
      invokedTab = { id: msg.tabId, url: msg.url, title: msg.title, favIconUrl: msg.favIconUrl };
    }
  });
  p.onDisconnect.addListener(() => {
    if (bgPort !== p) return;  // stale port — a newer port already replaced us
    bgPort = null;
    if (captureStartTime) doStop();   // reset UI if SW died mid-capture
    setTimeout(connectBg, 300);       // reconnect once SW has had time to restart
  });
}

connectBg();

// Safe wrapper — never throws even if the port is mid-reconnect
function sendToBg(msg) {
  try {
    if (!bgPort) connectBg();
    bgPort.postMessage(msg);
  } catch {
    bgPort = null;
    setTimeout(connectBg, 300);
  }
}

// ── Tab switching ──────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Collapsible sections ───────────────────────────────────────────────────

const COLLAPSE_KEY = 'sieve_collapsed';
const collapsed    = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));

function saveCollapsed() {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
}

document.querySelectorAll('.sec-header').forEach((header) => {
  const targetId = header.dataset.target;
  const body     = document.getElementById(targetId);
  const btn      = header.querySelector('.collapse-btn');
  if (!body || !btn) return;   // guard: missing element would crash the whole script

  // Restore saved state
  if (collapsed.has(targetId)) {
    body.classList.add('collapsed');
    btn.classList.add('collapsed');
  }

  header.addEventListener('click', () => {
    const isNowCollapsed = body.classList.toggle('collapsed');
    btn.classList.toggle('collapsed', isNowCollapsed);
    if (isNowCollapsed) collapsed.add(targetId);
    else                collapsed.delete(targetId);
    saveCollapsed();
  });
});

// ── Piano ──────────────────────────────────────────────────────────────────

// Build piano DOM once
(function buildPiano() {
  const container = document.getElementById('piano-keys');
  if (!container) return;   // guard: missing if HTML is stale — don't crash the script
  const W = 1 / 7;  // fraction of container width per white key
  const BW = W * 0.60;

  const whites = [
    { note: 0,  left: W * 0 },
    { note: 2,  left: W * 1 },
    { note: 4,  left: W * 2 },
    { note: 5,  left: W * 3 },
    { note: 7,  left: W * 4 },
    { note: 9,  left: W * 5 },
    { note: 11, left: W * 6 },
  ];
  const blacks = [
    { note: 1,  left: W * 1 - BW / 2 },
    { note: 3,  left: W * 2 - BW / 2 },
    { note: 6,  left: W * 4 - BW / 2 },
    { note: 8,  left: W * 5 - BW / 2 },
    { note: 10, left: W * 6 - BW / 2 },
  ];

  whites.forEach(({ note, left }) => {
    const el = document.createElement('div');
    el.className = 'piano-white';
    el.dataset.note = note;
    el.style.left = `${left * 100}%`;
    container.appendChild(el);
  });
  blacks.forEach(({ note, left }) => {
    const el = document.createElement('div');
    el.className = 'piano-black';
    el.dataset.note = note;
    el.style.left = `${left * 100}%`;
    container.appendChild(el);
  });
})();

function updatePiano(chroma) {
  document.querySelectorAll('#piano-keys [data-note]').forEach((key) => {
    const v = chroma[parseInt(key.dataset.note)];
    key.classList.toggle('active', v > 0.2);
  });
}

// ── Chord history state ────────────────────────────────────────────────────

const holdHistory = [];
let curChord      = null;
let curChordStart = 0;
const MAX_HOLDS   = 200;
let _pendingStreamId = null;  // stream ID pre-obtained by background on icon click

const progression = [];
const MAX_PROG    = 48;

// ── Time window picker ─────────────────────────────────────────────────────

let windowMs = 10_000;   // Infinity = manual stop
document.querySelectorAll('input[name="win"]').forEach((r) => {
  r.addEventListener('change', () => {
    windowMs = r.value === 'inf' ? Infinity : parseInt(r.value, 10) * 1000;
    renderTopChords();
    // If already capturing and user switched to a finite window, restart auto-stop
    if (captureStartTime) rescheduleAutoStop();
  });
});

// ── Timer + auto-stop ─────────────────────────────────────────────────────

let timerInterval     = null;
let autoStopTimeout   = null;
let lastKey           = null;
let lastKeyRaw        = null;
let captureTabUrl     = null;
let captureTabTitle   = null;
let captureTabFavicon = null;

function startTimer() {
  captureStartTime = Date.now();
  document.getElementById('timer-track').style.display = 'block';
  timerInterval = setInterval(tickTimer, 350);
  rescheduleAutoStop();
}

function rescheduleAutoStop() {
  clearTimeout(autoStopTimeout);
  autoStopTimeout = null;
  if (isFinite(windowMs) && captureStartTime) {
    const remaining = windowMs - (Date.now() - captureStartTime);
    if (remaining > 0) {
      autoStopTimeout = setTimeout(doStop, remaining);
    } else {
      doStop();
    }
  }
}

function tickTimer() {
  if (!captureStartTime) return;
  const elapsed = Date.now() - captureStartTime;
  document.getElementById('timer-text').textContent = formatTime(elapsed);
  if (isFinite(windowMs)) {
    document.getElementById('timer-fill').style.width =
      `${Math.min(100, (elapsed / windowMs) * 100)}%`;
  } else {
    document.getElementById('timer-fill').style.width =
      `${((elapsed % 60_000) / 60_000) * 100}%`;
  }

  const holdEl = document.getElementById('chord-hold');
  if (curChord && curChordStart) {
    holdEl.textContent = `${toFlat(curChord)} · ${((Date.now() - curChordStart) / 1000).toFixed(1)}s`;
    holdEl.style.display = '';
  } else {
    holdEl.style.display = 'none';
  }
}

function stopTimer() {
  clearInterval(timerInterval);
  clearTimeout(autoStopTimeout);
  timerInterval = autoStopTimeout = null;
  document.getElementById('timer-track').style.display = 'none';
  document.getElementById('timer-text').textContent = '';
  document.getElementById('timer-fill').style.width = '0%';
  document.getElementById('conf-fill').style.width = '0%';
  document.getElementById('chord-hold').style.display = 'none';
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Capture buttons ────────────────────────────────────────────────────────

const forcedTabId = new URLSearchParams(location.search).get('tabId');
let invokedTab = null;  // set by background when icon is clicked; takes priority over forcedTabId

function doStop() {
  if (!captureStartTime) return;   // already stopped / overlay already showing
  const startedAt = captureStartTime;
  captureStartTime = null;         // clear immediately — prevents double-fire from SW reconnect

  sendToBg({ type: 'STOP_CAPTURE' });
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-stop').disabled  = true;
  setStatus('idle', '');
  stopTimer();
  saveSession(startedAt);
  showCaptureResults(startedAt);
}

function ytThumbUrl(url) {
  const m = url?.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
}

function showCaptureResults(startedAt) {
  const dur = startedAt ? Date.now() - startedAt : 0;

  document.getElementById('res-dur').textContent = formatTime(dur);
  document.getElementById('res-key').textContent = lastKey || '—';

  // Top chords across the whole session (ignore window cutoff for the summary)
  const all = [...holdHistory];
  if (curChord) all.push({ chord: curChord, start: curChordStart, end: Date.now() });
  const totals = {};
  for (const h of all) totals[h.chord] = (totals[h.chord] || 0) + (h.end - h.start);
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => toFlat(c));
  document.getElementById('res-chords').textContent = top.join('  ·  ') || '—';

  // Last ~8 progression steps
  document.getElementById('res-prog').textContent = progression.slice(-8).map(c => toFlat(c)).join(' → ') || '—';

  // Thumbnail (YouTube only)
  const thumb = document.getElementById('res-thumb');
  const thumbUrl = ytThumbUrl(captureTabUrl);
  if (thumbUrl) {
    thumb.src = thumbUrl;
    thumb.style.display = 'block';
    thumb.onerror = () => { thumb.style.display = 'none'; };
  } else {
    thumb.style.display = 'none';
    thumb.src = '';
  }

  // Title — strip trailing site suffix
  const titleEl = document.getElementById('res-title');
  if (captureTabTitle) {
    const clean = captureTabTitle
      .replace(/\s*[-–—]\s*YouTube\s*$/i, '')
      .replace(/\s*\|\s*Spotify\s*$/i, '')
      .replace(/\s*[-–—]\s*SoundCloud\s*$/i, '')
      .trim();
    titleEl.textContent = clean || captureTabTitle;
    titleEl.style.display = '';
  } else {
    titleEl.style.display = 'none';
  }

  // Download button — always show, starts disabled until recording is finalised
  const dlBtn = document.getElementById('btn-results-dl');
  dlBtn.style.display = '';
  dlBtn.textContent = '[ preparing… ]';
  dlBtn.disabled = true;

  document.getElementById('capture-results').style.display = 'flex';
}

document.getElementById('btn-results-ok').addEventListener('click', () => {
  document.getElementById('capture-results').style.display = 'none';
  document.getElementById('res-fmt-picker').style.display = 'none';
  resetDisplay();
});

document.getElementById('btn-results-dl').addEventListener('click', () => {
  const title = captureTabTitle
    ?.replace(/\s*[-–—]\s*YouTube\s*$/i, '')
    ?.replace(/\s*\|\s*Spotify\s*$/i, '')
    ?.replace(/\s*[-–—]\s*SoundCloud\s*$/i, '')
    ?.trim() || 'recording';
  const fmt = document.querySelector('input[name="res-fmt"]:checked')?.value || 'mp3';
  sendToBg({ type: 'DOWNLOAD_RECORDING', filename: title, format: fmt });
  const btn = document.getElementById('btn-results-dl');
  btn.disabled = true;
  btn.textContent = fmt === 'webm' ? '[ saving… ]' : '[ converting… ]';
});

const isWeb = url => url?.startsWith('https://') || url?.startsWith('http://');

function getTargetTab(callback) {
  // Most recent icon-click target takes priority — that's the tab with activeTab grant.
  if (invokedTab?.id) {
    chrome.tabs.get(invokedTab.id, (t) => callback(chrome.runtime.lastError ? invokedTab : t));
    return;
  }
  if (forcedTabId) {
    const id = parseInt(forcedTabId, 10);
    chrome.tabs.get(id, (tab) => callback(chrome.runtime.lastError ? { id } : tab));
    return;
  }
  // Prefer a tab that is audible (actively playing audio) — this finds YouTube
  // even if the user has switched focus to the side panel or another tab.
  chrome.tabs.query({ audible: true }, (audible) => {
    const playing = audible.find(t => isWeb(t.url));
    if (playing) { callback(playing); return; }
    // Fall back to active tab in the last focused normal window
    chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] }, (win) => {
      if (!chrome.runtime.lastError && win?.tabs) {
        const active = win.tabs.find(t => t.active && isWeb(t.url));
        if (active) { callback(active); return; }
      }
      chrome.tabs.query({}, (all) => callback(all.find(t => isWeb(t.url))));
    });
  });
}

function startCaptureWithStream(streamId, tab) {
  invokedTab        = null;
  captureTabUrl     = tab.url        || null;
  captureTabTitle   = tab.title      || null;
  captureTabFavicon = tab.favIconUrl || null;
  sendToBg({ type: 'INIT_CAPTURE', streamId });
  document.getElementById('btn-start').disabled = true;
  document.getElementById('btn-stop').disabled  = false;
  let origin = 'unknown tab';
  try { if (captureTabUrl) origin = new URL(captureTabUrl).hostname.replace(/^www\./, ''); } catch {}
  setStatus(`capturing ${origin}`, 'capturing');
  startTimer();
}

function doCapture() {
  if (captureStartTime) return;
  document.getElementById('btn-start').disabled = true;

  // If background pre-obtained a stream ID from the icon click, use it directly.
  if (_pendingStreamId && invokedTab) {
    const sid = _pendingStreamId;
    const tab = invokedTab;
    _pendingStreamId = null;
    startCaptureWithStream(sid, tab);
    return;
  }

  getTargetTab((tab) => {
    if (!tab?.id) {
      document.getElementById('btn-start').disabled = false;
      setStatus('no capturable tab found — open a website', 'error');
      return;
    }
    chrome.tabCapture.getMediaStreamId({}, (streamId) => {
      if (chrome.runtime.lastError) {
        document.getElementById('btn-start').disabled = false;
        invokedTab = null;
        const raw = chrome.runtime.lastError.message || 'capture failed';
        if (raw.includes('has not been invoked') || raw.includes('activeTab')) {
          setStatus("click the ⊕ icon on the tab you want — or enable 'On all sites' in extension settings", 'error');
        } else if (raw.includes('chrome://') || raw.includes('chrome-extension://') || raw.includes('Chrome pages')) {
          setStatus("can't capture browser pages — switch to a website tab", 'error');
        } else {
          setStatus(raw, 'error');
        }
        return;
      }
      startCaptureWithStream(streamId, tab);
    });
  });
}

document.getElementById('btn-start').addEventListener('click', doCapture);

document.getElementById('btn-stop').addEventListener('click', doStop);

// ── Main data handler ──────────────────────────────────────────────────────

function onChordData({ chord, confidence, chroma, key }) {
  const c = Array.isArray(chroma) || chroma instanceof Float32Array ? chroma : Object.values(chroma || {});
  const maxC = Math.max(...c, 0.0001);
  for (let i = 0; i < 12; i++) {
    const v = (c[i] ?? 0) / maxC;
    chromaVis[i] = chromaVis[i] * 0.55 + v * 0.45;
  }

  updatePiano(chromaVis);

  if (key) {
    lastKeyRaw = key;
    lastKey = `${toFlat(key.name)} ${key.mode}`;
    document.getElementById('key-name').textContent = lastKey;
  }

  const now = Date.now();
  if (chord && chord !== '—') {
    if (chord !== displayChord) {
      chordFlashAt = now;
      displayChord = chord;
      triggerShake(7);
    }
    displayConf = confidence;

    // History
    if (chord !== curChord) {
      if (curChord) {
        holdHistory.push({ chord: curChord, start: curChordStart, end: now });
        if (holdHistory.length > MAX_HOLDS) holdHistory.shift();
      }
      curChord      = chord;
      curChordStart = now;

      if (progression[progression.length - 1] !== chord) {
        progression.push(chord);
        if (progression.length > MAX_PROG) progression.shift();
        renderProgression();
      }
    }
  }

  document.getElementById('conf-fill').style.width = `${Math.round((confidence || 0) * 100)}%`;
  renderTopChords();
}

// ── Top chords ─────────────────────────────────────────────────────────────

function renderTopChords() {
  const cutoff   = Date.now() - windowMs;
  const relevant = holdHistory.filter(h => h.end >= cutoff);
  if (curChord) relevant.push({ chord: curChord, start: Math.max(curChordStart, cutoff), end: Date.now() });

  const durations = {};
  const counts    = {};
  for (const h of relevant) {
    const dur = Math.max(0, h.end - Math.max(h.start, cutoff));
    durations[h.chord] = (durations[h.chord] || 0) + dur;
    counts[h.chord]    = (counts[h.chord]    || 0) + 1;
  }

  const total  = Object.values(durations).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(durations).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const container = document.getElementById('top-chords');

  if (sorted.length === 0) {
    container.innerHTML = '<div class="top-chord-empty">Start capturing to see analysis</div>';
    return;
  }
  container.innerHTML = sorted.map(([chord, dur]) => {
    const pct = Math.round(total > 0 ? (dur / total) * 100 : 0);
    return `<div class="top-chord-row">
      <span class="top-chord-name">${toFlat(chord)}</span>
      <div class="top-chord-bar-bg"><div class="top-chord-bar-fill" style="width:${pct}%"></div></div>
      <span class="top-chord-pct">${pct}%</span>
      <span class="top-chord-count">×${counts[chord] || 1}</span>
    </div>`;
  }).join('');
}

// ── Progression ────────────────────────────────────────────────────────────

function renderProgression() {
  const el = document.getElementById('progression');
  if (progression.length === 0) { el.textContent = '—'; return; }
  el.innerHTML = progression.map((c, i) =>
    `<span class="chord-token">${toFlat(c)}</span>${i < progression.length - 1 ? '<span class="arrow"> → </span>' : ''}`
  ).join('');
  el.scrollLeft = el.scrollWidth;
}

// ── Session history ────────────────────────────────────────────────────────

function saveSession(startedAt) {
  if (!startedAt) return;
  const dur = Date.now() - startedAt;
  if (dur < 1000) return;
  const session = {
    ts:      startedAt,
    dur,
    key:     lastKey          || '—',
    prog:    [...progression].slice(-24),
    url:     captureTabUrl    || null,
    title:   captureTabTitle  || null,
    favicon: captureTabFavicon || null,
    thumb:   ytThumbUrl(captureTabUrl) || null,
  };
  const all = JSON.parse(localStorage.getItem('sieve_sessions') || '[]');
  all.unshift(session);
  all.splice(40);
  localStorage.setItem('sieve_sessions', JSON.stringify(all));
  renderHistory();
}

function renderHistory() {
  const q   = document.getElementById('history-search')?.value.toLowerCase().trim() || '';
  const all = JSON.parse(localStorage.getItem('sieve_sessions') || '[]')
    .filter(s => !q || s.title?.toLowerCase().includes(q) || s.key?.toLowerCase().includes(q) || s.url?.toLowerCase().includes(q));
  const el  = document.getElementById('history-list');
  if (all.length === 0) {
    el.innerHTML = '<div class="history-empty">No sessions recorded yet</div>';
    return;
  }
  el.innerHTML = all.map((s, idx) => {
    const d      = new Date(s.ts);
    const mon    = d.toLocaleString('default', { month: 'short' });
    const day    = d.getDate();
    const hr     = String(d.getHours()).padStart(2, '0');
    const min    = String(d.getMinutes()).padStart(2, '0');
    const label  = s.title ? escHtml(s.title) : (s.url ? escHtml(s.url) : '—');
    const pg     = s.prog?.map(c => toFlat(c)).join(' → ') || '—';
    const click  = s.url ? `data-url="${escHtml(s.url)}" class="history-entry has-url"` : `class="history-entry"`;
    const favicon = s.favicon
      ? `<img class="history-favicon" src="${escHtml(s.favicon)}" alt="">`
      : `<span class="history-favicon-placeholder"></span>`;
    const thumb = s.thumb
      ? `<img class="history-thumb" src="${escHtml(s.thumb)}" alt="">`
      : '';
    return `<div ${click} data-idx="${idx}">
      ${thumb}
      <div class="history-meta">
        <span class="history-ts">${mon} ${day} · ${hr}:${min}</span>
        <span class="history-dur">${formatTime(s.dur)}</span>
      </div>
      <div class="history-title-row">
        ${favicon}
        <span class="history-title">${label}</span>
      </div>
      <div class="history-key">${s.key}</div>
      ${pg !== '—' ? `<div class="history-prog">${pg}</div>` : ''}
    </div>`;
  }).join('');

  el.querySelectorAll('.history-favicon, .history-thumb').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });

  // Open URL on click
  el.querySelectorAll('.has-url').forEach(entry => {
    entry.addEventListener('click', () => {
      chrome.tabs.create({ url: entry.dataset.url });
    });
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.getElementById('btn-clear-history').addEventListener('click', () => {
  localStorage.removeItem('sieve_sessions');
  renderHistory();
});

document.getElementById('history-search').addEventListener('input', renderHistory);

// Load history on open
renderHistory();

// ── Helpers ────────────────────────────────────────────────────────────────

function setStatus(text, cls) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className   = `status ${cls}`;
}

function resetDisplay() {
  displayChord     = '—';
  displayConf      = 0;
  captureStartTime  = null;
  lastKey           = null;
  lastKeyRaw        = null;
  captureTabUrl     = null;
  captureTabTitle   = null;
  captureTabFavicon = null;
  chromaVis.fill(0);
  particles.length = 0;
  document.getElementById('key-name').textContent    = '—';
  document.getElementById('top-chords').innerHTML    = '<div class="top-chord-empty">Start capturing to see analysis</div>';
  document.getElementById('progression').textContent = '—';
  updatePiano(new Float32Array(12));
  holdHistory.length = 0;
  progression.length = 0;
  curChord = null;
}

// ── Themes ─────────────────────────────────────────────────────────────────

function applyTheme(name) {
  const theme = THEMES[name];
  if (!theme) return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.css)) root.style.setProperty(k, v);
  CT = theme.ct;
  // Pre-cache static rgba strings so the draw loop doesn't build them every frame
  CT.c = {
    ink18:  rgba(CT.ink, 0.18),
    ink22:  rgba(CT.ink, 0.22),
    ink50:  rgba(CT.ink, 0.50),
    ink55:  rgba(CT.ink, 0.55),
    ink60:  rgba(CT.ink, 0.60),
    ink65:  rgba(CT.ink, 0.65),
    ink95:  rgba(CT.ink, 0.95),
    inkShadow: rgba(CT.ink, 0.20),
    hot40:  rgba(CT.hot, 0.40),
  };
  _fogGradient = null;
  localStorage.setItem('sieve_theme', name);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === name));
}

(function buildThemeList() {
  const list = document.getElementById('theme-list');
  for (const [key, t] of Object.entries(THEMES)) {
    const btn = document.createElement('button');
    btn.className = 'theme-btn';
    btn.dataset.theme = key;
    btn.innerHTML =
      `<span class="theme-swatch" style="background:${t.bg}"></span>` +
      `<span class="theme-swatch" style="background:${t.text}"></span>` +
      t.label;
    btn.addEventListener('click', () => {
      applyTheme(key);
      closeSettings();
    });
    list.appendChild(btn);
  }
})();

const cogBtn     = document.getElementById('cog-btn');
const settingsEl = document.getElementById('settings-panel');

function closeSettings() {
  settingsEl.style.display = 'none';
  cogBtn.classList.remove('active');
}

cogBtn.addEventListener('click', () => {
  const open = settingsEl.style.display !== 'block';
  settingsEl.style.display = open ? 'block' : 'none';
  cogBtn.classList.toggle('active', open);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettings();
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    captureStartTime ? doStop() : doCapture();
  }
});

// Load saved theme
applyTheme(localStorage.getItem('sieve_theme') || 'navy');

// ── ♭/# toggle ─────────────────────────────────────────────────────────────

const accToggleBtn = document.getElementById('acc-toggle');
accToggleBtn.textContent = useFlatNotation ? '♭' : '#';
if (useFlatNotation) accToggleBtn.classList.add('flat');

accToggleBtn.addEventListener('click', () => {
  useFlatNotation = !useFlatNotation;
  localStorage.setItem('sieve_flats', useFlatNotation ? '1' : '0');
  accToggleBtn.textContent = useFlatNotation ? '♭' : '#';
  accToggleBtn.classList.toggle('flat', useFlatNotation);
  if (lastKeyRaw) {
    lastKey = `${toFlat(lastKeyRaw.name)} ${lastKeyRaw.mode}`;
    document.getElementById('key-name').textContent = lastKey;
  }
  renderTopChords();
  renderProgression();
  renderHistory();
});

// ── Copy progression ────────────────────────────────────────────────────────

document.getElementById('copy-prog').addEventListener('click', (e) => {
  e.stopPropagation();
  const text = progression.map(c => toFlat(c)).join(' → ');
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-prog');
    btn.textContent = '[✓]';
    btn.classList.add('flash');
    setTimeout(() => { btn.textContent = '[cp]'; btn.classList.remove('flash'); }, 1200);
  });
});

// ── Copy session summary ────────────────────────────────────────────────────

document.getElementById('btn-copy-summary').addEventListener('click', () => {
  const title  = document.getElementById('res-title').textContent;
  const dur    = document.getElementById('res-dur').textContent;
  const key    = document.getElementById('res-key').textContent;
  const chords = document.getElementById('res-chords').textContent;
  const prog   = document.getElementById('res-prog').textContent;
  let text = '';
  if (title) text += `${title}\n\n`;
  text += `Key: ${key}\nDuration: ${dur}\nTop chords: ${chords}\nProgression: ${prog}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy-summary');
    btn.textContent = '[ copied! ]';
    setTimeout(() => { btn.textContent = '[ copy ]'; }, 1500);
  });
});

// ── Chord tooltips ──────────────────────────────────────────────────────────

const tooltipEl = document.getElementById('chord-tooltip');
let tooltipTimer;

function showTooltip(anchor, name) {
  const notes = chordNotes(name.trim());
  if (!notes) { hideTooltip(); return; }
  tooltipEl.textContent = notes.join('  ');
  const r = anchor.getBoundingClientRect();
  tooltipEl.style.left = `${r.left}px`;
  tooltipEl.style.top  = `${r.top > 32 ? r.top - 28 : r.bottom + 4}px`;
  tooltipEl.classList.add('visible');
}
function hideTooltip() { tooltipEl.classList.remove('visible'); }

['#top-chords','#progression','#history-list','#res-chords','#res-prog'].forEach(sel => {
  const el = document.querySelector(sel);
  if (!el) return;
  el.addEventListener('mouseover', (e) => {
    const t = e.target.closest('.top-chord-name,.chord-token,.history-key,.res-chords,.res-prog');
    if (!t) return;
    clearTimeout(tooltipTimer);
    showTooltip(t, t.textContent);
  });
  el.addEventListener('mouseleave', () => {
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(hideTooltip, 80);
  });
});

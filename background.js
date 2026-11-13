let offscreenCreating   = null;
let offscreenPort       = null;
let pendingStreamId     = null;
let pendingDownload     = null;
let panelWindowId       = null;
const sidePanelPorts    = new Set();
let lastInvokedTab      = null;
let captureActive       = false;

// Pending icon-click stream — stored when panel isn't open yet
let pendingInvokeStreamId = null;
let pendingInvokeTabInfo  = null;

function isWebUrl(url) { return url?.startsWith('http://') || url?.startsWith('https://'); }

// ── Toolbar click ──────────────────────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (isWebUrl(tab.url)) {
    lastInvokedTab = { tabId: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl };

    if (!captureActive) {
      // Get the stream ID now — activeTab grant is only valid inside this callback.
      // No targetTabId: stream captured = clicked tab; usable by any extension context (offscreen).
      chrome.tabCapture.getMediaStreamId({}, (streamId) => {
        const hasStream = !chrome.runtime.lastError && !!streamId;
        const payload   = { type: 'INVOKE_CAPTURE', ...lastInvokedTab, streamId: hasStream ? streamId : null };
        if (sidePanelPorts.size > 0) {
          broadcastToPanel(payload);
        } else {
          // Panel not open yet — store for when it connects.
          pendingInvokeStreamId = hasStream ? streamId : null;
          pendingInvokeTabInfo  = { ...lastInvokedTab };
        }
      });
    }
  }

  if (chrome.sidePanel?.open) {
    try { await chrome.sidePanel.open({ windowId: tab.windowId }); return; } catch {}
  }

  if (panelWindowId !== null) {
    try { await chrome.windows.update(panelWindowId, { focused: true }); return; }
    catch { panelWindowId = null; }
  }

  let left = 800, top = 0, height = 800;
  try {
    const w = await chrome.windows.get(tab.windowId);
    left   = w.left + w.width - 380;
    top    = w.top;
    height = w.height;
  } catch {}

  const url = chrome.runtime.getURL(`sidepanel/sidepanel.html?tabId=${tab.id}`);
  const win = await chrome.windows.create({
    url, type: 'popup',
    width: 380, height: Math.min(height, 640), left, top,
  });
  panelWindowId = win.id;
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === panelWindowId) panelWindowId = null;
});

// ── Port management ────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    sidePanelPorts.add(port);
    // Deliver any pending icon-click invoke (panel opened after the click).
    if (pendingInvokeTabInfo) {
      try {
        port.postMessage({ type: 'INVOKE_CAPTURE', ...pendingInvokeTabInfo, streamId: pendingInvokeStreamId });
      } catch {}
      pendingInvokeStreamId = null;
      pendingInvokeTabInfo  = null;
    } else if (lastInvokedTab) {
      try { port.postMessage({ type: 'INVOKED_TAB', ...lastInvokedTab }); } catch {}
    }
    port.onMessage.addListener((msg) => handlePanelMessage(msg));
    port.onDisconnect.addListener(() => sidePanelPorts.delete(port));
  } else if (port.name === 'offscreen') {
    offscreenPort = port;
    port.onMessage.addListener((msg) => {
      if (msg.type === 'OFFSCREEN_STATE') {
        if (msg.capturing) {
          // Orphaned stream after SW restart — kill it; panel UI was already reset.
          offscreenPort.postMessage({ type: 'STOP_STREAM' });
          captureActive = false;
        }
        return;
      }
      handleOffscreenMessage(msg);
    });
    port.onDisconnect.addListener(() => { offscreenPort = null; });
    if (pendingStreamId) {
      port.postMessage({ type: 'START_STREAM', streamId: pendingStreamId });
      pendingStreamId = null;
    }
    if (pendingDownload) {
      port.postMessage(pendingDownload);
      pendingDownload = null;
    }
  }
});

// ── Panel message handler ──────────────────────────────────────────────────

async function handlePanelMessage(msg) {
  if (msg.type === 'INIT_CAPTURE') {
    const { streamId } = msg;
    if (!streamId) return;
    captureActive = true;
    await ensureOffscreen();
    if (offscreenPort) offscreenPort.postMessage({ type: 'START_STREAM', streamId });
    else pendingStreamId = streamId;
  } else if (msg.type === 'DOWNLOAD_RECORDING') {
    const filename = safeFilename(msg.filename || 'recording');
    if (offscreenPort) offscreenPort.postMessage({ type: 'DOWNLOAD_RECORDING', filename, format: msg.format || 'mp3' });
  } else if (msg.type === 'STOP_CAPTURE') {
    captureActive = false;
    if (offscreenPort) offscreenPort.postMessage({ type: 'STOP_STREAM' });
  }
}

const OFFSCREEN_TO_PANEL = new Set([
  'CHORD_DATA', 'STREAM_ENDED', 'RECORDING_READY', 'REC_CONVERTING',
  'DL_PROGRESS', 'DL_DONE', 'DL_ERROR', 'TRIGGER_DOWNLOAD', 'ERROR',
]);

function handleOffscreenMessage(msg) {
  if (msg.type === 'STREAM_ENDED') captureActive = false;
  if (OFFSCREEN_TO_PANEL.has(msg.type)) broadcastToPanel(msg);
}

function broadcastToPanel(data) {
  for (const port of sidePanelPorts) {
    try { port.postMessage(data); } catch { sidePanelPorts.delete(port); }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeFilename(str) {
  return (str || 'audio').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 180) || 'audio';
}

// ── Tab change detection ───────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url?.startsWith('http')) {
      broadcastToPanel({ type: 'TAB_CHANGED', url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl });
    }
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.active || !tab.url?.startsWith('http')) return;
  broadcastToPanel({ type: 'TAB_CHANGED', url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl });
});

// ── Offscreen document lifecycle ───────────────────────────────────────────

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (offscreenCreating) { await offscreenCreating; return; }
  offscreenCreating = chrome.offscreen.createDocument({
    url:           chrome.runtime.getURL('offscreen/offscreen.html'),
    reasons:       ['USER_MEDIA', 'AUDIO_PLAYBACK', 'BLOBS'],
    justification: 'Capture and analyze tab audio; download streams via blob URL',
  });
  await offscreenCreating;
  offscreenCreating = null;
}

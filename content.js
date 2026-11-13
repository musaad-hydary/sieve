// Injected into every http/https page.
// Creates a fixed panel iframe on the right side of the viewport and
// toggles it when the background sends TOGGLE_PANEL.

const PANEL_WIDTH = '340px';

let container = null;
let visible    = false;

function ensurePanel() {
  if (container) return;

  container = document.createElement('div');
  container.id = '__blackhole_root__';
  Object.assign(container.style, {
    position:     'fixed',
    top:          '0',
    right:        '0',
    width:        PANEL_WIDTH,
    height:       '100%',
    zIndex:       '2147483647',
    display:      'none',
    boxShadow:    '-6px 0 32px rgba(0,0,0,0.7)',
    borderLeft:   '1px solid #1f2024',
  });

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('sidepanel/sidepanel.html');
  Object.assign(iframe.style, {
    width:   '100%',
    height:  '100%',
    border:  'none',
    display: 'block',
  });
  // Scroll the page left so the panel doesn't overlap content
  iframe.onload = () => {
    document.documentElement.style.marginRight = PANEL_WIDTH;
  };

  container.appendChild(iframe);
  document.documentElement.appendChild(container);
}

function showPanel() {
  ensurePanel();
  container.style.display = 'block';
  document.documentElement.style.marginRight = PANEL_WIDTH;
  visible = true;
}

function hidePanel() {
  if (container) container.style.display = 'none';
  document.documentElement.style.marginRight = '';
  visible = false;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TOGGLE_PANEL') {
    visible ? hidePanel() : showPanel();
  }
});

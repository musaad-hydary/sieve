// The only job of this popup: open the side panel via a button click.
//
// Why a button and not auto-open? Chrome requires sidePanel.open() to be called
// synchronously on the user-gesture stack. Any async operation (tabs.query,
// await, etc.) before the call exits that stack and throws "user gesture" error.
//
// Solution: background.js pre-fetches the tab ID via port and stores it here.
// By the time the user reads the popup and clicks, tabId is already set.
// The click handler calls sidePanel.open() with zero async calls before it.

let tabId = null;

const bgPort = chrome.runtime.connect({ name: 'popup' });
bgPort.onMessage.addListener(({ type, tabId: id }) => {
  if (type === 'TAB_ID') {
    tabId = id;
    const btn = document.getElementById('btn-open');
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor  = 'pointer';
  }
});

document.getElementById('btn-open').addEventListener('click', () => {
  if (!tabId) { showErr('Tab not ready — try again.'); return; }

  // ← Zero async calls here. tabId was fetched in the background.
  //   This is a direct user-gesture call and must work.
  chrome.sidePanel.open({ tabId })
    .then(() => {
      setMsg('✓ Side panel is open — look for it on the right edge of your window.');
      document.getElementById('btn-open').style.display = 'none';
    })
    .catch(err => showErr(err.message));
});

function setMsg(t) { document.getElementById('msg').textContent = t; }
function showErr(t) {
  setMsg('Could not open side panel.');
  const e = document.getElementById('err');
  e.textContent    = t;
  e.style.display  = 'block';
}

// content_shim.js — ISOLATED world bridge
// Forwards messages between popup.js (chrome.runtime) ↔ content.js (MAIN world, window.postMessage)

// popup.js → chrome.tabs.sendMessage → shim → window.postMessage → content.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  window.postMessage({ source: 'tip-shim-to-main', payload: msg }, '*');
  sendResponse({ ok: true });
  return true;
});

// content.js → window.postMessage → shim → chrome.runtime.sendMessage → popup.js
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'tip-main-to-shim') return;
  chrome.runtime.sendMessage(event.data.payload);
});

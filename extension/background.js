// Open as Chrome Side Panel — stays docked while browsing

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

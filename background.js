// Noted — background service worker
// Handles the right-click menu and the keyboard shortcut, and forwards
// "add a note" requests to the page's content script.

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "add-sticky-note",
      title: "Add sticky note here",
      contexts: ["page", "selection", "image", "link"]
    });
  });

  // When Noted is installed or updated, Chrome disconnects it from tabs that
  // are already open. Reconnect them so you don't have to refresh every tab.
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file:///*"] });
  for (const t of tabs) inject(t.id).catch(() => {});
});

function onMenuClick(info, tab) {
  if (info.menuItemId === "add-sticky-note" && tab && tab.id != null) {
    return send(tab.id, { type: "add-note", at: "context", selection: info.selectionText || "" });
  }
}
chrome.contextMenus.onClicked.addListener(onMenuClick);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "add-note") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) send(tab.id, { type: "add-note", at: "viewport" });
});

function inject(tabId) {
  return chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

// Send a message to the page. If Noted isn't connected to that tab yet,
// connect it and try once more.
async function send(tabId, msg) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, msg);
    if (res && res.ok) return res;
  } catch {}
  try {
    await inject(tabId);
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Chrome doesn't allow extensions on chrome:// pages, the Web Store, etc.
  }
}

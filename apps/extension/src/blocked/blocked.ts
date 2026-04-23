void (async () => {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await chrome.tabs.remove(tab.id);
      return;
    }
  } catch {
    // fall through to window.close
  }
  window.close();
})();

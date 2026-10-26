document.getElementById("settings").addEventListener("click", () => {
  messenger.runtime.openOptionsPage();
  window.close();
});

document.getElementById("activity").addEventListener("click", () => {
  messenger.tabs.create({ url: "/log/log.html" });
  window.close();
});

messenger.runtime.sendMessage({ type: "status" }).then(({ working, handled }) => {
  document.getElementById("status").textContent = working
    ? `Claude is working…${handled ? ` ${handled} handled` : ""}`
    : "Idle";
});

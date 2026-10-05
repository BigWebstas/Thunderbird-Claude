const rows = document.getElementById("rows");
const errorBox = document.getElementById("error");

function describe(entry) {
  const parts = [];
  if (entry.action === "spam") parts.push("Marked as spam");
  if (entry.action === "otp-cleanup") parts.push("Old OTP email deleted");
  if (entry.toPath && entry.action !== "otp-cleanup") parts.push(`Moved ${entry.fromPath} → ${entry.toPath}`);
  if (entry.flagged) parts.push("Flagged important");
  if (entry.tagNames.length) parts.push(`Tagged ${entry.tagNames.join(", ")}`);
  return parts.join(" · ") || "Left as is";
}

function canUndo(entry) {
  return !entry.undone && (entry.toFolderId || entry.junk || entry.flagged || entry.tagKeys.length);
}

function cell(text, className) {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function render(activityLog) {
  rows.replaceChildren();
  document.getElementById("empty").hidden = activityLog.length > 0;
  for (const entry of activityLog) {
    const tr = document.createElement("tr");
    if (entry.undone) tr.className = "undone";

    const email = cell(entry.subject || "(no subject)");
    const from = document.createElement("div");
    from.className = "muted";
    from.textContent = entry.author;
    email.append(from);

    const actions = document.createElement("td");
    if (entry.undone) {
      actions.textContent = "Undone";
    } else if (canUndo(entry)) {
      const button = document.createElement("button");
      button.textContent = "Undo";
      button.addEventListener("click", async () => {
        button.disabled = true;
        errorBox.textContent = "";
        try {
          await messenger.runtime.sendMessage({ type: "undo", id: entry.id });
        } catch (e) {
          errorBox.textContent = `Couldn't undo "${entry.subject}": ${e.message}`;
          button.disabled = false;
        }
      });
      actions.append(button);
    }

    tr.append(
      cell(new Date(entry.time).toLocaleString()),
      email,
      cell(describe(entry)),
      cell(entry.reason, "muted"),
      actions
    );
    rows.append(tr);
  }
}

async function load() {
  const { activityLog = [] } = await messenger.storage.local.get("activityLog");
  render(activityLog);
}

messenger.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.activityLog) render(changes.activityLog.newValue || []);
});
load();

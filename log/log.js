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

function ruleItem(text, label, onClick) {
  const li = document.createElement("li");
  li.textContent = text;
  const button = document.createElement("button");
  button.textContent = label;
  button.addEventListener("click", onClick);
  li.append(button);
  return li;
}

function renderRules(activityLog, rules) {
  const suggestions = suggestRules(activityLog, rules);
  document.getElementById("suggestions").replaceChildren(
    ...suggestions.map((s) =>
      ruleItem(`${s.address} → ${s.path} (filed there ${s.count} times)`, "Add rule", () =>
        messenger.storage.local.set({
          rules: [...rules, { address: s.address, folderId: s.folderId, path: s.path }],
        })
      )
    )
  );
  document.getElementById("no-suggestions").hidden = suggestions.length > 0;
  document.getElementById("rules").replaceChildren(
    ...rules.map((r) =>
      ruleItem(`${r.address} → ${r.path}`, "Remove", () =>
        messenger.storage.local.set({ rules: rules.filter((x) => x !== r) })
      )
    )
  );
  document.getElementById("no-rules").hidden = rules.length > 0;
}

function formatUsage(label, days) {
  const total = days.reduce((t, d) => ({ calls: t.calls + d.calls, input: t.input + d.input, output: t.output + d.output }), {
    calls: 0, input: 0, output: 0,
  });
  return `${label}: ${total.calls.toLocaleString()} emails, ${total.input.toLocaleString()} input and ${total.output.toLocaleString()} output tokens`;
}

function renderUsage() {
  const today = localDay();
  const month = today.slice(0, 7);
  const entries = Object.entries(usageByDay);
  const lines = [
    formatUsage("Today", entries.filter(([day]) => day === today).map(([, d]) => d)),
    formatUsage("This month", entries.filter(([day]) => day.startsWith(month)).map(([, d]) => d)),
    `Filed by rules (no Claude call), in the log below: ${activityLog.filter((e) => e.action === "rule").length}`,
  ];
  document.getElementById("usage").replaceChildren(...lines.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
}

function describePending({ result }) {
  if (result.spam) return "Mark as spam";
  const parts = [];
  if (result.folder) parts.push(`Move to ${result.folder}`);
  if (result.important) parts.push("Flag important");
  if (result.tags.length) parts.push(`Tag ${result.tags.join(", ")}`);
  return parts.join(" · ") || "Leave as is";
}

async function resolvePending(ids, approve) {
  errorBox.textContent = "";
  try {
    await messenger.runtime.sendMessage({ type: "resolvePending", ids, approve });
  } catch (e) {
    errorBox.textContent = `Couldn't apply: ${e.message}`;
  }
}

function renderPending() {
  document.getElementById("pendingSection").hidden = pending.length === 0;
  document.getElementById("pending").replaceChildren(
    ...pending.map((p) => {
      const li = document.createElement("li");
      li.textContent = `${p.subject || "(no subject)"} (${p.author}): ${describePending(p)}`;
      for (const [label, approve] of [["Approve", true], ["Reject", false]]) {
        const button = document.createElement("button");
        button.textContent = label;
        button.addEventListener("click", () => resolvePending([p.id], approve));
        li.append(button);
      }
      return li;
    })
  );
}

document.getElementById("approveAll").addEventListener("click", () => resolvePending(pending.map((p) => p.id), true));
document.getElementById("rejectAll").addEventListener("click", () => resolvePending(pending.map((p) => p.id), false));

const newsletterButton = document.getElementById("findNewsletters");
newsletterButton.addEventListener("click", async () => {
  newsletterButton.disabled = true;
  errorBox.textContent = "";
  const list = document.getElementById("newsletters");
  list.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Checking…" }));
  document.getElementById("no-newsletters").hidden = true;
  try {
    const found = await messenger.runtime.sendMessage({ type: "findNewsletters" });
    list.replaceChildren(
      ...found.map((n) => {
        const text = `${n.address}: ${n.unread} of ${n.total} unread`;
        if (n.unsubscribe?.startsWith("https://")) {
          return ruleItem(text, "Unsubscribe", () => messenger.windows.openDefaultBrowser(n.unsubscribe));
        }
        return Object.assign(document.createElement("li"), {
          textContent: n.unsubscribe ? `${text} (unsubscribe by email: ${n.unsubscribe.slice(7)})` : text,
        });
      })
    );
    document.getElementById("no-newsletters").hidden = found.length > 0;
  } catch (e) {
    list.replaceChildren();
    errorBox.textContent = `Couldn't check newsletters: ${e.message}`;
  } finally {
    newsletterButton.disabled = false;
  }
});

let activityLog = [];
let rules = [];
let pending = [];
let usageByDay = {};

function renderAll() {
  render(activityLog);
  renderRules(activityLog, rules);
  renderPending();
  renderUsage();
}

async function load() {
  ({ activityLog = [], rules = [], pending = [], usageByDay = {} } = await messenger.storage.local.get([
    "activityLog",
    "rules",
    "pending",
    "usageByDay",
  ]));
  renderAll();
}

messenger.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.activityLog) activityLog = changes.activityLog.newValue || [];
  if (changes.rules) rules = changes.rules.newValue || [];
  if (changes.pending) pending = changes.pending.newValue || [];
  if (changes.usageByDay) usageByDay = changes.usageByDay.newValue || {};
  renderAll();
});
load();

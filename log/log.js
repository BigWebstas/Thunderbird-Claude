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

function ruleItem(text, ...buttons) {
  const li = document.createElement("li");
  li.textContent = text;
  for (const [label, onClick] of buttons) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", onClick);
    li.append(button);
  }
  return li;
}

// What a rule would catch in the Inbox right now.
async function previewRule(pattern) {
  const inboxes = (await messenger.folders.query({ specialUse: ["inbox"] })).filter((f) => !f.isUnified && !f.isVirtual);
  const matches = [];
  for (const inbox of inboxes) {
    for await (const header of iterateMessageList(await messenger.messages.query({ folderId: inbox.id, author: pattern }))) {
      if (matchesSender(pattern, senderAddress(header.author))) matches.push(header);
    }
  }
  if (!matches.length) return `${pattern} matches no emails in your Inbox.`;
  const sample = matches.slice(0, 3).map((h) => `"${h.subject}"`).join(", ");
  return `${pattern} matches ${matches.length} Inbox email(s), e.g. ${sample}.`;
}

const previewBox = document.getElementById("preview");

async function showPreview(pattern) {
  previewBox.textContent = "Checking the Inbox…";
  try {
    previewBox.textContent = await previewRule(pattern);
  } catch (e) {
    previewBox.textContent = `Couldn't check: ${e.message}`;
  }
}

function addRule(address, folderId, path) {
  const others = rules.filter((r) => r.address !== address);
  return messenger.storage.local.set({ rules: [...others, { address, folderId, path, added: Date.now() }] });
}

function renderRules() {
  const suggestions = suggestRules(activityLog, rules, corrections);
  document.getElementById("suggestions").replaceChildren(
    ...suggestions.map((s) =>
      ruleItem(
        `${s.address} → ${s.path} (${s.count} times)`,
        ["Preview", () => showPreview(s.address)],
        ["Add rule", () => addRule(s.address, s.folderId, s.path)]
      )
    )
  );
  document.getElementById("no-suggestions").hidden = suggestions.length > 0;

  const problems = new Map(rules.map((r) => [r, ruleProblem(r, ruleHits, folderIds)]));
  document.getElementById("rules").replaceChildren(
    ...rules.map((r) => {
      const problem = problems.get(r);
      return ruleItem(
        `${r.address} → ${r.path}${problem ? ` (${problem})` : ""}`,
        ["Remove", () => messenger.storage.local.set({ rules: rules.filter((x) => x !== r) })]
      );
    })
  );
  document.getElementById("no-rules").hidden = rules.length > 0;
  document.getElementById("removeStale").hidden = ![...problems.values()].some(Boolean);
}

document.getElementById("removeStale").addEventListener("click", () =>
  messenger.storage.local.set({ rules: rules.filter((r) => !ruleProblem(r, ruleHits, folderIds)) })
);

const newPattern = document.getElementById("newPattern");
const newFolder = document.getElementById("newFolder");

function validPattern() {
  const pattern = newPattern.value.trim().toLowerCase();
  if (pattern.includes("@")) return pattern;
  previewBox.textContent = "Enter an address like a@b.com, or a domain like @b.com.";
  return null;
}

document.getElementById("previewRule").addEventListener("click", () => {
  const pattern = validPattern();
  if (pattern) showPreview(pattern);
});

document.getElementById("addRule").addEventListener("click", async () => {
  const pattern = validPattern();
  const folder = newFolder.selectedOptions[0]?.folder;
  if (!pattern || !folder) return;
  await addRule(pattern, folder.id, folder.path);
  newPattern.value = "";
  previewBox.textContent = "";
});

async function loadFolders() {
  const [folders, accounts] = await Promise.all([messenger.folders.query({}), messenger.accounts.list(false)]);
  folderIds = new Set(folders.map((f) => f.id));
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  newFolder.replaceChildren(
    ...folders.filter(isSortTarget).map((f) => {
      const option = new Option(`${names.get(f.accountId) ?? ""}: ${f.path}`, f.id);
      option.folder = f;
      return option;
    })
  );
}

function renderReminders() {
  document.getElementById("reminderSection").hidden = reminders.length === 0;
  document.getElementById("reminders").replaceChildren(
    ...reminders.map((r) =>
      ruleItem(
        `${r.subject || "(no subject)"} (${r.author}), received ${new Date(r.date).toLocaleDateString()}${r.notified ? ", overdue" : ""}`,
        ["Dismiss", () => messenger.runtime.sendMessage({ type: "dismissReminder", id: r.id })]
      )
    )
  );
}

function renderDigest() {
  document.getElementById("digest").textContent =
    describeSummary(summarize(activityLog, visitSince)) || "Nothing new.";
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
          return ruleItem(text, ["Unsubscribe", () => messenger.windows.openDefaultBrowser(n.unsubscribe)]);
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
let corrections = [];
let ruleHits = {};
let reminders = [];
let folderIds = new Set();
let visitSince = 0;

function renderAll() {
  render(activityLog);
  renderRules();
  renderPending();
  renderUsage();
  renderReminders();
  renderDigest();
}

async function load() {
  const stored = await messenger.storage.local.get([
    "activityLog", "rules", "pending", "usageByDay", "corrections", "ruleHits", "reminders", "lastVisit",
  ]);
  ({ activityLog = [], rules = [], pending = [], usageByDay = {}, corrections = [], ruleHits = {}, reminders = [] } = stored);
  visitSince = stored.lastVisit ?? 0;
  messenger.storage.local.set({ lastVisit: Date.now() });
  await loadFolders();
  renderAll();
}

const WATCHED = {
  activityLog: (v) => (activityLog = v || []),
  rules: (v) => (rules = v || []),
  pending: (v) => (pending = v || []),
  usageByDay: (v) => (usageByDay = v || {}),
  corrections: (v) => (corrections = v || []),
  ruleHits: (v) => (ruleHits = v || {}),
  reminders: (v) => (reminders = v || []),
};

messenger.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let changed = false;
  for (const [key, set] of Object.entries(WATCHED)) {
    if (changes[key]) {
      set(changes[key].newValue);
      changed = true;
    }
  }
  if (changed) renderAll();
});
load();

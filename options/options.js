const STARTER_FOLDERS = ["Work", "Personal", "Finance", "Shopping", "Travel", "Newsletters", "Social", "Notifications", "OTP"];
// Local Folders, newsgroups, feeds and chat accounts don't receive mail to sort.
const SKIPPED_ACCOUNT_TYPES = ["none", "nntp", "rss", "im"];

const form = document.getElementById("form");
const fields = {
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  autoProcess: document.getElementById("autoProcess"),
  createTags: document.getElementById("createTags"),
  sortOnStartup: document.getElementById("sortOnStartup"),
  otpDays: document.getElementById("otpDays"),
  reviewFirst: document.getElementById("reviewFirst"),
  folderHints: document.getElementById("folderHints"),
  excludeList: document.getElementById("excludeList"),
  replyDays: document.getElementById("replyDays"),
  digest: document.getElementById("digest"),
};

const modelStatus = document.getElementById("modelStatus");

// Fills the picker from the Anthropic models API, keeping the saved model selectable if the lookup fails.
async function loadModels(selected) {
  const apiKey = fields.apiKey.value.trim();
  const options = [new Option("Default (claude-haiku-4-5)", "")];
  modelStatus.textContent = "";
  if (apiKey) {
    modelStatus.textContent = "Loading models…";
    try {
      const response = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const { data } = await response.json();
      for (const m of data) options.push(new Option(`${m.display_name} (${m.id})`, m.id));
      modelStatus.textContent = "";
    } catch (e) {
      modelStatus.textContent = `Could not load models: ${e.message}`;
    }
  }
  if (selected && !options.some((o) => o.value === selected)) options.push(new Option(selected, selected));
  fields.model.replaceChildren(...options);
  fields.model.value = selected;
}

fields.apiKey.addEventListener("change", () => loadModels(fields.model.value));

function loadSettings() {
  return messenger.storage.local
    .get(["apiKey", "model", "autoProcess", "createTags", "sortOnStartup", "otpDays", "reviewFirst", "folderHints", "excludeList", "replyDays", "digest"])
    .then((s) => {
      fields.apiKey.value = s.apiKey || "";
      loadModels(s.model || "");
      fields.autoProcess.checked = !!s.autoProcess;
      fields.createTags.checked = !!s.createTags;
      fields.sortOnStartup.checked = !!s.sortOnStartup;
      fields.otpDays.value = s.otpDays || 0;
      fields.reviewFirst.checked = !!s.reviewFirst;
      fields.folderHints.value = s.folderHints || "";
      fields.excludeList.value = s.excludeList || "";
      fields.replyDays.value = s.replyDays || 0;
      fields.digest.checked = !!s.digest;
    });
}
loadSettings();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await messenger.storage.local.set({
    apiKey: fields.apiKey.value.trim(),
    model: fields.model.value,
    autoProcess: fields.autoProcess.checked,
    createTags: fields.createTags.checked,
    sortOnStartup: fields.sortOnStartup.checked,
    otpDays: Math.max(0, Math.floor(Number(fields.otpDays.value) || 0)),
    reviewFirst: fields.reviewFirst.checked,
    folderHints: fields.folderHints.value,
    excludeList: fields.excludeList.value,
    replyDays: Math.max(0, Math.floor(Number(fields.replyDays.value) || 0)),
    digest: fields.digest.checked,
  });
  document.getElementById("status").textContent = "Saved.";
});

// Thunderbird never settles folders.create() if the server refuses the folder, so give up after a while.
const CREATE_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function createStarterFolders() {
  const accounts = await messenger.accounts.list(false);
  let created = 0;
  const failures = [];
  for (const account of accounts) {
    if (SKIPPED_ACCOUNT_TYPES.includes(account.type)) continue;
    const existing = await messenger.folders.query({ accountId: account.id });
    // Some servers (e.g. Proton Mail Bridge) only allow user folders inside a top-level "Folders" folder.
    const parent = existing.find((f) => f.path === "/Folders") ?? account.rootFolder;
    const prefix = parent.path === "/" ? "" : parent.path;
    const existingPaths = new Set(existing.map((f) => f.path.toLowerCase()));
    for (const name of STARTER_FOLDERS) {
      if (existingPaths.has(`${prefix}/${name}`.toLowerCase())) continue;
      folderStatus.textContent = `Creating ${account.name}${prefix}/${name}…`;
      try {
        await withTimeout(
          messenger.folders.create(parent.id, name),
          CREATE_TIMEOUT_MS,
          "the mail server did not respond"
        );
        created++;
      } catch (e) {
        failures.push(`${name} (${e.message})`);
      }
    }
  }
  return { created, failures };
}

const folderButton = document.getElementById("createFolders");
const folderStatus = document.getElementById("folderStatus");
folderButton.addEventListener("click", async () => {
  folderButton.disabled = true;
  folderStatus.textContent = "Creating folders…";
  try {
    const { created, failures } = await createStarterFolders();
    folderStatus.textContent =
      `Created ${created} folder(s).` + (failures.length ? ` Failed: ${failures.join(", ")}` : "");
  } catch (e) {
    folderStatus.textContent = `Failed: ${e.message}`;
  } finally {
    folderButton.disabled = false;
  }
});

const sortButton = document.getElementById("sortInbox");
const sortStatus = document.getElementById("sortStatus");
sortButton.addEventListener("click", async () => {
  sortButton.disabled = true;
  sortStatus.textContent = "Looking for unsorted emails…";
  try {
    const count = await messenger.runtime.sendMessage({ type: "sortInbox" });
    sortStatus.textContent = count
      ? `Sorting ${count} email(s) in the background. Progress shows in the activity log.`
      : "Nothing to sort. Every Inbox email has been sorted before.";
  } catch (e) {
    sortStatus.textContent = `Failed: ${e.message}`;
  } finally {
    sortButton.disabled = false;
  }
});

document.getElementById("openLog").addEventListener("click", () => {
  messenger.tabs.create({ url: "/log/log.html" });
});

// --- Backup ---

const BACKUP_SETTINGS = ["autoProcess", "createTags", "sortOnStartup", "otpDays", "reviewFirst", "folderHints", "excludeList", "replyDays", "digest"];
const backupStatus = document.getElementById("backupStatus");

document.getElementById("exportSettings").addEventListener("click", async () => {
  const stored = await messenger.storage.local.get([...BACKUP_SETTINGS, "rules"]);
  const backup = {
    settings: Object.fromEntries(BACKUP_SETTINGS.filter((k) => k in stored).map((k) => [k, stored[k]])),
    rules: (stored.rules || []).map((r) => ({ address: r.address, path: r.path })),
  };
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  link.download = "claude-mail-sorter-settings.json";
  link.click();
  URL.revokeObjectURL(link.href);
  backupStatus.textContent = "Exported.";
});

async function importBackup(file) {
  const backup = JSON.parse(await file.text());
  if (typeof backup.settings !== "object" || !Array.isArray(backup.rules)) throw new Error("not a settings export");
  const settings = Object.fromEntries(BACKUP_SETTINGS.filter((k) => k in backup.settings).map((k) => [k, backup.settings[k]]));

  const folders = (await messenger.folders.query({})).filter(isSortTarget);
  const { rules = [] } = await messenger.storage.local.get("rules");
  let skipped = 0;
  for (const imported of backup.rules) {
    const folder = folders.find((f) => f.path === imported.path);
    if (typeof imported.address !== "string" || !folder) {
      skipped++;
      continue;
    }
    const others = rules.filter((r) => r.address !== imported.address);
    rules.length = 0;
    rules.push(...others, { address: imported.address, folderId: folder.id, path: folder.path, added: Date.now() });
  }
  await messenger.storage.local.set({ ...settings, rules });
  await loadSettings();
  return skipped;
}

const importFile = document.getElementById("importFile");
document.getElementById("importSettings").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const [file] = importFile.files;
  importFile.value = "";
  if (!file) return;
  try {
    const skipped = await importBackup(file);
    backupStatus.textContent = "Imported." + (skipped ? ` ${skipped} rule(s) skipped because no matching folder exists here.` : "");
  } catch (e) {
    backupStatus.textContent = `Import failed: ${e.message}`;
  }
});

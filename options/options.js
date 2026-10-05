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
};

messenger.storage.local
  .get(["apiKey", "model", "autoProcess", "createTags", "sortOnStartup", "otpDays"])
  .then((s) => {
    fields.apiKey.value = s.apiKey || "";
    fields.model.value = s.model || "";
    fields.autoProcess.checked = !!s.autoProcess;
    fields.createTags.checked = !!s.createTags;
    fields.sortOnStartup.checked = !!s.sortOnStartup;
    fields.otpDays.value = s.otpDays || 0;
  });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await messenger.storage.local.set({
    apiKey: fields.apiKey.value.trim(),
    model: fields.model.value.trim(),
    autoProcess: fields.autoProcess.checked,
    createTags: fields.createTags.checked,
    sortOnStartup: fields.sortOnStartup.checked,
    otpDays: Math.max(0, Math.floor(Number(fields.otpDays.value) || 0)),
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

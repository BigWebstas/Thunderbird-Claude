// Shared by the background script and the activity page.
// A rule is { address, folderId, path, added }: mail from `address` is filed in that folder without asking Claude.
// `address` is a full address, or a whole domain when it starts with "@".
const SUGGEST_MIN_MOVES = 3;
const SUGGEST_MIN_SHARE = 0.8;
// A manual move out of Claude's sorting counts as this many automatic ones.
const CORRECTION_WEIGHT = 2;
const STALE_RULE_DAYS = 90;
// A rule for these would catch millions of unrelated senders.
const FREE_MAIL_DOMAINS = [
  "@gmail.com", "@googlemail.com", "@outlook.com", "@hotmail.com", "@live.com",
  "@yahoo.com", "@icloud.com", "@me.com", "@proton.me", "@protonmail.com", "@aol.com",
];

// Folders Claude may never file mail into; spam goes to the junk folder through its own path.
const EXCLUDED_SPECIAL_USE = ["trash", "junk", "sent", "drafts", "outbox", "templates"];
// Proton Mail Bridge views that aren't real folders: moving mail into them fails or only applies a label.
const EXCLUDED_PATHS = ["/All Mail", "/Starred", "/Folders", "/Labels"];
const EXCLUDED_PATH_PREFIXES = ["/Labels/"];

function isSortTarget(folder) {
  return (
    !folder.isRoot &&
    !folder.isVirtual &&
    !folder.isTag &&
    !folder.isUnified &&
    folder.path !== "/" &&
    !EXCLUDED_PATHS.includes(folder.path) &&
    !EXCLUDED_PATH_PREFIXES.some((p) => folder.path.startsWith(p)) &&
    !folder.specialUse?.some((u) => EXCLUDED_SPECIAL_USE.includes(u))
  );
}

async function* iterateMessageList(list) {
  let page = list;
  while (page) {
    yield* page.messages;
    page = page.id ? await messenger.messages.continueList(page.id) : null;
  }
}

function senderAddress(author) {
  const match = author.match(/<([^>]+)>/);
  return (match ? match[1] : author).trim().toLowerCase();
}

function senderDomain(address) {
  const at = address.lastIndexOf("@");
  return at < 0 ? "" : address.slice(at);
}

function matchesSender(pattern, address) {
  return pattern.startsWith("@") ? address.endsWith(pattern) : address === pattern;
}

function localDay(date = new Date()) {
  return date.toLocaleDateString("sv");
}

// Groups sorted mail by `keyOf(address)` and keeps the groups Claude kept filing in one folder.
// Mail Claude left in place or that was undone counts against the group, so contested senders aren't suggested.
function tally(sorted, keyOf, minSenders) {
  const groups = new Map();
  for (const { address, entry } of sorted) {
    const key = keyOf(address);
    if (!key) continue;
    const weight = entry.weight ?? 1;
    const group = groups.get(key) ?? { total: 0, senders: new Set(), folders: new Map() };
    group.total += weight;
    group.senders.add(address);
    if (entry.toFolderId && !entry.undone) {
      const folder = group.folders.get(entry.toFolderId) ?? { folderId: entry.toFolderId, path: entry.toPath, count: 0 };
      folder.count += weight;
      group.folders.set(entry.toFolderId, folder);
    }
    groups.set(key, group);
  }
  const suggestions = [];
  for (const [address, { total, senders, folders }] of groups) {
    const top = [...folders.values()].sort((a, b) => b.count - a.count)[0];
    if (top && senders.size >= minSenders && top.count >= SUGGEST_MIN_MOVES && top.count / total >= SUGGEST_MIN_SHARE) {
      suggestions.push({ address, folderId: top.folderId, path: top.path, count: top.count });
    }
  }
  return suggestions;
}

// `corrections` are emails the user moved by hand after Claude handled them.
function suggestRules(activityLog, rules, corrections = []) {
  const entries = [
    ...activityLog.filter((e) => e.action === "sorted"),
    ...corrections.map((c) => ({ author: c.author, toFolderId: c.toFolderId, toPath: c.toPath, weight: CORRECTION_WEIGHT })),
  ];
  const sorted = entries
    .map((entry) => ({ address: senderAddress(entry.author), entry }))
    .filter(({ address }) => !rules.some((r) => matchesSender(r.address, address)));
  // A domain needs two senders, otherwise the address rule says the same thing.
  const domains = tally(sorted, (a) => {
    const domain = senderDomain(a);
    return FREE_MAIL_DOMAINS.includes(domain) ? "" : domain;
  }, 2);
  const addresses = tally(sorted, (a) => a, 1).filter(
    (s) => !domains.some((d) => d.folderId === s.folderId && matchesSender(d.address, s.address))
  );
  return [...domains, ...addresses].sort((a, b) => b.count - a.count);
}

// Why a rule needs attention, or "" when it is fine. `hits` maps a rule's address to when it last matched.
function ruleProblem(rule, hits, folderIds, now = Date.now()) {
  if (!folderIds.has(rule.folderId)) return "its folder no longer exists";
  const lastUsed = hits[rule.address] ?? rule.added;
  if (lastUsed && now - lastUsed > STALE_RULE_DAYS * 24 * 60 * 60 * 1000) return `unused for ${STALE_RULE_DAYS} days`;
  return "";
}

function summarize(activityLog, since) {
  const recent = activityLog.filter((e) => e.time > since && !e.undone);
  return {
    filed: recent.filter((e) => e.action === "sorted" && e.toFolderId).length,
    spam: recent.filter((e) => e.action === "spam").length,
    flagged: recent.filter((e) => e.flagged).length,
    byRule: recent.filter((e) => e.action === "rule").length,
  };
}

// "" when nothing happened.
function describeSummary({ filed, spam, flagged, byRule }) {
  return [
    filed && `${filed} filed`,
    byRule && `${byRule} filed by rules`,
    spam && `${spam} marked as spam`,
    flagged && `${flagged} flagged`,
  ]
    .filter(Boolean)
    .join(", ");
}

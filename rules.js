// Shared by the background script and the activity page.
// A rule is { address, folderId, path }: mail from `address` is filed in that folder without asking Claude.
// `address` is a full address, or a whole domain when it starts with "@".
const SUGGEST_MIN_MOVES = 3;
const SUGGEST_MIN_SHARE = 0.8;
// A rule for these would catch millions of unrelated senders.
const FREE_MAIL_DOMAINS = [
  "@gmail.com", "@googlemail.com", "@outlook.com", "@hotmail.com", "@live.com",
  "@yahoo.com", "@icloud.com", "@me.com", "@proton.me", "@protonmail.com", "@aol.com",
];

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
    const group = groups.get(key) ?? { total: 0, senders: new Set(), folders: new Map() };
    group.total++;
    group.senders.add(address);
    if (entry.toFolderId && !entry.undone) {
      const folder = group.folders.get(entry.toFolderId) ?? { folderId: entry.toFolderId, path: entry.toPath, count: 0 };
      folder.count++;
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

function suggestRules(activityLog, rules) {
  const sorted = activityLog
    .filter((e) => e.action === "sorted")
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

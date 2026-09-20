// Push local commits to GitHub via the Git Data API (api.github.com) when
// github.com:443 is unreachable. Never include .github/workflows/* entries
// (token lacks the workflow scope; ref updates would 404).
//
// Usage: node tools/gh-api-push.mjs <target-rev> <local-base-rev> <remote-base-sha> <branch> <message-file>
//   - diff is computed locally between <local-base-rev> and <target-rev>
//   - the new tree is based on <remote-base-sha>'s tree, commit parent = <remote-base-sha>
//   - blob uploads are cached (resume) in the OS temp dir
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [target, localBase, remoteBase, branch, msgFile] = process.argv.slice(2);
if (!target || !localBase || !remoteBase || !branch || !msgFile) {
  console.error("usage: node tools/gh-api-push.mjs <target> <local-base> <remote-base-sha> <branch> <message-file>");
  process.exit(2);
}
const REPO = "meihuaanying/framegeist";
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const api = async (method, path, body) => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "user-agent": "FrameGeist-release",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : {};
    } catch (e) {
      if (attempt === 5) throw new Error(`${method} ${path}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
};

const CACHE = join(tmpdir(), `fg-gh-api-entries-${target.slice(0, 8)}.json`);
let entries;
try {
  entries = JSON.parse(readFileSync(CACHE, "utf8"));
  console.log(`resumed ${entries.length} entries from cache`);
} catch {
  /* fresh */
}
if (!entries) {
  const diff = execFileSync("git", ["diff", "--name-status", "--no-renames", localBase, target], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return { status: parts[0], file: parts[1] };
    })
    .filter(({ file }) => {
      if (file.startsWith(".github/workflows/")) {
        console.log(`SKIP workflow file: ${file}`);
        return false;
      }
      return true;
    });
  console.log(`diff ${localBase}..${target}: ${diff.length} entries (workflows excluded)`);
  entries = [];
  let done = 0;
  const handle = async ({ status, file }) => {
    if (status === "D") {
      entries.push({ path: file, mode: "100644", type: "blob", sha: null });
    } else {
      const buf = readFileSync(file);
      const blob = await api("POST", `/repos/${REPO}/git/blobs`, {
        content: buf.toString("base64"),
        encoding: "base64",
      });
      entries.push({ path: file, mode: "100644", type: "blob", sha: blob.sha });
    }
    done += 1;
    if (done % 100 === 0) console.log(`  blobs ${done}/${diff.length}`);
  };
  const queue = [...diff];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) await handle(queue.shift());
    })
  );
  writeFileSync(CACHE, JSON.stringify(entries));
  console.log(`uploaded blobs for ${entries.length} entries (cache: ${CACHE})`);
}

const baseCommit = await api("GET", `/repos/${REPO}/commits/${remoteBase}`);
const message = readFileSync(msgFile, "utf8");

const byDir = new Map();
const root = [];
for (const e of entries) {
  const i = e.path.indexOf("/");
  if (i < 0) root.push(e);
  else {
    const dir = e.path.slice(0, i);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(e);
  }
}
const baseTree = await api("GET", `/repos/${REPO}/git/trees/${baseCommit.commit.tree.sha}`);
const buildTree = async (baseSha, list, label) => {
  let current = baseSha;
  for (let i = 0; i < list.length; i += 120) {
    const chunk = list.slice(i, i + 120);
    const t = await api("POST", `/repos/${REPO}/git/trees`, { base_tree: current, tree: chunk });
    current = t.sha;
    if (list.length > 120) console.log(`  ${label} ${Math.min(i + 120, list.length)}/${list.length}`);
  }
  return current;
};
const subEntries = [];
for (const [dir, list] of byDir) {
  const baseSub = baseTree.tree.find((t) => t.path === dir && t.type === "tree")?.sha;
  const stripped = list.map((t) => ({ ...t, path: t.path.slice(dir.length + 1) }));
  const sub = await buildTree(baseSub, stripped, dir);
  subEntries.push({ path: dir, mode: "040000", type: "tree", sha: sub });
}
const rootBase = await buildTree(baseCommit.commit.tree.sha, root, "(root)");
const tree = await api("POST", `/repos/${REPO}/git/trees`, { base_tree: rootBase, tree: subEntries });
const commit = await api("POST", `/repos/${REPO}/git/commits`, {
  message,
  tree: tree.sha,
  parents: [baseCommit.sha],
});
await api("PATCH", `/repos/${REPO}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
console.log(`${branch} -> ${commit.sha}`);
console.log(`tag command next: gh api -X POST repos/${REPO}/git/tags ...`);

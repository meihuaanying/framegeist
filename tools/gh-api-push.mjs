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
// v1.4.0: the uploaded delta is `localBase..target` applied on top of the remote
// tree, so `localBase` must already be published. Passing an unpushed commit
// silently ships only the last segment: v1.3.0 lost the accent assets, the host
// fix and the gate; v1.4.0 lost all twelve templates -- and because the dropped
// set included `web/app.js`, the deployed Pages site stayed on v1.2.0 while every
// workflow still reported success. Refuse rather than push a partial tree.
try {
  execFileSync("git", ["rev-parse", "--verify", `${localBase}^{commit}`], { encoding: "utf8" });
} catch {
  console.error(`local-base ${localBase} is not a commit in this repository`);
  process.exit(2);
}
// The remote head is read through the API, not `git ls-remote`: direct git
// access to github.com is blocked on this machine, which is the whole reason
// this Data-API pusher exists.
const headRef = await api("GET", `/repos/${REPO}/git/ref/heads/${branch}`);
if (headRef.object.sha !== remoteBase) {
  console.error(
    `remote ${branch} head moved: base ${remoteBase} is not the current head (${headRef.object.sha}).\n` +
      `Re-read the head and retry, otherwise the tree is built on a stale base.`,
  );
  process.exit(2);
}
console.log(`remote ${branch} head verified: ${remoteBase}`);
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
  // v1.4.0: `--include=a,b` forces paths into the entry set even when the net
  // diff does not mention them. Needed to repair a remote that a partial push
  // left holding intermediate blobs: those paths look unchanged between
  // local-base and target, so a net diff never overwrites them. The tree
  // equality guard below still decides whether the repair was complete.
  const includeArg = process.argv.find((a) => a.startsWith("--include="));
  if (includeArg) {
    const forced = includeArg
      .slice("--include=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const known = new Set(diff.map((d) => d.file));
    for (const file of forced) {
      if (known.has(file)) continue;
      diff.push({ status: "M", file });
    }
    console.log(`forced ${forced.length} path(s) via --include; diff now ${diff.length} entries`);
  }
  entries = [];
  let done = 0;
  const handle = async ({ status, file }) => {
    if (status === "D") {
      entries.push({ path: file, mode: "100644", type: "blob", sha: null });
    } else {
      // Read the blob out of git, never from the working tree: on Windows the
      // checkout is CRLF, so uploading the file on disk produced blobs whose sha
      // differed from the committed content and the remote tree never matched the
      // target. `git cat-file` gives exactly the bytes the commit references.
      const buf = execFileSync("git", ["cat-file", "blob", `${target}:${file}`], {
        encoding: "buffer",
        maxBuffer: 256 * 1024 * 1024,
      });
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
// v1.4.0: the definitive guard. The uploaded delta is applied to whatever the
// remote base holds, so the resulting root tree must equal the target commit's
// tree. If it does not, some committed path never made it into the upload --
// abort before the branch is moved, so a partial push can never look green.
const wantTree = execFileSync("git", ["rev-parse", `${target}^{tree}`], { encoding: "utf8" }).trim();
if (tree.sha !== wantTree) {
  // Workflow files are skipped on purpose (the token has no `workflow` scope),
  // so a mismatch that is *only* those paths is expected and acceptable.
  const blobMap = async (sha) => {
    const t = await api("GET", `/repos/${REPO}/git/trees/${sha}?recursive=1`);
    return new Map(t.tree.filter((x) => x.type === "blob").map((x) => [x.path, x.sha]));
  };
  const [built, want] = [await blobMap(tree.sha), await blobMap(wantTree)];
  const paths = new Set([...built.keys(), ...want.keys()]);
  const off = [];
  for (const p of paths) if (built.get(p) !== want.get(p)) off.push(p);
  const real = off.filter((p) => !p.startsWith(".github/workflows/"));
  if (real.length) {
    console.error(
      `REFUSING to update ${branch}: ${real.length} path(s) would differ from ${target}.\n` +
        `  ${real.slice(0, 6).join("\n  ")}${real.length > 6 ? "\n  ..." : ""}\n` +
        `local-base (${localBase}) does not describe what the remote already has. Find the last\n` +
        `published commit and pass it as local-base, or force the paths with --include=...`,
    );
    process.exit(3);
  }
  console.log(`tree matches ${target} except ${off.length} skipped workflow path(s)`);
} else {
  console.log(`tree verified against ${target}: ${tree.sha}`);
}
const commit = await api("POST", `/repos/${REPO}/git/commits`, {
  message,
  tree: tree.sha,
  parents: [baseCommit.sha],
});
await api("PATCH", `/repos/${REPO}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
console.log(`${branch} -> ${commit.sha}`);
console.log(`tag command next: gh api -X POST repos/${REPO}/git/tags ...`);

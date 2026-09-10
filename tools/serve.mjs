// Minimal zero-dependency static file server for local development.
// Usage: node tools/serve.mjs [port=8000]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.argv[2] ?? 8000);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    if (path === "" || path === "." || path === "web") path = "web/index.html";
    if (path === "site") path = "site/index.html";
    // Dev aliases: site pages reference ./web and ./samples which only exist
    // merged at the Pages root; map them for local preview.
    if (path.startsWith("site/web/")) path = path.slice("site/".length);
    if (path.startsWith("site/samples/")) path = "templates/samples/" + path.slice("site/samples/".length);
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) throw new Error("path traversal");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, () => console.log(`serving ${ROOT} at http://localhost:${PORT}/web/`));

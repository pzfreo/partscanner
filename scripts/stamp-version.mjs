// Adds ?v=<version> to the app's own CSS/JS references in a built site, so a
// deploy never mixes freshly fetched files with cached ones from an older
// deploy. Usage: node scripts/stamp-version.mjs <site-dir> <version>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, version] = process.argv.slice(2);
if (!dir || !version) throw new Error("usage: stamp-version.mjs <site-dir> <version>");
const v = `?v=${version}`;
const stamp = (file, rules) => {
  const path = join(dir, file);
  let text = readFileSync(path, "utf8");
  let n = 0;
  for (const [re, fn] of rules) text = text.replace(re, (...m) => (n++, fn(...m)));
  writeFileSync(path, text);
  console.log(`${file}: ${n} reference(s)`);
};

// The music reader says which version it is, so the worker can tell if it was
// handed a cached copy from another version (see omr-worker.js).
stamp("omr/runner.py", [[/^VERSION = "dev"/m, () => `VERSION = "${version}"`]]);
stamp("index.html", [[/(href|src)="([\w-]+\.(?:css|js))"/g, (_, attr, name) => `${attr}="${name}${v}"`]]);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "sw.js")) {
  stamp(file, [
    [/(from\s+"\.\/[\w-]+\.js)"/g, (_, ref) => `${ref}${v}"`],
    [/(import\("\.\/[\w-]+\.js)"\)/g, (_, ref) => `${ref}${v}")`],
    [/(new Worker\("[\w-]+\.js)"/g, (_, ref) => `${ref}${v}"`],
  ]);
}

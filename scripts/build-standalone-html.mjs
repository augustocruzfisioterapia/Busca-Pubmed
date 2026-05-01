import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, "public");
const releaseDir = path.join(root, "release");

const htmlPath = path.join(publicDir, "index.html");
const cssPath = path.join(publicDir, "styles.css");
const configPath = path.join(publicDir, "config.js");
const jsPath = path.join(publicDir, "app.js");
const outputPath = path.join(releaseDir, "Busca-PubMed-funcional.html");

const [html, css, config, rawJs] = await Promise.all([
  readFile(htmlPath, "utf8"),
  readFile(cssPath, "utf8"),
  readFile(configPath, "utf8"),
  readFile(jsPath, "utf8")
]);

const standalone = html
  .replace(/<link rel="stylesheet" href="styles\.css\?v=[^"]+">/, `<style>\n${css}\n</style>`)
  .replace(/<script src="config\.js\?v=[^"]+"><\/script>/, `<script>\n${config}\n</script>`)
  .replace(/<script src="app\.js\?v=[^"]+" type="module"><\/script>/, `<script type="module">\n${rawJs}\n</script>`);

await mkdir(releaseDir, { recursive: true });
await writeFile(outputPath, standalone, "utf8");

console.log(outputPath);

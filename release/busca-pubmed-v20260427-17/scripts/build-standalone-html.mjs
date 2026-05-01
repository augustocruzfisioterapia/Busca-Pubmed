import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, "public");
const releaseDir = path.join(root, "release");

const htmlPath = path.join(publicDir, "index.html");
const cssPath = path.join(publicDir, "styles.css");
const jsPath = path.join(publicDir, "app.js");
const outputPath = path.join(releaseDir, "Busca-PubMed-funcional.html");

const [html, css, rawJs] = await Promise.all([
  readFile(htmlPath, "utf8"),
  readFile(cssPath, "utf8"),
  readFile(jsPath, "utf8")
]);

const apiHelper = `
function apiUrl(path) {
  if (window.location.protocol === "file:") {
    return \`http://localhost:4173\${path}\`;
  }
  return path;
}
`;

const js = `${apiHelper}\n${rawJs}`
  .replaceAll('fetch("/api/search"', 'fetch(apiUrl("/api/search")')
  .replaceAll('fetch("/api/resolve-terms"', 'fetch(apiUrl("/api/resolve-terms")');

const standalone = html
  .replace(/<link rel="stylesheet" href="\/styles\.css\?v=[^"]+">/, `<style>\n${css}\n</style>`)
  .replace(/<script src="\/app\.js\?v=[^"]+" type="module"><\/script>/, `<script type="module">\n${js}\n</script>`);

await mkdir(releaseDir, { recursive: true });
await writeFile(outputPath, standalone, "utf8");

console.log(outputPath);

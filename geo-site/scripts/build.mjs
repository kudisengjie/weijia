import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(projectRoot, "assets");

fs.mkdirSync(assetsDir, { recursive: true });

await build({
  entryPoints: [path.join(projectRoot, "src", "app.js")],
  bundle: true,
  format: "iife",
  minify: true,
  sourcemap: false,
  target: ["chrome120"],
  outfile: path.join(assetsDir, "app.js"),
  define: {
    "process.env.NODE_ENV": '"production"'
  }
});

fs.copyFileSync(
  path.join(projectRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"),
  path.join(assetsDir, "pdf.worker.min.mjs"),
);

console.log("Built geo-site/assets/app.js and local PDF worker.");

// Only this allowlisted directory is public. Never publish server source or configuration files.
const output = path.join(projectRoot, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.ico']) fs.copyFileSync(path.join(projectRoot, file), path.join(output, file));
fs.cpSync(assetsDir, path.join(output, 'assets'), { recursive: true });
const allowed = new Set(['index.html', 'styles.css', 'favicon.ico', 'assets']);
for (const file of fs.readdirSync(output)) if (!allowed.has(file)) throw new Error(`Unexpected public file: ${file}. Refusing unsafe deployment output.`);
console.log('Public dist ready. EdgeOne bundles cloud-functions separately.');

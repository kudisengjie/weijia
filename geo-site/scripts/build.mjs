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

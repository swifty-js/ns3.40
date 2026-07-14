#!/usr/bin/env node

// @ts-check

import { execFile } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {string} */
const input = resolve(__dirname, "workflow.mermaid");

/** @type {string} */
const output = resolve(__dirname, "workflow.png");

/** @type {string} */
const mmdc = resolve(__dirname, "..", "node_modules", ".bin", "mmdc");

/**
 * Mermaid theme configuration for transparent flowchart rendering.
 * @type {import("mermaid").MermaidConfig}
 */
const config = {
  theme: "base",
  themeVariables: {
    primaryColor: "#ffffff",
    primaryTextColor: "#333333",
    primaryBorderColor: "#333333",
    lineColor: "#333333",
    secondaryColor: "#ffffff",
    tertiaryColor: "#ffffff",
    noteBkgColor: "#ffffff",
    mainBkg: "#ffffff",
    nodeBorder: "#333333",
    clusterBkg: "#ffffff",
    titleColor: "#333333",
    edgeLabelBackground: "#ffffff",
    nodeTextColor: "#333333",
  },
  themeCSS:
    ".node rect, .node polygon, .node circle { fill: transparent !important; } .edgeLabel { background: transparent !important; }",
  flowchart: { htmlLabels: true, useMaxWidth: false },
};

/** @type {{ args: string[] }} */
const puppeteerConfig = {
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
};

/** @type {string} */
const configPath = "/tmp/mermaid-config.json";

/** @type {string} */
const puppeteerPath = "/tmp/puppeteer-config.json";

writeFileSync(configPath, JSON.stringify(config));
writeFileSync(puppeteerPath, JSON.stringify(puppeteerConfig));

if (!existsSync(mmdc)) {
  console.error(`mmdc not found at ${mmdc}`);
  process.exit(1);
}

if (!existsSync(input)) {
  console.error(`Input file not found: ${input}`);
  process.exit(1);
}

/** @type {string[]} */
const args = [
  "-i", input,
  "-o", output,
  "-c", configPath,
  "-p", puppeteerPath,
  "-b", "transparent",
  "-s", "2",
];

console.log("Generating flowchart...");

execFile(mmdc, args, (err, _stdout, stderr) => {
  if (err) {
    console.error("Error:", err.message);
    if (stderr) console.error(stderr);
    process.exit(1);
  }
  if (stderr) console.log(stderr.trim());
  console.log(`Done: ${output}`);
});

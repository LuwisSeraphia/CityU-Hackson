import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
const source = readFileSync(new URL("../../../DESIGN.md", import.meta.url), "utf8").split("---")[1];
const declarations = [];
let section = "";
let font = "";
for (const line of source.split(/\r?\n/)) {
  const heading = line.match(/^(colors|typography|rounded|spacing):/);
  if (heading) { section = heading[1]; continue; }
  if (/^\S/.test(line)) { section = ""; continue; }
  const entry = line.match(/^  ([\w-]+):\s*["'](.*)["']$/);
  if (entry && ["colors", "rounded", "spacing"].includes(section)) {
    const prefix = { colors: "color", rounded: "radius", spacing: "spacing" }[section];
    declarations.push(`  --${prefix}-${entry[1]}: ${entry[2]};`);
  }
  if (section === "typography") {
    const name = line.match(/^  ([\w-]+):$/);
    if (name) font = name[1];
    const family = line.match(/^    fontFamily: '(.*)'$/);
    if (family) declarations.push(`  --font-${font}: ${family[1]};`);
  }
}
const output = await format(`/* Generated from DESIGN.md. Run npm run tokens. */\n@theme {\n${declarations.join("\n")}\n}\n`, { parser: "css" });
const target = new URL("../src/app/tokens.css", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) throw new Error("DESIGN.md token drift: run npm run tokens");
  console.log("Design tokens match DESIGN.md");
} else { writeFileSync(target, output); console.log(fileURLToPath(target)); }

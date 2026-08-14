import fs from "node:fs";
const dts = fs.readFileSync("types/NetscriptDefinitions.d.ts", "utf8");
const source = fs.readFileSync("darknet-manager.js", "utf8");
const apiNames = new Set([...dts.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]));
const localFunctions = new Set([...source.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
const collisions = [...localFunctions].filter(name => apiNames.has(name)).sort();
if (collisions.length) {
  console.error("Bitburner RAM identifier collisions:");
  for (const name of collisions) console.error(`  - ${name}`);
  process.exit(1);
}
console.log(`RAM collision check OK (${localFunctions.size} local functions vs ${apiNames.size} API method names)`);

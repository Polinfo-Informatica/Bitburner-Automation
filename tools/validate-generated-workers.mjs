import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const source = fs.readFileSync("darknet-manager.js", "utf8");
const blocks = [
    ...source.matchAll(
        /const\s+([A-Z_]+_SOURCE)\s*=\s*String\.raw`([\s\S]*?)`;/g
    ),
];
if (!blocks.length)
    throw new Error("No generated worker String.raw blocks found");
for (const [, name, code] of blocks) {
    const file = path.join(os.tmpdir(), `${name}.js`);
    fs.writeFileSync(file, code, "utf8");
    const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
    });
    if (result.status !== 0) {
        process.stderr.write(result.stderr || result.stdout || "");
        throw new Error(`${name} failed node --check`);
    }
    console.log(`syntax OK: ${name}`);
}

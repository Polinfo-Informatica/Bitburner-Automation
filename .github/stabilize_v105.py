from pathlib import Path
import re

p = Path("darknet-manager.js")
s = p.read_text(encoding="utf-8")
if 'const VERSION = "1.0.4";' not in s:
    raise SystemExit("Expected darknet-manager.js v1.0.4")
s = s.replace('const VERSION = "1.0.4";', 'const VERSION = "1.0.5";', 1)

# Suppress routine Netscript logging in manager and generated workers.
s = s.replace('export async function main(ns) {\n', 'export async function main(ns) {\n    try { ns.disableLog("ALL"); } catch { }\n')

# Add formula-aware RAM launcher path in manager + agent constant blocks.
s = s.replace(
    'const PHISH_LAUNCHER = "/Temp/dnet-phish-launcher.js";\n    const RAM_WORKER = "/Temp/dnet-ram-worker.js";',
    'const PHISH_LAUNCHER = "/Temp/dnet-phish-launcher.js";\n    const RAM_LAUNCHER = "/Temp/dnet-ram-launcher.js";\n    const RAM_WORKER = "/Temp/dnet-ram-worker.js";'
)

s = s.replace(
    'const REPORT_FRESH_MS = 120000;\n    const STASIS_REFRESH_MS = 15000;\n    const SUMMARY_INTERVAL_MS = 30000;\n    const WORKER_REFRESH_MS = 60000;',
    'const REPORT_FRESH_MS = 180000;\n    const REPORT_RETENTION_MS = 600000;\n    const STASIS_REFRESH_MS = 30000;\n    const STASIS_REPUSH_MS = 300000;\n    const SUMMARY_INTERVAL_MS = 30000;\n    const WORKER_REFRESH_MS = 300000;'
)

ram_launcher = r'''
    const RAM_LAUNCHER_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    try { ns.disableLog("ALL"); } catch { }
    const RAM_WORKER = "/Temp/dnet-ram-worker.js";
    const host = ns.getHostname();
    try {
        const blocked = ns.dnet.getBlockedRam();
        if (!(blocked > 0)) return;
        const workerRam = ns.getScriptRam(RAM_WORKER, host);
        if (!(workerRam > 0)) return;
        const freeRam = Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host));
        const maxThreads = Math.floor(freeRam / workerRam);
        if (maxThreads < 1) return;

        let selectedThreads = maxThreads;
        try {
            const details = ns.dnet.getServerDetails();
            const player = ns.getPlayer();
            let low = 1;
            let high = maxThreads;
            let best = maxThreads;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const expected = ns.formulas.dnet.getExpectedRamBlockRemoved(details, mid, player);
                if (expected >= blocked * 0.999) {
                    best = mid;
                    high = mid - 1;
                } else {
                    low = mid + 1;
                }
            }
            selectedThreads = best;
        } catch { }

        ns.exec(RAM_WORKER, host, selectedThreads, "formula-selected");
    } catch { }
}
`;
'''
marker = '    const STASIS_SOURCE = String.raw`'
if marker not in s:
    raise SystemExit("STASIS source marker missing")
s = s.replace(marker, ram_launcher + "\n" + marker, 1)

old_launcher = '''    const PHISH_LAUNCHER_SOURCE = String.raw`\n/** @param {NS} ns */\nexport async function main(ns) {\n    try { ns.disableLog("ALL"); } catch { }\n    const PHISH = "/Temp/dnet-phish.js";\n    const host = ns.getHostname();\n\n    try {\n        if (ns.ps(host).some(function (p) { return p.filename === PHISH; })) return;\n\n        const ram = ns.getScriptRam(PHISH, host);\n        if (!(ram > 0)) return;\n\n        const free = Math.max(\n            0,\n            ns.getServerMaxRam(host) - ns.getServerUsedRam(host)\n        );\n\n        const threads = Math.floor(free / ram);\n        if (threads > 0) ns.exec(PHISH, host, threads);\n    } catch { }\n}\n`;'''
new_launcher = '''    const PHISH_LAUNCHER_SOURCE = String.raw`\n/** @param {NS} ns */\nexport async function main(ns) {\n    try { ns.disableLog("ALL"); } catch { }\n    const PHISH = "/Temp/dnet-phish.js";\n    const host = ns.getHostname();\n    if (host === "darkweb") return;\n\n    try {\n        if (ns.ps(host).some(function (p) { return p.filename === PHISH; })) return;\n        const ram = ns.getScriptRam(PHISH, host);\n        if (!(ram > 0)) return;\n        const free = Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host));\n        const threads = Math.floor((free * 0.65) / ram);\n        if (threads > 0) ns.exec(PHISH, host, threads, "managed");\n    } catch { }\n}\n`;'''
if old_launcher not in s:
    raise SystemExit("PHISH launcher block not found")
s = s.replace(old_launcher, new_launcher, 1)

s = s.replace(
    'const REPORT_INTERVAL = 7000;\n    const MAX_AUTH_RETRIES = 4;\n    const MAX_BRUTE_ATTEMPTS = 1000;\n    const PHISH_UTILIZATION = 0.90;',
    'const AGENT_VERSION = "1.0.5";\n    const REPORT_INTERVAL = 15000;\n    const LOOT_INTERVAL = 60000;\n    const LOOP_INTERVAL = 4000;\n    const MAX_AUTH_RETRIES = 4;\n    const MAX_BRUTE_ATTEMPTS = 1000;'
)
s = s.replace('let lastReport = 0;', 'let lastReport = 0;\n    let lastLoot = 0;', 1)
s = s.replace('if (foundCredentials.length > 200) foundCredentials.shift();', 'if (foundCredentials.length > 100) foundCredentials.shift();')
s = s.replace('cooldownUntil.set(target, Date.now() + 30000);', 'cooldownUntil.set(target, Date.now() + 60000);')
s = s.replace('found: foundCredentials.slice(-100),', 'found: foundCredentials.slice(-25),')
s = s.replace('modelId: details ? String(details.modelId || "") : "",', 'modelId: details ? String(details.modelId || "") : "",\n                agentVersion: AGENT_VERSION,')

old_loot = '''    async function lootSelf() {\n        try {\n            const running = ns.ps(host).some(function (p) {\n                return p.filename === LOOT;\n            });\n            if (!running) ns.exec(LOOT, host, 1);\n        } catch { }\n    }'''
new_loot = '''    async function lootSelf() {\n        if (Date.now() - lastLoot < LOOT_INTERVAL) return;\n        lastLoot = Date.now();\n        try {\n            const running = ns.ps(host).some(function (p) { return p.filename === LOOT; });\n            if (!running) ns.exec(LOOT, host, 1, "periodic");\n        } catch { }\n    }'''
if old_loot not in s:
    raise SystemExit("lootSelf block not found")
s = s.replace(old_loot, new_loot, 1)

s = s.replace('try { pid = ns.exec(RAM_WORKER, target, 1); }', 'try { pid = ns.exec(RAM_LAUNCHER, target, 1); }')
s = s.replace('for (let i = 0; i < 1200; i++) {', 'for (let i = 0; i < 120; i++) {', 1)
s = s.replace('for (let i = 0; i < 600; i++) {', 'for (let i = 0; i < 40; i++) {', 1)

old_existing = '''        try {\n            const existing = ns.ps(target).some(function (p) {\n                return p.filename === AGENT;\n            });\n            if (existing) return true;\n        } catch { }\n\n        try { return ns.exec(AGENT, target, 1, password) !== 0; }\n        catch { return false; }'''
new_existing = '''        try {\n            const managed = [AGENT, PHISH, PHISH_LAUNCHER, RAM_LAUNCHER, RAM_WORKER, STASIS, LOOT];\n            const processes = ns.ps(target);\n            const existing = processes.find(function (p) { return p.filename === AGENT; });\n            if (existing && String(existing.args && existing.args[1] || "") === AGENT_VERSION) return true;\n            for (const proc of processes) {\n                if (managed.includes(proc.filename)) {\n                    try { ns.kill(proc.pid); } catch { }\n                }\n            }\n            if (processes.length > 0) await ns.sleep(50);\n        } catch { }\n\n        try { return ns.exec(AGENT, target, 1, password, AGENT_VERSION) !== 0; }\n        catch { return false; }'''
if old_existing not in s:
    raise SystemExit("deployChild existing-agent block not found")
s = s.replace(old_existing, new_existing, 1)

old_neighbor = '''                let alreadyRunning = false;\n                try { alreadyRunning = ns.ps(target).some(function (p) { return p.filename === AGENT; }); }\n                catch { }\n                if (alreadyRunning) continue;'''
new_neighbor = '''                let currentAgent = null;\n                try { currentAgent = ns.ps(target).find(function (p) { return p.filename === AGENT; }) || null; }\n                catch { }\n                if (currentAgent && String(currentAgent.args && currentAgent.args[1] || "") === AGENT_VERSION) continue;'''
if old_neighbor not in s:
    raise SystemExit("neighbor existing-agent block not found")
s = s.replace(old_neighbor, new_neighbor, 1)
s = s.replace('await ns.sleep(1500);', 'await ns.sleep(LOOP_INTERVAL);', 1)

s = s.replace(
    '[AGENT, PHISH, PHISH_LAUNCHER, RAM_WORKER, STASIS, LOOT, PLAN, DB_FILE]',
    '[AGENT, PHISH, PHISH_LAUNCHER, RAM_LAUNCHER, RAM_WORKER, STASIS, LOOT, PLAN, DB_FILE]'
)
s = s.replace(
    'await ns.write(PHISH_LAUNCHER, PHISH_LAUNCHER_SOURCE, "w");\n        await ns.write(RAM_WORKER, RAM_WORKER_SOURCE, "w");',
    'await ns.write(PHISH_LAUNCHER, PHISH_LAUNCHER_SOURCE, "w");\n        await ns.write(RAM_LAUNCHER, RAM_LAUNCHER_SOURCE, "w");\n        await ns.write(RAM_WORKER, RAM_WORKER_SOURCE, "w");'
)

pattern = re.compile(r'    function readReports\(\) \{.*?\n    \}\n\n    async function ingestReports', re.S)
replacement = '''    function readReports() {\n        const reports = [];\n        const now = Date.now();\n        for (const file of ns.ls("home", REPORT_PREFIX)) {\n            try {\n                const r = JSON.parse(ns.read(file));\n                if (!r || !r.host) continue;\n                if (now - Number(r.ts || 0) > REPORT_RETENTION_MS) {\n                    try { ns.rm(file, "home"); } catch { }\n                    continue;\n                }\n                try {\n                    const server = ns.getServer(r.host);\n                    if (server && server.isOnline === false) continue;\n                    if (server) {\n                        r.maxRam = Number(server.maxRam || 0);\n                        r.usedRam = Number(server.ramUsed || 0);\n                    }\n                } catch { }\n                reports.push(r);\n            } catch { }\n        }\n        return reports;\n    }\n\n    async function ingestReports'''
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit("readReports replacement failed")

pattern = re.compile(r'    async function pushControlFiles\(host, password\) \{.*?\n    \}\n\n    async function updateStasisPlan\(db, reports\) \{.*?\n    \}\n\n    function summary', re.S)
replacement = '''    async function pushPlanFiles(host, password) {\n        try {\n            const session = ns.dnet.connectToSession(host, password);\n            if (!session || !session.success) return false;\n            await ns.scp([PLAN, STASIS], host, "home");\n            return true;\n        } catch { return false; }\n    }\n\n    async function updateStasisPlan(db, reports) {\n        let limit = 0;\n        try { limit = ns.dnet.getStasisLinkLimit(); }\n        catch { return; }\n\n        const now = Date.now();\n        const latest = new Map();\n        for (const r of reports) {\n            if (!r || !r.host || r.host === "darkweb" || r.isStationary) continue;\n            if (now - Number(r.ts || 0) > REPORT_FRESH_MS) continue;\n            const old = latest.get(r.host);\n            if (!old || Number(r.ts || 0) > Number(old.ts || 0)) latest.set(r.host, r);\n        }\n\n        const candidates = Array.from(latest.values()).sort(function (a, b) {\n            const ram = Number(b.maxRam || 0) - Number(a.maxRam || 0);\n            if (ram !== 0) return ram;\n            const blocked = Number(a.blockedRam || 0) - Number(b.blockedRam || 0);\n            if (blocked !== 0) return blocked;\n            return Number(b.depth || -1) - Number(a.depth || -1);\n        });\n        const desired = candidates.slice(0, Math.max(0, limit)).map(function (r) { return r.host; });\n\n        let previous = { desired: [], ts: 0 };\n        try {\n            const raw = ns.read(PLAN);\n            if (raw) previous = JSON.parse(raw);\n        } catch { }\n        const oldDesired = Array.isArray(previous.desired) ? previous.desired : [];\n        const changed = JSON.stringify(oldDesired) !== JSON.stringify(desired);\n        const needsRepush = now - Number(previous.ts || 0) >= STASIS_REPUSH_MS;\n        if (!changed && !needsRepush) return;\n\n        await ns.write(PLAN, JSON.stringify({ desired: desired, ts: now }), "w");\n        let linked = [];\n        try { linked = ns.dnet.getStasisLinkedServers(false); } catch { }\n        const targets = Array.from(new Set(desired.concat(linked)));\n        for (const h of targets) {\n            const report = latest.get(h);\n            const entry = db[h];\n            const password = report && typeof report.password === "string" ? report.password : entry && entry.password;\n            if (typeof password !== "string") continue;\n            await pushPlanFiles(h, password);\n        }\n        if (changed) log("Stasis plan -> [" + desired.join(", ") + "]", false);\n    }\n\n    function summary'''
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit("stasis replacement failed")

old_seed = '''    async function seedDarkweb() {\n        try {\n            if (ns.ps("darkweb").some(function (p) { return p.filename === AGENT; })) return true;\n        } catch { }'''
new_seed = '''    async function seedDarkweb() {\n        try {\n            const running = ns.ps("darkweb").find(function (p) { return p.filename === AGENT; });\n            if (running && String(running.args && running.args[1] || "") === VERSION) return true;\n            if (running) {\n                try { ns.kill(running.pid); } catch { }\n                await ns.sleep(50);\n            }\n        } catch { }'''
if old_seed not in s:
    raise SystemExit("seedDarkweb header not found")
s = s.replace(old_seed, new_seed, 1)
s = s.replace('const pid = ns.exec(AGENT, "darkweb", 1, "");', 'const pid = ns.exec(AGENT, "darkweb", 1, "", VERSION);', 1)

idx = s.rfind('await ns.sleep(2000);')
if idx < 0:
    raise SystemExit("manager 2s sleep not found")
s = s[:idx] + 'await ns.sleep(5000);' + s[idx + len('await ns.sleep(2000);'):]

p.write_text(s, encoding="utf-8")

Path("tools").mkdir(exist_ok=True)
Path("types").mkdir(exist_ok=True)

Path("tools/validate-generated-workers.mjs").write_text(r'''import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const source = fs.readFileSync("darknet-manager.js", "utf8");
const blocks = [...source.matchAll(/const\s+([A-Z_]+_SOURCE)\s*=\s*String\.raw`([\s\S]*?)`;/g)];
if (!blocks.length) throw new Error("No generated worker String.raw blocks found");
for (const [, name, code] of blocks) {
  const file = path.join(os.tmpdir(), `${name}.js`);
  fs.writeFileSync(file, code, "utf8");
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    throw new Error(`${name} failed node --check`);
  }
  console.log(`syntax OK: ${name}`);
}
''', encoding="utf-8")

Path("tools/check-bitburner-ram-collisions.mjs").write_text(r'''import fs from "node:fs";
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
''', encoding="utf-8")

Path("types/global.d.ts").write_text(
    'import type { NS as BitburnerNS } from "./NetscriptDefinitions";\n'
    'declare global { type NS = BitburnerNS; }\n'
    'export {};\n', encoding="utf-8")

Path("tsconfig.json").write_text(r'''{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": false,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["darknet-manager.js", "types/global.d.ts", "types/NetscriptDefinitions.d.ts"],
  "exclude": ["node_modules"]
}
''', encoding="utf-8")

Path("eslint.config.mjs").write_text(r'''import js from "@eslint/js";
import globals from "globals";
export default [
  { ignores: ["types/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.es2021, ...globals.node } },
    rules: {
      "no-empty": "off",
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
    }
  }
];
''', encoding="utf-8")

Path("package.json").write_text(r'''{
  "name": "bitburner-automation",
  "private": true,
  "scripts": {
    "syntax": "node --check darknet-manager.js && node tools/validate-generated-workers.mjs",
    "ram-collisions": "node tools/check-bitburner-ram-collisions.mjs",
    "typecheck": "tsc -p tsconfig.json",
    "lint": "eslint darknet-manager.js tools/*.mjs",
    "check": "npm run syntax && npm run ram-collisions && npm run typecheck && npm run lint"
  },
  "devDependencies": {
    "@eslint/js": "latest",
    "eslint": "latest",
    "globals": "latest",
    "typescript": "latest"
  }
}
''', encoding="utf-8")

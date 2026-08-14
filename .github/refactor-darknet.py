from pathlib import Path
import re

p = Path("darknet-manager.js")
s = p.read_text(encoding="utf-8")

def must_replace(old, new, count=1, label="replacement"):
    global s
    if old not in s:
        raise SystemExit(f"Missing expected text for {label}")
    s = s.replace(old, new, count)

def replace_span(start, end, new, label):
    global s
    a = s.find(start)
    if a < 0:
        raise SystemExit(f"Missing start marker for {label}")
    b = s.find(end, a)
    if b < 0:
        raise SystemExit(f"Missing end marker for {label}")
    s = s[:a] + new + s[b:]

must_replace('const VERSION = "1.0.2";', 'const VERSION = "1.0.3";', 1, "version")

s = s.replace(
    'const PHISH = "/Temp/dnet-phish.js";\n    const RAM_WORKER',
    'const PHISH = "/Temp/dnet-phish.js";\n    const PHISH_LAUNCHER = "/Temp/dnet-phish-launcher.js";\n    const RAM_WORKER'
)
s = s.replace(
    'const STASIS = "/Temp/dnet-stasis.js";\n    const PLAN',
    'const STASIS = "/Temp/dnet-stasis.js";\n    const LOOT = "/Temp/dnet-loot.js";\n    const PLAN'
)

ram_source = r'''    const RAM_WORKER_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    let unchanged = 0;
    let lastBlocked = Number.POSITIVE_INFINITY;

    while (true) {
        let blocked = 0;
        try { blocked = ns.dnet.getBlockedRam(); }
        catch { return; }

        if (!(blocked > 0)) return;

        try {
            const result = await ns.dnet.memoryReallocation();
            if (result && result.code === 454) return;
        } catch {
            return;
        }

        let nowBlocked = blocked;
        try { nowBlocked = ns.dnet.getBlockedRam(); }
        catch { return; }

        if (nowBlocked >= lastBlocked - 0.0001) unchanged++;
        else unchanged = 0;

        lastBlocked = nowBlocked;
        if (unchanged >= 8) return;
    }
}
`;

'''
replace_span('    const RAM_WORKER_SOURCE = String.raw`',
             '    const STASIS_SOURCE = String.raw`',
             ram_source, "RAM worker")

helpers = r'''    const STASIS_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    const shouldLink = String(ns.args[0] ?? "1") !== "0";
    try { await ns.dnet.setStasisLink(shouldLink); }
    catch { }
}
`;

    const LOOT_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    const host = ns.getHostname();

    try {
        const caches = ns.ls(host, ".cache");
        for (const cache of caches) {
            try { ns.dnet.openCache(cache, true); }
            catch { }
        }
    } catch { }

    try {
        const files = ns.ls(host).filter(function (f) {
            return !f.startsWith("/Temp/dnet-") &&
                   !f.endsWith(".cache") &&
                   f !== "darknet-passwords.txt";
        });

        for (const file of files) {
            try { await ns.scp(file, "home", host); }
            catch { }

            if (file.endsWith(".txt")) {
                try {
                    const text = ns.read(file);
                    const safeHost = encodeURIComponent(host).replaceAll("%", "_");
                    const safeFile = encodeURIComponent(file).replaceAll("%", "_");
                    const archive = "/Temp/dnet-loot-" + safeHost + "-" + safeFile;
                    await ns.write(
                        archive,
                        "SOURCE=" + host + "\\nFILE=" + file + "\\n\\n" + text,
                        "w"
                    );
                    await ns.scp(archive, "home", host);
                } catch { }
            }
        }
    } catch { }
}
`;

    const PHISH_LAUNCHER_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    const PHISH = "/Temp/dnet-phish.js";
    const host = ns.getHostname();

    try {
        if (ns.ps(host).some(function (p) { return p.filename === PHISH; })) return;

        const ram = ns.getScriptRam(PHISH, host);
        if (!(ram > 0)) return;

        const free = Math.max(
            0,
            ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
        );

        const threads = Math.floor(free / ram);
        if (threads > 0) ns.exec(PHISH, host, threads);
    } catch { }
}
`;

'''
replace_span('    const STASIS_SOURCE = String.raw`',
             '    const AGENT_SOURCE = String.raw`',
             helpers, "helper workers")

replace_span(
    '    function killPhishers() {',
    '    async function fullyReallocate(target, password) {',
    '    async function fullyReallocate(target) {',
    "killPhishers"
)

replace_span(
    '    async function fullyReallocate(target) {',
    '    async function deployChild(target, password) {',
    r'''    async function fullyReallocate(target) {
        let pid = 0;
        try { pid = ns.exec(RAM_WORKER, target, 1); }
        catch { pid = 0; }

        if (pid === 0) return;

        for (let i = 0; i < 1200; i++) {
            let blocked = 0;
            try { blocked = ns.dnet.getBlockedRam(target); }
            catch { return; }

            if (!(blocked > 0)) return;
            await ns.sleep(250);
        }
    }

''',
    "fullyReallocate"
)

replace_span(
    '    async function deployChild(target, password) {',
    '    async function lootSelf() {',
    r'''    async function deployChild(target, password) {
        try {
            await ns.scp(
                [AGENT, PHISH, PHISH_LAUNCHER, RAM_WORKER, STASIS, LOOT, PLAN, DB_FILE],
                target,
                host
            );
        } catch {
            return false;
        }

        await fullyReallocate(target);

        let lootPid = 0;
        try { lootPid = ns.exec(LOOT, target, 1); }
        catch { lootPid = 0; }

        if (lootPid !== 0) {
            for (let i = 0; i < 600; i++) {
                let running = false;
                try {
                    running = ns.ps(target).some(function (p) { return p.pid === lootPid; });
                } catch { }
                if (!running) break;
                await ns.sleep(50);
            }
        }

        try {
            const existing = ns.ps(target).some(function (p) {
                return p.filename === AGENT;
            });
            if (existing) return true;
        } catch { }

        try { return ns.exec(AGENT, target, 1, password) !== 0; }
        catch { return false; }
    }

''',
    "deployChild"
)

replace_span(
    '    async function lootSelf() {',
    '    function readPlan() {',
    r'''    async function lootSelf() {
        try {
            const running = ns.ps(host).some(function (p) {
                return p.filename === LOOT;
            });
            if (!running) ns.exec(LOOT, host, 1);
        } catch { }
    }

''',
    "lootSelf"
)

replace_span(
    '    async function maybeToggleStasis() {',
    '    function ensurePhishing() {',
    r'''    async function maybeToggleStasis() {
        if (host === "darkweb") return false;

        const details = getDetails(host);
        if (details && details.isStationary) return false;

        const plan = readPlan();
        if (!plan) return false;

        let linked = [];
        try { linked = ns.dnet.getStasisLinkedServers(false); }
        catch { return false; }

        const isLinked = linked.includes(host);
        const shouldLink = plan.desired.includes(host);
        if (isLinked === shouldLink) return false;

        try {
            const running = ns.ps(host).some(function (p) {
                return p.filename === STASIS;
            });
            if (!running) ns.exec(STASIS, host, 1, shouldLink ? "1" : "0");
        } catch { }

        return false;
    }

''',
    "maybeToggleStasis"
)

replace_span(
    '    function ensurePhishing() {',
    '    async function saveReport(errorText) {',
    r'''    function ensurePhishing() {
        try {
            const busy = ns.ps(host).some(function (p) {
                return p.filename === PHISH || p.filename === PHISH_LAUNCHER;
            });
            if (!busy) ns.exec(PHISH_LAUNCHER, host, 1);
        } catch { }
    }

''',
    "ensurePhishing"
)

must_replace(
    '        await ns.write(PHISH, PHISH_SOURCE, "w");\n'
    '        await ns.write(RAM_WORKER, RAM_WORKER_SOURCE, "w");',
    '        await ns.write(PHISH, PHISH_SOURCE, "w");\n'
    '        await ns.write(PHISH_LAUNCHER, PHISH_LAUNCHER_SOURCE, "w");\n'
    '        await ns.write(RAM_WORKER, RAM_WORKER_SOURCE, "w");',
    1, "write phish launcher"
)
must_replace(
    '        await ns.write(STASIS, STASIS_SOURCE, "w");\n'
    '        if (!ns.fileExists(PLAN, "home"))',
    '        await ns.write(STASIS, STASIS_SOURCE, "w");\n'
    '        await ns.write(LOOT, LOOT_SOURCE, "w");\n'
    '        if (!ns.fileExists(PLAN, "home"))',
    1, "write loot"
)

s = s.replace(
    '[AGENT, PHISH, RAM_WORKER, STASIS, PLAN, DB_FILE]',
    '[AGENT, PHISH, PHISH_LAUNCHER, RAM_WORKER, STASIS, LOOT, PLAN, DB_FILE]'
)

old = '''    await writeWorkers();
    const db = loadDb();
    log("Dark Net manager started. Persistent credential DB: " + DB_FILE, true);
    log("Generated crawler/RAM/phishing/stasis workers automatically under /Temp.", true);'''
new = '''    await writeWorkers();
    const agentRam = ns.getScriptRam(AGENT, "home");
    const db = loadDb();
    log("Dark Net manager started. Persistent credential DB: " + DB_FILE, true);
    log("Generated crawler/RAM/loot/phishing/stasis workers automatically under /Temp.", true);
    log("Generated crawler RAM: " + ns.format.ram(agentRam) + " (darkweb capacity: 16 GB).", true);

    if (!(agentRam > 0) || agentRam > 16) {
        log("ERROR: generated crawler exceeds the 16 GB darkweb gateway limit; refusing to retry-loop.", true);
        return;
    }'''
must_replace(old, new, 1, "startup RAM guard")

p.write_text(s, encoding="utf-8")

# Validate the manager itself and every generated worker before allowing the workflow to commit.
import subprocess, tempfile
subprocess.run(["node", "--check", str(p)], check=True)

final_text = p.read_text(encoding="utf-8")
blocks = re.findall(r'const\s+([A-Z_]+_SOURCE)\s*=\s*String\.raw`(.*?)`;', final_text, re.S)
if len(blocks) < 6:
    raise SystemExit(f"Expected at least 6 generated worker blocks, found {len(blocks)}")

for name, source in blocks:
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(source)
        temp_path = f.name
    subprocess.run(["node", "--check", temp_path], check=True)
    print("Syntax OK:", name)

agent = dict(blocks).get("AGENT_SOURCE", "")
forbidden = [
    "ns.dnet.openCache",
    "ns.dnet.memoryReallocation",
    "ns.spawn",
    "ns.run",
    "ns.kill",
    "ns.getScriptRam",
    "ns.getServerMaxRam",
    "ns.getServerUsedRam",
    "ns.isRunning",
]
bad = [api for api in forbidden if api in agent]
if bad:
    raise SystemExit("Persistent agent still contains heavyweight APIs: " + ", ".join(bad))

print("Refactor and validation complete.")

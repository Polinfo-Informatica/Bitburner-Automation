import fs from "node:fs";

const manager = fs.readFileSync("darknet-manager.js", "utf8");
const cleanup = fs.readFileSync("darknet-cleanup.js", "utf8");
const snapshot = fs.readFileSync("darknet-snapshot.js", "utf8");
const updater = fs.readFileSync("dnet-git-pull.js", "utf8");

function fail(message) {
    console.error(`Runtime safety check failed: ${message}`);
    process.exit(1);
}

const managerVersion = manager.match(/const VERSION = "([^"]+)";/)?.[1];
const agentVersion = manager.match(/const AGENT_VERSION = "([^"]+)";/)?.[1];
const cleanupVersion = cleanup.match(/const VERSION = "([^"]+)";/)?.[1];
const snapshotVersion = snapshot.match(/const VERSION = "([^"]+)";/)?.[1];
if (
    !managerVersion ||
    managerVersion !== agentVersion ||
    managerVersion !== cleanupVersion ||
    managerVersion !== snapshotVersion
) {
    fail(
        `runtime versions differ (manager=${managerVersion ?? "missing"}, agent=${agentVersion ?? "missing"}, cleanup=${cleanupVersion ?? "missing"}, snapshot=${snapshotVersion ?? "missing"}).`
    );
}

const singletonStart = manager.indexOf("async function enforceSingleManager()");
const singletonCall = manager.indexOf("await enforceSingleManager();");
const workerWriteCall = manager.lastIndexOf("await writeWorkers();");
if (singletonStart < 0 || singletonCall < 0) {
    fail("darknet-manager.js does not enforce a single manager instance.");
}
if (singletonCall > workerWriteCall) {
    fail("the singleton guard must run before generated workers are written.");
}

const singletonSource = manager.slice(singletonStart, singletonCall);
for (const required of [
    "ns.pid",
    "ns.getScriptName()",
    'ns.ps("home")',
    "ns.kill(process.pid)",
]) {
    if (!singletonSource.includes(required)) {
        fail(`singleton guard is missing ${required}.`);
    }
}

const managerKill = cleanup.indexOf("ns.kill(process.pid)");
const workerCleanup = cleanup.indexOf(
    "for (let pass = 1; pass <= CLEANUP_PASSES; pass++)"
);
if (!cleanup.includes('const MANAGER = "darknet-manager.js";')) {
    fail("darknet-cleanup.js does not identify the manager filename.");
}
if (managerKill < 0 || workerCleanup < 0 || managerKill > workerCleanup) {
    fail("cleanup must stop old managers before cleaning remote workers.");
}
if (!cleanup.includes("const CLEANUP_PASSES = 4;")) {
    fail("cleanup must perform multiple stabilization passes.");
}

for (const required of [
    "const PHISH_HOST_HARD_LIMIT = 4;",
    "const MIN_COOLDOWN_MS = 5000;",
    "plan.desired.length > 4",
    "await ns.sleep(cooldown)",
    "const MIN_DNET_REQUEST_INTERVAL = 750;",
    "const MAX_BRUTE_ATTEMPTS = 100;",
    'const VISIT_MARKER = "/Temp/dnet-crawl-marker.txt";',
    "const MAX_CRAWL_DEPTH = 16;",
    "const MAX_CRAWL_STACK = MAX_CRAWL_DEPTH + 1;",
    "const CRAWL_RESTART_DELAY_MS = 120000;",
    "await waitForChild(target, childPid);",
    'phase = "complete";',
]) {
    if (!manager.includes(required)) {
        fail(`bounded runtime guard is missing ${required}.`);
    }
}

if (manager.includes("const LOOP_INTERVAL")) {
    fail(
        "the generated crawler still contains the old permanent polling loop."
    );
}
if (!snapshot.includes("counts.agents > MAX_CRAWL_STACK")) {
    fail("the snapshot does not detect a crawler stack cap violation.");
}

if (!updater.includes('"darknet-snapshot.js"')) {
    fail("the updater does not install darknet-snapshot.js.");
}
if (!snapshot.includes("unauthorizedPhishHosts")) {
    fail("the snapshot does not detect phishing outside the manager plan.");
}

console.log(
    `Runtime safety check OK (runtime ${managerVersion}; serialized crawler, bounded phishing/auth, singleton, diagnostics, and cleanup guards present).`
);

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
const phishWorkerVersion = manager.match(
    /const PHISH_WORKER_VERSION = "([^"]+)";/
)?.[1];
const cleanupVersion = cleanup.match(/const VERSION = "([^"]+)";/)?.[1];
const snapshotVersion = snapshot.match(/const VERSION = "([^"]+)";/)?.[1];
if (
    !managerVersion ||
    managerVersion !== agentVersion ||
    managerVersion !== phishWorkerVersion ||
    managerVersion !== cleanupVersion ||
    managerVersion !== snapshotVersion
) {
    fail(
        `runtime versions differ (manager=${managerVersion ?? "missing"}, agent=${agentVersion ?? "missing"}, phishing=${phishWorkerVersion ?? "missing"}, cleanup=${cleanupVersion ?? "missing"}, snapshot=${snapshotVersion ?? "missing"}).`
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
if (!cleanup.includes('const COMPLETION_PREFIX = "/Temp/dnet-complete-";')) {
    fail("cleanup does not remove orphaned crawler completion signals.");
}
if (
    !cleanup.includes(
        'const PHISH_HEARTBEAT_PREFIX = "/Temp/dnet-phish-heartbeat-";'
    )
) {
    fail("cleanup does not remove phishing heartbeat files.");
}

for (const required of [
    "const OFFICIAL_MAX_STASIS_LINKS = 4;",
    "const OFFICIAL_MAX_NET_DEPTH = 40;",
    "const CRAWL_DEPTH_STEP = 8;",
    "const MIN_RESCAN_QUIET_MS = 30000;",
    "getConfiguredPhishHosts()",
    "linkedHosts.has(report.host)",
    "const threads = Math.floor(free / scriptRam);",
    "const stagger = hostHash(host) % 200;",
    "await ns.dnet.phishingAttack();",
    "void ns.dnet",
    ".nextMutation()",
    "const MAX_BRUTE_ATTEMPTS = 100;",
    'const VISIT_MARKER = "/Temp/dnet-crawl-marker.txt";',
    "crawlDepthLimit",
    "const MAX_CRAWL_STACK = OFFICIAL_MAX_NET_DEPTH + 1;",
    'const COMPLETION_PREFIX = "/Temp/dnet-complete-";',
    "const MAX_CHILD_WAIT_MS = 900000;",
    "const MAX_COMPLETION_SIGNAL_ATTEMPTS = 60;",
    'const PHISH_HEARTBEAT_PREFIX = "/Temp/dnet-phish-heartbeat-";',
    'const HEARTBEAT_PREFIX = "/Temp/dnet-phish-heartbeat-";',
    "const PHISH_WORKER_VERSION =",
    'await publishHeartbeat("running", plan);',
    "charismaXpEarned: charismaXpEarned",
    "workerId: workerId",
    'ns.exec(PHISH, host, threads, "managed", threads);',
    "const phishHeartbeats = readPhishHeartbeats();",
    'phishTelemetry: "manager-session worker-heartbeat deltas"',
    "passwordAuthCallsReported: passwordAuthCalls",
    "return await waitForChild(target, childPid, completionFile);",
    "await signalParentCompletion();",
    "await seedDarkweb(reports);",
    'ns.exec(PHISH_LAUNCHER, host, 1, "manager-plan");',
    '" descendant stack agent(s) before another crawl."',
    'phase = "complete";',
]) {
    if (!manager.includes(required)) {
        fail(`bounded runtime guard is missing ${required}.`);
    }
}

const childWaitStart = manager.indexOf("async function waitForChild(");
const childDeployStart = manager.indexOf("async function deployChild(");
const childWaitSource = manager.slice(childWaitStart, childDeployStart);
if (childWaitStart < 0 || childDeployStart < 0) {
    fail("the generated crawler is missing child completion coordination.");
}
if (childWaitSource.includes("ns.ps(target)")) {
    fail("child completion still relies on unreliable remote ps() polling.");
}
for (const required of [
    'ns.fileExists(completionFile, "home")',
    "await maybeToggleStasis();",
    "ensurePhishing();",
]) {
    if (!childWaitSource.includes(required)) {
        fail(`child waiting does not service or verify ${required}.`);
    }
}

if (manager.includes("const LOOP_INTERVAL")) {
    fail(
        "the generated crawler still contains the old permanent polling loop."
    );
}
const summaryStart = manager.indexOf("async function summary(");
const managerStart = manager.indexOf("await enforceSingleManager();");
const summarySource = manager.slice(summaryStart, managerStart);
if (summaryStart < 0 || managerStart < 0) {
    fail("the manager summary source could not be isolated.");
}
if (summarySource.includes("ns.ps(host)")) {
    fail("phishing summary still relies on unreliable remote ps() polling.");
}
if (!snapshot.includes("counts.agents > liveCrawlStackLimit")) {
    fail("the snapshot does not detect a crawler stack cap violation.");
}
if (!snapshot.includes('warnings.push("overlapping crawler generations")')) {
    fail("the snapshot does not detect overlapping crawler generations.");
}
if (!snapshot.includes("freshPhishHeartbeats")) {
    fail("the snapshot does not report worker phishing heartbeats.");
}
if (
    !snapshot.includes("heartbeatPhishCharismaXp") ||
    !snapshot.includes("passwordAuthCalls")
) {
    fail(
        "the snapshot does not separate phishing XP from password auth calls."
    );
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

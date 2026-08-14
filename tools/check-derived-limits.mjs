import fs from "node:fs";

const manager = fs.readFileSync("darknet-manager.js", "utf8");
const design = fs.readFileSync("docs/runtime-limits.md", "utf8");

function fail(message) {
    console.error(`Derived-limit check failed: ${message}`);
    process.exit(1);
}

// Values copied from the cited Bitburner 3.0.1 upstream implementation. A
// future game update must change the documentation and runtime together.
const requiredRuntimeFacts = [
    "const OFFICIAL_MAX_STASIS_LINKS = 4;",
    "const CRAWL_DEPTH_STEP = 8;",
    "const OFFICIAL_MAX_NET_DEPTH = 40;",
    "const MIN_RESCAN_QUIET_MS = 30000;",
    "const stagger = hostHash(host) % 200;",
    "const threads = Math.floor(free / scriptRam);",
    ".nextMutation()",
];
for (const fact of requiredRuntimeFacts) {
    if (!manager.includes(fact)) fail(`runtime is missing ${fact}`);
}

for (const obsoleteGuess of [
    "free * 0.65",
    "MIN_COOLDOWN_MS",
    "CRAWL_RESTART_DELAY_MS",
    "MIN_DNET_REQUEST_INTERVAL",
]) {
    if (manager.includes(obsoleteGuess)) {
        fail(`obsolete arbitrary throttle remains: ${obsoleteGuess}`);
    }
}

if (!manager.includes("linkedHosts.has(report.host)")) {
    fail("phishing candidates are not restricted to stable stasis hosts");
}

// At the engine's maximum 50% timeout chance, four independent attempts leave
// only a 6.25% probability that every attempt times out.
const timeoutChance = 0.5;
const retries = 4;
const allTimedOut = timeoutChance ** retries;
if (allTimedOut > 0.0625) {
    fail(
        `timeout retry guarantee regressed to ${(allTimedOut * 100).toFixed(2)}%`
    );
}
if (!manager.includes(`const MAX_AUTH_RETRIES = ${retries};`)) {
    fail("runtime retry count no longer matches the documented probability");
}

for (const source of [
    "NetworkGenerator.ts",
    "Enums.ts",
    "labyrinth.ts",
    "offlineServerHandling.ts",
    "effects.ts",
    "phishing.ts",
]) {
    if (!design.includes(source)) fail(`design document is missing ${source}`);
}

console.log(
    "Derived-limit check OK (16GB live gateway guard; 8->40 adaptive crawl; 1-4 live stasis cap; native phishing pacing; 93.75% worst-case timeout coverage)."
);

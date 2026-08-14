import fs from "node:fs";

const source = fs.readFileSync("darknet-manager.js", "utf8");

function extractWorker(name) {
    const pattern = new RegExp(
        "const\\s+" + name + "\\s*=\\s*String\\.raw`([\\s\\S]*?)`;"
    );
    const match = source.match(pattern);
    if (!match) throw new Error(`Could not extract ${name}`);
    return match[1];
}

function buildMain(name) {
    const code = extractWorker(name).replace(
        "export async function main",
        "async function main"
    );
    return new Function(`${code}; return main;`)();
}

function fail(message) {
    console.error(`Phishing bound check failed: ${message}`);
    process.exit(1);
}

const phishMain = buildMain("PHISH_SOURCE");

async function simulatePhish(desired) {
    const attacks = [];
    const sleeps = [];
    const files = new Map();
    const heartbeats = [];
    const ns = {
        args: ["managed", 20],
        pid: 123,
        disableLog: () => {},
        getHostname: () => "alpha",
        getPlayer: () => ({ mults: { charisma_exp: 2 } }),
        read: () =>
            JSON.stringify({
                desired: attacks.length >= 3 ? [] : desired,
                maxHosts: 4,
                ts: Date.now(),
            }),
        write: async (filename, data) => {
            files.set(String(filename), String(data));
            return true;
        },
        scp: async (filename) => {
            const raw = files.get(String(filename));
            if (raw) heartbeats.push(JSON.parse(raw));
            return true;
        },
        dnet: {
            phishingAttack: async () => {
                attacks.push(Date.now());
                return { success: attacks.length % 2 === 1 };
            },
        },
        sleep: async (ms) => {
            sleeps.push(ms);
            if (sleeps.length >= 4) throw new Error("simulation complete");
        },
    };
    await phishMain(ns);
    return { attacks, sleeps, heartbeats };
}

const authorized = await simulatePhish(["alpha"]);
if (authorized.attacks.length !== 3) {
    fail(
        `authorized worker made ${authorized.attacks.length} simulated attacks`
    );
}
if (authorized.sleeps.length !== 1 || authorized.sleeps[0] >= 200) {
    fail("worker did not use exactly one engine-minimum-window start stagger");
}
const runningHeartbeat = authorized.heartbeats.find(
    (heartbeat) => heartbeat.state === "running"
);
if (!runningHeartbeat) fail("authorized worker sent no running heartbeat");
if (runningHeartbeat.version !== "1.3.0") {
    fail(`worker heartbeat version was ${runningHeartbeat.version}`);
}
if (Number(runningHeartbeat.threads) !== 20) {
    fail(`worker heartbeat reported ${runningHeartbeat.threads} threads`);
}
if (Number(runningHeartbeat.attackCycles) < 1) {
    fail("worker heartbeat reported no completed attack cycles");
}
if (Number(runningHeartbeat.charismaXpEarned) !== 2000) {
    fail(
        `worker heartbeat reported ${runningHeartbeat.charismaXpEarned} CHA XP instead of 2000`
    );
}

const unauthorized = await simulatePhish([]);
if (unauthorized.attacks.length !== 0) {
    fail("worker attacked without manager authorization");
}
if (
    !unauthorized.heartbeats.some((heartbeat) => heartbeat.state === "stopped")
) {
    fail("unauthorized worker sent no stopped heartbeat");
}

const oversized = await simulatePhish(["alpha", "b", "c", "d", "e"]);
if (oversized.attacks.length !== 0) {
    fail("worker accepted a plan above the four-host hard cap");
}

const launcherMain = buildMain("PHISH_LAUNCHER_SOURCE");

async function simulateLauncher(desired) {
    const executions = [];
    const plan = JSON.stringify({ desired, maxHosts: 4, ts: Date.now() });
    const ns = {
        disableLog: () => {},
        getHostname: () => "alpha",
        read: () => plan,
        ps: () => [],
        getScriptRam: () => 2,
        getServerMaxRam: () => 64,
        getServerUsedRam: () => 0,
        exec: (...args) => {
            executions.push(args);
            return 1;
        },
    };
    await launcherMain(ns);
    return executions;
}

const authorizedLaunches = await simulateLauncher(["alpha"]);
if (authorizedLaunches.length !== 1) {
    fail("authorized launcher did not start exactly one worker");
}
if (Number(authorizedLaunches[0][2]) !== 32) {
    fail(`launcher selected ${authorizedLaunches[0][2]} threads instead of 32`);
}
if (Number(authorizedLaunches[0][4]) !== 32) {
    fail("launcher did not pass the selected thread count to telemetry");
}
if ((await simulateLauncher([])).length !== 0) {
    fail("launcher ran without manager authorization");
}
if ((await simulateLauncher(["alpha", "b", "c", "d", "e"])).length !== 0) {
    fail("launcher accepted a plan above the hard cap");
}

console.log(
    "Phishing efficiency check OK (stasis ceiling, native action pacing, full free-RAM packing, unique telemetry)."
);

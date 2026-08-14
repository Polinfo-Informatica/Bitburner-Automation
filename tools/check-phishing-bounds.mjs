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
    const plan = JSON.stringify({ desired, ts: Date.now() });
    const ns = {
        disableLog: () => {},
        getHostname: () => "alpha",
        read: () => plan,
        dnet: {
            phishingAttack: async () => {
                attacks.push(Date.now());
            },
        },
        sleep: async (ms) => {
            sleeps.push(ms);
            if (sleeps.length >= 4) throw new Error("simulation complete");
        },
    };
    await phishMain(ns);
    return { attacks, sleeps };
}

const authorized = await simulatePhish(["alpha"]);
if (authorized.attacks.length !== 3) {
    fail(
        `authorized worker made ${authorized.attacks.length} simulated attacks`
    );
}
for (const cooldown of authorized.sleeps.slice(1)) {
    if (cooldown < 5000) fail(`post-attack cooldown was only ${cooldown} ms`);
}

const unauthorized = await simulatePhish([]);
if (unauthorized.attacks.length !== 0) {
    fail("worker attacked without manager authorization");
}

const oversized = await simulatePhish(["alpha", "b", "c", "d", "e"]);
if (oversized.attacks.length !== 0) {
    fail("worker accepted a plan above the four-host hard cap");
}

const launcherMain = buildMain("PHISH_LAUNCHER_SOURCE");

async function simulateLauncher(desired) {
    const executions = [];
    const plan = JSON.stringify({ desired, ts: Date.now() });
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
if (Number(authorizedLaunches[0][2]) !== 20) {
    fail(`launcher selected ${authorizedLaunches[0][2]} threads instead of 20`);
}
if ((await simulateLauncher([])).length !== 0) {
    fail("launcher ran without manager authorization");
}
if ((await simulateLauncher(["alpha", "b", "c", "d", "e"])).length !== 0) {
    fail("launcher accepted a plan above the hard cap");
}

console.log(
    "Phishing bound check OK (four-host authorization cap; 5s minimum cooldown)."
);

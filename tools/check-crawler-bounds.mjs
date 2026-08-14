import fs from "node:fs";

const manager = fs.readFileSync("darknet-manager.js", "utf8");
const match = manager.match(
    /const AGENT_SOURCE = String\.raw`([\s\S]*?)`;\r?\n\r?\n {4}function log\(/
);
if (!match) throw new Error("Could not extract AGENT_SOURCE");

const executableSource = match[1].replace(
    "export async function main(ns)",
    "async function main(ns)"
);
const agentMain = new Function(`${executableSource}; return main;`)();

const AGENT = "/Temp/dnet-agent.js";
const VISIT_MARKER = "/Temp/dnet-crawl-marker.txt";
const PLAN = "/Temp/dnet-stasis-plan.txt";
const PHISH_PLAN = "/Temp/dnet-phish-plan.txt";
const DB_FILE = "darknet-passwords.txt";
const VERSION = "1.2.0";
const CRAWL_ID = "crawler-bound-test";
const GRAPH = {
    darkweb: ["alpha", "beta"],
    alpha: ["darkweb", "gamma", "delta"],
    beta: ["darkweb", "epsilon", "delta"],
    gamma: ["alpha", "epsilon"],
    delta: ["alpha", "beta"],
    epsilon: ["gamma", "beta"],
};

/** @type {Map<string, Map<string, string>>} */
const hostFiles = new Map();
/** @type {Map<string, Map<number, {filename: string, pid: number, threads: number, args: unknown[], promise?: Promise<void>}>>} */
const hostProcesses = new Map();
const spawnCounts = new Map();
let nextPid = 1000;
let authInFlight = 0;
let maxAuthInFlight = 0;
let maxAgentProcesses = 0;

function filesFor(host) {
    if (!hostFiles.has(host)) hostFiles.set(host, new Map());
    return hostFiles.get(host);
}

function processesFor(host) {
    if (!hostProcesses.has(host)) hostProcesses.set(host, new Map());
    return hostProcesses.get(host);
}

function countAgents() {
    let count = 0;
    for (const processes of hostProcesses.values()) count += processes.size;
    return count;
}

function createNs(host, pid, args) {
    return {
        args,
        pid,
        disableLog() {},
        getHostname() {
            return host;
        },
        read(filename) {
            return filesFor(host).get(String(filename)) || "";
        },
        async write(filename, data) {
            filesFor(host).set(String(filename), String(data));
            return true;
        },
        fileExists(filename, target = host) {
            return filesFor(String(target)).has(String(filename));
        },
        async scp(fileOrFiles, destination, source = host) {
            const names = Array.isArray(fileOrFiles)
                ? fileOrFiles
                : [fileOrFiles];
            let copiedAll = true;
            for (const filename of names) {
                const value = filesFor(String(source)).get(String(filename));
                if (value === undefined) {
                    copiedAll = false;
                    continue;
                }
                filesFor(String(destination)).set(String(filename), value);
            }
            await Promise.resolve();
            return copiedAll;
        },
        ps(target = host) {
            return Array.from(processesFor(String(target)).values()).map(
                (process) => ({
                    filename: process.filename,
                    pid: process.pid,
                    threads: process.threads,
                    args: process.args.slice(),
                })
            );
        },
        exec(filename, target, threads, ...childArgs) {
            if (filename !== AGENT) return 0;
            return spawnAgent(String(target), Number(threads), childArgs);
        },
        kill(targetPid) {
            for (const processes of hostProcesses.values()) {
                if (processes.delete(Number(targetPid))) return true;
            }
            return false;
        },
        async sleep() {
            await new Promise((resolve) => setTimeout(resolve, 0));
        },
        ls(target = host, filter = "") {
            return Array.from(filesFor(String(target)).keys()).filter((name) =>
                name.includes(String(filter))
            );
        },
        rm(filename, target = host) {
            return filesFor(String(target)).delete(String(filename));
        },
        getPlayer() {
            return { skills: { charisma: 500 } };
        },
        getServerMaxRam() {
            return 1024;
        },
        getServerUsedRam() {
            return 0;
        },
        getScriptRam() {
            return 1;
        },
        dnet: {
            probe() {
                return (GRAPH[host] || []).slice();
            },
            getServerDetails(target = host) {
                return {
                    hostname: String(target),
                    blockedRam: 0,
                    depth: 1,
                    difficulty: 1,
                    modelId: "FreshInstall_1.0",
                    requiredCharismaSkill: 0,
                    isStationary: false,
                    passwordLength: 5,
                    passwordFormat: "alphabetic",
                };
            },
            async authenticate(target, password) {
                if (!(GRAPH[host] || []).includes(String(target))) {
                    throw new Error(`${host} cannot authenticate ${target}`);
                }
                authInFlight++;
                maxAuthInFlight = Math.max(maxAuthInFlight, authInFlight);
                await new Promise((resolve) => setTimeout(resolve, 0));
                authInFlight--;
                return {
                    success:
                        String(target) === "darkweb"
                            ? String(password) === ""
                            : String(password) === "admin",
                    code: 200,
                };
            },
            async heartbleed() {
                return { success: false, logs: [] };
            },
            getBlockedRam() {
                return 0;
            },
            getStasisLinkedServers() {
                return [];
            },
        },
    };
}

function spawnAgent(host, threads, args) {
    const pid = nextPid++;
    const process = {
        filename: AGENT,
        pid,
        threads,
        args,
        promise: undefined,
    };
    processesFor(host).set(pid, process);
    spawnCounts.set(host, Number(spawnCounts.get(host) || 0) + 1);
    maxAgentProcesses = Math.max(maxAgentProcesses, countAgents());
    process.promise = Promise.resolve()
        .then(() => agentMain(createNs(host, pid, args)))
        .finally(() => {
            processesFor(host).delete(pid);
        });
    return pid;
}

const workerFiles = [
    AGENT,
    "/Temp/dnet-phish.js",
    "/Temp/dnet-phish-launcher.js",
    "/Temp/dnet-ram-launcher.js",
    "/Temp/dnet-ram-worker.js",
    "/Temp/dnet-stasis.js",
    "/Temp/dnet-loot.js",
];
for (const filename of workerFiles) filesFor("darkweb").set(filename, "test");
filesFor("darkweb").set(PLAN, JSON.stringify({ desired: [], ts: Date.now() }));
filesFor("darkweb").set(
    PHISH_PLAN,
    JSON.stringify({ desired: [], ts: Date.now(), maxHosts: 0 })
);
filesFor("darkweb").set(DB_FILE, "{}");
filesFor("darkweb").set(VISIT_MARKER, CRAWL_ID);

const rootPid = spawnAgent("darkweb", 1, ["", VERSION, CRAWL_ID, 0]);
const rootProcess = processesFor("darkweb").get(rootPid);
await rootProcess.promise;

for (const host of Object.keys(GRAPH)) {
    if (spawnCounts.get(host) !== 1) {
        throw new Error(
            `${host} spawned ${spawnCounts.get(host) || 0} times; visit markers did not prevent cycles`
        );
    }
}
if (maxAuthInFlight !== 1) {
    throw new Error(
        `expected one advancing authentication branch, observed ${maxAuthInFlight}`
    );
}
if (maxAgentProcesses > 17) {
    throw new Error(`crawler stack exceeded hard cap: ${maxAgentProcesses}`);
}
if (countAgents() !== 0) {
    throw new Error("one-shot crawler agents did not exit after traversal");
}

const reports = Array.from(filesFor("home").entries())
    .filter(([filename]) => filename.startsWith("/Temp/dnet-report-"))
    .map(([, contents]) => JSON.parse(contents));
if (
    reports.length !== Object.keys(GRAPH).length ||
    reports.some((report) => !report.completed || report.phase !== "complete")
) {
    throw new Error("not every discovered host produced a completed report");
}

console.log(
    `Crawler bound check OK (${reports.length} cyclic-graph hosts visited once; max stack ${maxAgentProcesses}; max concurrent auth ${maxAuthInFlight}).`
);

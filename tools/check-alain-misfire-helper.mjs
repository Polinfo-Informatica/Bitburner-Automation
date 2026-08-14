import fs from "node:fs";

const source = fs.readFileSync("alain-silence-misfires.js", "utf8");
const updater = fs.readFileSync("dnet-git-pull.js", "utf8");
const executableSource = source.replace(
    "export async function main(ns)",
    "async function main(ns)"
);
const helperMain = new Function(`${executableSource}; return main;`)();

function fail(message) {
    console.error(`Alain misfire helper check failed: ${message}`);
    process.exit(1);
}

if (!updater.includes('"alain-silence-misfires.js"')) {
    fail("dnet-git-pull.js does not install the helper");
}

async function simulate({ config = "", autopilot = false, daemon = true }) {
    const files = new Map([["daemon.js.config.txt", config]]);
    const processes = new Map();
    const killed = [];
    const executions = [];
    const messages = [];

    if (autopilot) {
        processes.set(10, {
            filename: "autopilot.js",
            pid: 10,
            threads: 1,
            args: [],
        });
    }
    if (daemon) {
        processes.set(20, {
            filename: "daemon.js",
            pid: 20,
            threads: 1,
            args: ["--reserved-ram", 128],
        });
    }

    const ns = {
        disableLog() {},
        getHostname: () => "home",
        getScriptName: () => "alain-silence-misfires.js",
        read: (file) => files.get(String(file)) || "",
        write: async (file, contents) => {
            files.set(String(file), String(contents));
            return true;
        },
        ps: () => Array.from(processes.values()),
        kill: (pid) => {
            killed.push(Number(pid));
            return processes.delete(Number(pid));
        },
        sleep: async () => {},
        fileExists: (file) => String(file) === "daemon.js",
        exec: (...args) => {
            executions.push(args);
            return 99;
        },
        tprint: (message) => messages.push(String(message)),
    };

    await helperMain(ns);
    return { files, processes, killed, executions, messages };
}

const withAutopilot = await simulate({
    config: JSON.stringify({ "reserved-ram": 256 }),
    autopilot: true,
});
const mergedObject = JSON.parse(
    withAutopilot.files.get("daemon.js.config.txt")
);
if (
    mergedObject["reserved-ram"] !== 256 ||
    mergedObject["silent-misfires"] !== true
) {
    fail("object configuration was not merged safely");
}
if (
    !withAutopilot.killed.includes(20) ||
    withAutopilot.killed.includes(10) ||
    withAutopilot.executions.length !== 0 ||
    !withAutopilot.processes.has(10)
) {
    fail("autopilot scenario did not stop only daemon.js");
}

const withoutAutopilot = await simulate({
    config: JSON.stringify([["reserved-ram", 512]]),
});
const mergedArray = JSON.parse(
    withoutAutopilot.files.get("daemon.js.config.txt")
);
if (
    mergedArray["reserved-ram"] !== 512 ||
    mergedArray["silent-misfires"] !== true
) {
    fail("array-entry configuration was not preserved");
}
if (
    withoutAutopilot.executions.length !== 1 ||
    withoutAutopilot.executions[0][0] !== "daemon.js" ||
    !withoutAutopilot.executions[0].includes("--silent-misfires") ||
    !withoutAutopilot.executions[0].includes("--reserved-ram")
) {
    fail("standalone daemon was not restarted with preserved arguments");
}

const invalid = await simulate({ config: "{not-json", autopilot: true });
if (
    invalid.killed.length !== 0 ||
    invalid.executions.length !== 0 ||
    invalid.files.get("daemon.js.config.txt") !== "{not-json"
) {
    fail("invalid existing configuration was overwritten or processes changed");
}

const noDaemon = await simulate({ daemon: false });
if (
    JSON.parse(noDaemon.files.get("daemon.js.config.txt"))[
        "silent-misfires"
    ] !== true ||
    noDaemon.killed.length !== 0 ||
    noDaemon.executions.length !== 0
) {
    fail("no-daemon scenario did not stop after persisting the option");
}

console.log(
    "Alain misfire helper check OK (persistent config merge, guarded restart, autopilot preserved)."
);

import fs from "node:fs";

const manager = fs.readFileSync("darknet-manager.js", "utf8");
const cleanup = fs.readFileSync("darknet-cleanup.js", "utf8");

function fail(message) {
    console.error(`Runtime safety check failed: ${message}`);
    process.exit(1);
}

const managerVersion = manager.match(/const VERSION = "([^"]+)";/)?.[1];
const agentVersion = manager.match(/const AGENT_VERSION = "([^"]+)";/)?.[1];
if (!managerVersion || managerVersion !== agentVersion) {
    fail(
        `manager version (${managerVersion ?? "missing"}) does not match generated agent version (${agentVersion ?? "missing"}).`
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
    "for (const [host, password] of targets)"
);
if (!cleanup.includes('const MANAGER = "darknet-manager.js";')) {
    fail("darknet-cleanup.js does not identify the manager filename.");
}
if (managerKill < 0 || workerCleanup < 0 || managerKill > workerCleanup) {
    fail("cleanup must stop old managers before cleaning remote workers.");
}

console.log(
    `Runtime safety check OK (manager/agent ${managerVersion}; singleton and cleanup guards present).`
);

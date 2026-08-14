import fs from "node:fs";
const dts = fs.readFileSync("types/NetscriptDefinitions.d.ts", "utf8");
const source = fs.readFileSync("darknet-manager.js", "utf8");
const agentSource = source.match(
    /const AGENT_SOURCE = String\.raw`([\s\S]*?)`;\r?\n\r?\n {4}function log\(/
)?.[1];
if (!agentSource) {
    console.error("Could not extract the generated Dark Net crawler.");
    process.exit(1);
}
const apiNames = new Set(
    [...dts.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)].map(
        (m) => m[1]
    )
);
const localFunctions = new Set(
    [
        ...source.matchAll(
            /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g
        ),
    ].map((m) => m[1])
);
const localBindings = new Set(localFunctions);

for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g
)) {
    localBindings.add(match[1]);
}

function addParameters(rawParameters) {
    for (const parameter of rawParameters.split(",")) {
        const match = parameter
            .trim()
            .match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)\b/);
        if (match) localBindings.add(match[1]);
    }
}

for (const match of source.matchAll(
    /\b(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g
)) {
    addParameters(match[1]);
}
for (const match of source.matchAll(/\(([^()]*)\)\s*=>/g)) {
    addParameters(match[1]);
}
for (const match of source.matchAll(
    /\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/g
)) {
    localBindings.add(match[1]);
}
for (const match of source.matchAll(
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g
)) {
    localBindings.add(match[1]);
}

const collisions = [...localBindings]
    .filter((name) => apiNames.has(name))
    .sort();
if (collisions.length) {
    console.error("Bitburner RAM local-binding collisions:");
    for (const name of collisions) console.error(`  - ${name}`);
    process.exit(1);
}

// Bitburner v3.0.1 RamCostGenerator values for every API used by AGENT_SOURCE.
// Keeping this explicit makes a new API fail CI until its gateway cost is reviewed.
const gatewayLimit = 16;
const agentApiCosts = new Map([
    ["disableLog", 0],
    ["dnet.authenticate", 0.4],
    ["dnet.getBlockedRam", 0],
    ["dnet.getServerDetails", 0.1],
    ["dnet.getStasisLinkedServers", 0],
    ["dnet.heartbleed", 0.6],
    ["dnet.probe", 0.2],
    ["exec", 1.3],
    ["exit", 0],
    ["fileExists", 0.1],
    ["getHostname", 0.05],
    ["kill", 0.5],
    ["ps", 0.2],
    ["read", 0],
    ["rm", 0.6],
    ["scp", 0.6],
    ["sleep", 0],
    ["write", 0],
]);
const agentCalls = new Set(
    [
        ...agentSource.matchAll(
            /\bns\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g
        ),
    ].map((match) => match[1])
);
const unknownAgentCalls = [...agentCalls]
    .filter((name) => !agentApiCosts.has(name))
    .sort();
if (unknownAgentCalls.length) {
    console.error("Unreviewed generated-crawler RAM APIs:");
    for (const name of unknownAgentCalls) console.error(`  - ns.${name}()`);
    process.exit(1);
}
const predictedAgentRam = [...agentCalls].reduce(
    (total, name) => total + agentApiCosts.get(name),
    1.6
);
if (predictedAgentRam > gatewayLimit) {
    console.error(
        `Generated crawler RAM ${predictedAgentRam.toFixed(2)}GB exceeds the ${gatewayLimit}GB darkweb gateway.`
    );
    process.exit(1);
}
console.log(
    `RAM safety check OK (${localBindings.size} local bindings vs ${apiNames.size} API names; predicted crawler ${predictedAgentRam.toFixed(2)}GB/${gatewayLimit}GB)`
);

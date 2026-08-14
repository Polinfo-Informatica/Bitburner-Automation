/** @type {[string, string | number | boolean | string[]][]} */
const ARGS_SCHEMA = [
    ["no-phish", false],
    ["phish-hosts", 4],
    ["help", false],
];

export function autocomplete(data) {
    data.flags(ARGS_SCHEMA);
    return [];
}

/**
 * darknet-manager.js
 * Bitburner 3.0.1 Dark Net automation
 *
 * Designed to run as a long-lived helper under alainbryden/bitburner-scripts.
 * Paste only this file. It generates its own remote workers under /Temp.
 *
 * Goals:
 *   - probe and recursively explore the Dark Net
 *   - automatically solve/guess many v3.0.1 authentication models
 *   - preserve discovered credentials on home
 *   - fully reallocate blocked RAM before using a server
 *   - open every .cache found
 *   - copy discovered files back to home
 *   - use spare Dark Net RAM for phishing (charisma + money + cache chances)
 *   - keep the best recently-accessible, highest-RAM servers in stasis
 *   - recover automatically from Dark Net mutations/restarts
 *
 * @param {NS} ns
 */
export async function main(ns) {
    try {
        ns.disableLog("ALL");
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    const VERSION = "1.2.3";

    const AGENT = "/Temp/dnet-agent.js";
    const PHISH = "/Temp/dnet-phish.js";
    const PHISH_LAUNCHER = "/Temp/dnet-phish-launcher.js";
    const RAM_LAUNCHER = "/Temp/dnet-ram-launcher.js";
    const RAM_WORKER = "/Temp/dnet-ram-worker.js";
    const STASIS = "/Temp/dnet-stasis.js";
    const LOOT = "/Temp/dnet-loot.js";
    const PLAN = "/Temp/dnet-stasis-plan.txt";
    const PHISH_PLAN = "/Temp/dnet-phish-plan.txt";
    const DB_FILE = "darknet-passwords.txt";
    const REPORT_PREFIX = "/Temp/dnet-report-";
    const PHISH_HEARTBEAT_PREFIX = "/Temp/dnet-phish-heartbeat-";
    const STATUS_FILE = "darknet-runtime-status.txt";
    const VISIT_MARKER = "/Temp/dnet-crawl-marker.txt";

    const REPORT_FRESH_MS = 180000;
    const REPORT_RETENTION_MS = 600000;
    const STASIS_REFRESH_MS = 30000;
    const STASIS_REPUSH_MS = 300000;
    const PHISH_REFRESH_MS = 15000;
    const PHISH_REPUSH_MS = 45000;
    const PHISH_HEARTBEAT_FRESH_MS = 45000;
    const PHISH_HEARTBEAT_RETENTION_MS = 300000;
    const PHISH_HOST_HARD_LIMIT = 4;
    const MAX_CRAWL_DEPTH = 16;
    const MAX_CRAWL_STACK = MAX_CRAWL_DEPTH + 1;
    const CRAWL_RESTART_DELAY_MS = 120000;
    const SUMMARY_INTERVAL_MS = 30000;
    const WORKER_REFRESH_MS = 300000;

    const options = ns.flags(ARGS_SCHEMA);
    if (options.help) {
        ns.tprint("Bitburner Dark Net manager v" + VERSION);
        ns.tprint(
            "Usage: run darknet-manager.js [--no-phish] [--phish-hosts 0-4]"
        );
        ns.tprint(
            "Phishing is capped at four manager-selected hosts and is rate-limited."
        );
        return;
    }
    const requestedPhishHosts = Number(options["phish-hosts"]);
    const configuredPhishHosts = options["no-phish"]
        ? 0
        : Math.max(
              0,
              Math.min(
                  PHISH_HOST_HARD_LIMIT,
                  Number.isFinite(requestedPhishHosts)
                      ? Math.floor(requestedPhishHosts)
                      : PHISH_HOST_HARD_LIMIT
              )
          );

    // Keep all generated-worker code free of template literals so it can live safely
    // inside these String.raw blocks.
    const PHISH_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    try { ns.disableLog("ALL"); } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    const PLAN = "/Temp/dnet-phish-plan.txt";
    const HEARTBEAT_PREFIX = "/Temp/dnet-phish-heartbeat-";
    const host = ns.getHostname();
    const PHISH_WORKER_VERSION = "1.2.3";
    const MAX_PLAN_AGE_MS = 90000;
    const MIN_COOLDOWN_MS = 5000;
    const HEARTBEAT_INTERVAL_MS = 15000;
    const workerThreads = Math.max(1, Math.floor(Number(ns.args[1] || 1)));
    const startedAt = Date.now();
    let attackCycles = 0;
    let successfulAttacks = 0;
    let errorCount = 0;
    let charismaXpEarned = 0;
    let lastAttackAt = 0;
    let lastHeartbeatAt = 0;

    function hostHash(value) {
        let hash = 2166136261 >>> 0;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function readPlan() {
        try {
            const raw = ns.read(PLAN);
            if (!raw) return null;
            const plan = JSON.parse(raw);
            if (!plan || !Array.isArray(plan.desired)) return null;
            if (plan.desired.length > 4) return null;
            if (Date.now() - Number(plan.ts || 0) > MAX_PLAN_AGE_MS) return null;
            return plan;
        } catch { return null; }
    }

    function isAllowed(plan) {
        return !!plan && plan.desired.includes(host);
    }

    function currentCharismaExpMultiplier() {
        try {
            const multiplier = Number(ns.getPlayer().mults.charisma_exp);
            return Number.isFinite(multiplier) && multiplier >= 0
                ? multiplier
                : 1;
        } catch {
            return 1;
        }
    }

    async function publishHeartbeat(state, plan) {
        try {
            const file = HEARTBEAT_PREFIX + hostHash(host).toString(16) + ".txt";
            await ns.write(
                file,
                JSON.stringify({
                    version: PHISH_WORKER_VERSION,
                    ts: Date.now(),
                    host: host,
                    threads: workerThreads,
                    state: state,
                    attackCycles: attackCycles,
                    successfulAttacks: successfulAttacks,
                    errorCount: errorCount,
                    charismaXpEarned: charismaXpEarned,
                    lastAttackAt: lastAttackAt,
                    startedAt: startedAt,
                    planTs: Number(plan && plan.ts || 0)
                }),
                "w"
            );
            if (await ns.scp(file, "home", host)) lastHeartbeatAt = Date.now();
        } catch {
            // Intentionally ignored: the next heartbeat retries automatically.
        }
    }

    const stagger = 750 + (hostHash(host) % 4250);
    const cooldown = MIN_COOLDOWN_MS + (hostHash(host + ":cooldown") % 3000);
    let plan = readPlan();
    if (!isAllowed(plan)) {
        await publishHeartbeat("stopped", plan);
        return;
    }
    await publishHeartbeat("starting", plan);
    await ns.sleep(stagger);

    for (;;) {
        plan = readPlan();
        if (!isAllowed(plan)) {
            await publishHeartbeat("stopped", plan);
            return;
        }
        try {
            const result = await ns.dnet.phishingAttack();
            attackCycles++;
            lastAttackAt = Date.now();
            const succeeded = !!(result && result.success);
            if (succeeded) successfulAttacks++;
            charismaXpEarned +=
                workerThreads *
                (succeeded ? 50 : 12.5) *
                currentCharismaExpMultiplier();
        } catch {
            errorCount++;
            // Intentionally ignored: the explicit cooldown below still applies.
        }
        if (
            attackCycles === 1 ||
            Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS
        ) {
            await publishHeartbeat("running", plan);
        }
        try {
            await ns.sleep(cooldown);
        } catch {
            return;
        }
    }
}
`;

    const RAM_WORKER_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    try { ns.disableLog("ALL"); } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    let unchanged = 0;
    let lastBlocked = Number.POSITIVE_INFINITY;

    for (;;) {
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

    const RAM_LAUNCHER_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    try { ns.disableLog("ALL"); } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    const RAM_WORKER = "/Temp/dnet-ram-worker.js";
    const host = ns.getHostname();
    try {
        const blocked = ns.dnet.getBlockedRam();
        if (!(blocked > 0)) return;
        const workerRam = ns.getScriptRam(RAM_WORKER, host);
        if (!(workerRam > 0)) return;
        const freeRam = Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host));
        const maxThreads = Math.floor(freeRam / workerRam);
        if (maxThreads < 1) return;

        let selectedThreads = maxThreads;
        try {
            const details = ns.dnet.getServerDetails();
            const player = ns.getPlayer();
            let low = 1;
            let high = maxThreads;
            let best = maxThreads;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const expected = ns.formulas.dnet.getExpectedRamBlockRemoved(details, mid, player);
                if (expected >= blocked * 0.999) {
                    best = mid;
                    high = mid - 1;
                } else {
                    low = mid + 1;
                }
            }
            selectedThreads = best;
        } catch {
        // Intentionally ignored: this operation is best-effort.
    }

        ns.exec(RAM_WORKER, host, selectedThreads, "formula-selected");
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }
}
`;

    const STASIS_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    try { ns.disableLog("ALL"); } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    const shouldLink = String(ns.args[0] ?? "1") !== "0";
    try { await ns.dnet.setStasisLink(shouldLink); }
    catch {
        // Intentionally ignored: this operation is best-effort.
    }
}
`;

    const LOOT_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    try { ns.disableLog("ALL"); } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    const host = ns.getHostname();

    try {
        const caches = ns.ls(host, ".cache");
        for (const cache of caches) {
            try { ns.dnet.openCache(cache, true); }
            catch {
        // Intentionally ignored: this operation is best-effort.
    }
        }
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }

    try {
        const files = ns.ls(host).filter(function (f) {
            return !f.startsWith("/Temp/dnet-") &&
                   !f.endsWith(".cache") &&
                   f !== "darknet-passwords.txt";
        });

        for (const file of files) {
            try { await ns.scp(file, "home", host); }
            catch {
        // Intentionally ignored: this operation is best-effort.
    }

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
                } catch {
        // Intentionally ignored: this operation is best-effort.
    }
            }
        }
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }
}
`;

    const PHISH_LAUNCHER_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    try { ns.disableLog("ALL"); } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    const PHISH = "/Temp/dnet-phish.js";
    const PLAN = "/Temp/dnet-phish-plan.txt";
    const host = ns.getHostname();
    if (host === "darkweb") return;

    try {
        const raw = ns.read(PLAN);
        if (!raw) return;
        const plan = JSON.parse(raw);
        if (!plan || !Array.isArray(plan.desired)) return;
        if (plan.desired.length > 4) return;
        if (Date.now() - Number(plan.ts || 0) > 90000) return;
        if (!plan.desired.includes(host)) return;
        if (ns.ps(host).some(function (p) { return p.filename === PHISH; })) return;
        const scriptRam = ns.getScriptRam(PHISH, host);
        if (!(scriptRam > 0)) return;
        const free = Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host));
        const threads = Math.floor((free * 0.65) / scriptRam);
        if (threads > 0) ns.exec(PHISH, host, threads, "managed", threads);
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }
}
`;

    const AGENT_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    try { ns.disableLog("ALL"); } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    const AGENT = "/Temp/dnet-agent.js";
    const PHISH = "/Temp/dnet-phish.js";
    const PHISH_LAUNCHER = "/Temp/dnet-phish-launcher.js";
    const RAM_LAUNCHER = "/Temp/dnet-ram-launcher.js";
    const RAM_WORKER = "/Temp/dnet-ram-worker.js";
    const STASIS = "/Temp/dnet-stasis.js";
    const LOOT = "/Temp/dnet-loot.js";
    const PLAN = "/Temp/dnet-stasis-plan.txt";
    const PHISH_PLAN = "/Temp/dnet-phish-plan.txt";
    const DB_FILE = "darknet-passwords.txt";
    const REPORT_PREFIX = "/Temp/dnet-report-";
    const VISIT_MARKER = "/Temp/dnet-crawl-marker.txt";
    const COMPLETION_PREFIX = "/Temp/dnet-complete-";

    const host = ns.getHostname();
    const selfPassword = String(ns.args[0] ?? "");
    const AGENT_VERSION = "1.2.3";
    const crawlId = String(ns.args[2] ?? "");
    const crawlDepth = Math.max(0, Math.floor(Number(ns.args[3] || 0)));
    const parentCompletionFile = String(ns.args[4] ?? "");
    const REPORT_INTERVAL = 15000;
    const LOOT_INTERVAL = 60000;
    const CHILD_POLL_MS = 2000;
    const MAX_CHILD_WAIT_MS = 900000;
    const COMPLETION_RETRY_MS = 1000;
    const MAX_COMPLETION_SIGNAL_ATTEMPTS = 60;
    const MAX_CRAWL_DEPTH = 16;
    const MIN_DNET_REQUEST_INTERVAL = 750;
    const MAX_AUTH_RETRIES = 4;
    const MAX_BRUTE_ATTEMPTS = 100;

    const DEFAULT_PASSWORDS = ["admin", "password", "0000", "12345"];
    const DOG_NAMES = ["fido", "spot", "rover", "max"];
    const EU_COUNTRIES = [
        "Austria", "Belgium", "Bulgaria", "Croatia", "Republic of Cyprus", "Czech Republic", "Denmark",
        "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia",
        "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia",
        "Slovenia", "Spain", "Sweden"
    ];
    const COMMON_PASSWORDS = [
        "123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111", "1234567",
        "dragon", "123123", "baseball", "abc123", "football", "monkey", "letmein", "696969", "shadow",
        "master", "666666", "qwertyuiop", "123321", "mustang", "1234567890", "michael", "654321",
        "superman", "1qaz2wsx", "7777777", "121212", "0", "qazwsx", "123qwe", "trustno1", "jordan",
        "jennifer", "zxcvbnm", "asdfgh", "hunter", "buster", "soccer", "harley", "batman", "andrew",
        "tigger", "sunshine", "iloveyou", "2000", "charlie", "robert", "thomas", "hockey", "ranger",
        "daniel", "starwars", "112233", "george", "computer", "michelle", "jessica", "pepper", "1111",
        "zxcvbn", "555555", "11111111", "131313", "freedom", "777777", "pass", "maggie", "159753",
        "aaaaaa", "ginger", "princess", "joshua", "cheese", "amanda", "summer", "love", "ashley", "6969",
        "nicole", "chelsea", "biteme", "matthew", "access", "yankees", "987654321", "dallas", "austin",
        "thunder", "taylor", "matrix"
    ];
    const SMALL_PRIMES = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];
    const LARGE_PRIMES = [
        1069,1409,1471,1567,1597,1601,1697,1747,1801,1889,1979,1999,2063,2207,2371,2503,2539,
        2693,2741,2753,2801,2819,2837,2909,2939,3169,3389,3571,3761,3881,4217,4289,4547,4729,
        4789,4877,4943,4951,4957,5393,5417,5419,5441,5519,5527,5647,5779,5881,6007,6089,6133,
        6389,6451,6469,6547,6661,6719,6841,7103,7549,7559,7573,7691,7753,7867,8053,8081,8221,
        8329,8599,8677,8761,8839,8963,9103,9199,9343,9467,9551,9601,9739,9749,9859
    ];

    const foundCredentials = [];
    const cooldownUntil = new Map();
    let lastReport = 0;
    let lastLoot = 0;
    let lastDnetRequest = 0;
    let phase = "starting";
    let activeTarget = "";
    let authAttempts = 0;
    let authSuccesses = 0;
    let authFailures = 0;
    let authTimeouts = 0;
    let loopCount = 0;
    let lastProgress = Date.now();
    let selfDetails = null;
    let lastNeighbors = [];

    function hashString(s) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16).padStart(8, "0");
    }

    function reportFileFor(server) {
        return REPORT_PREFIX + hashString(server) + ".txt";
    }

    function safeProbe() {
        try { return ns.dnet.probe(); }
        catch { return []; }
    }

    function getDetails(server) {
        try { return ns.dnet.getServerDetails(server); }
        catch { return null; }
    }

    function charsetFor(format) {
        if (format === "numeric") return "0123456789";
        if (format === "alphabetic") return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    }

    function unique(arr) {
        return Array.from(new Set(arr.filter(function (v) { return v !== null && v !== undefined; }).map(String)));
    }

    function recordCredential(server, password, modelId) {
        if (!server || password === null || password === undefined) return;
        const existing = foundCredentials.find(function (x) { return x.host === server && x.password === String(password); });
        if (existing) return;
        foundCredentials.push({ host: server, password: String(password), modelId: modelId || "", ts: Date.now() });
        if (foundCredentials.length > 100) foundCredentials.shift();
    }

    function readLocalDbCandidate(server) {
        try {
            const raw = ns.read(DB_FILE);
            if (!raw) return null;
            const db = JSON.parse(raw);
            if (db && db[server] && typeof db[server].password === "string") return db[server].password;
        } catch {
        // Intentionally ignored: this operation is best-effort.
    }
        return null;
    }

    function parsePasswordResponse(line) {
        if (typeof line !== "string") return null;
        try {
            const obj = JSON.parse(line);
            if (obj && typeof obj === "object" && "passwordAttempted" in obj) return obj;
        } catch {
        // Intentionally ignored: this operation is best-effort.
    }
        return null;
    }

    function harvestRawLogCredentials(target, logs) {
        if (!Array.isArray(logs)) return;
        for (const line of logs) {
            if (typeof line !== "string") continue;
            let m = line.match(/Connecting to\s+([^:\s]+):([^\s]+)\s*\.\.\./i);
            if (m) recordCredential(m[1], m[2], "log");
            m = line.match(/Server:\s*([^\s]+)\s+Password:\s*[\"']([^\"']+)[\"']/i);
            if (m) recordCredential(m[1], m[2], "file/log");
            m = line.match(/Logging in with passcode:\s*([^\s]+)\s*\.\.\./i);
            if (m) recordCredential(target, m[1], "packet-log");
        }
    }

    async function waitForDnetSlot() {
        const wait =
            MIN_DNET_REQUEST_INTERVAL - (Date.now() - lastDnetRequest);
        if (wait > 0) await ns.sleep(wait);
        lastDnetRequest = Date.now();
    }

    async function heartbleedFeedback(target, attempted, count) {
        try {
            await waitForDnetSlot();
            phase = "heartbleed";
            activeTarget = target;
            const hb = await ns.dnet.heartbleed(target, { peek: false, logsToCapture: count || 3 });
            if (!hb || !hb.success || !Array.isArray(hb.logs)) return null;
            harvestRawLogCredentials(target, hb.logs);
            for (const line of hb.logs) {
                const obj = parsePasswordResponse(line);
                if (obj && String(obj.passwordAttempted) === String(attempted)) return obj;
            }
        } catch {
        // Intentionally ignored: this operation is best-effort.
    }
        return null;
    }

    async function tryPassword(target, password, wantFeedback) {
        password = String(password);
        let last = null;
        for (let retry = 0; retry < MAX_AUTH_RETRIES; retry++) {
            try {
                await waitForDnetSlot();
                phase = "authenticate";
                activeTarget = target;
                authAttempts++;
                if (Date.now() - lastReport >= REPORT_INTERVAL) {
                    await saveReport("");
                }
                const r = await ns.dnet.authenticate(target, password);
                lastProgress = Date.now();
                last = r;
                if (r && r.success) {
                    authSuccesses++;
                    return {
                        success: true,
                        password: password,
                        feedback: null
                    };
                }
                // 408 = Request Timeout. Retry without consuming puzzle logic.
                if (r && r.code === 408) {
                    authTimeouts++;
                    continue;
                }
                // 401 = a completed, CHA-XP-awarding wrong-password attempt.
                if (r && r.code === 401) authFailures++;
                break;
            } catch {
                return { success: false, password: password, feedback: null };
            }
        }
        const feedback = wantFeedback ? await heartbleedFeedback(target, password, 4) : null;
        return { success: false, password: password, feedback: feedback, result: last };
    }

    async function tryCandidates(target, candidates, modelId) {
        for (const candidate of unique(candidates)) {
            const r = await tryPassword(target, candidate, false);
            if (r.success) {
                recordCredential(target, candidate, modelId);
                return candidate;
            }
        }
        return null;
    }

    function localClueCandidates(target) {
        const db = readLocalDbCandidate(target);
        return db === null ? [] : [db];
    }

    function romanToInt(s) {
        const values = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };
        let total = 0;
        let prev = 0;
        s = String(s || "").toUpperCase().replace(/[^IVXLCDM]/g, "");
        for (let i = s.length - 1; i >= 0; i--) {
            const v = values[s[i]] || 0;
            if (v < prev) total -= v;
            else { total += v; prev = v; }
        }
        return total;
    }

    function largestPrimeFactor(value) {
    let n;
    try {
        n = BigInt(String(value).trim());
    } catch {
        return null;
    }
    if (n < 2n) return n.toString();

    // Bitburner v3.0.1 constructs PrimeTime 2 targets from exactly one
    // known large prime multiplied by a small number of SMALL_PRIMES.
    // Strip those small factors instead of trial-dividing every odd
    // integer up to sqrt(n), which can freeze the game's UI thread.
    let largest = 1n;
    for (const prime of SMALL_PRIMES) {
        const p = BigInt(prime);
        while (n % p === 0n) {
            largest = p;
            n /= p;
        }
    }

    // After the small factors are removed, v3.0.1 guarantees the
    // remainder is the generated large prime.
    if (n > largest) largest = n;
    return largest.toString();
}

function decodeBinary(data) {
        try {
            return String(data).trim().split(/\s+/).map(function (b) {
                return String.fromCharCode(parseInt(b, 2));
            }).join("");
        } catch { return null; }
    }

    function decodeXor(data) {
        data = String(data || "");
        const idx = data.indexOf(";");
        if (idx < 0) return null;
        const encrypted = data.slice(0, idx);
        const masks = data.slice(idx + 1).trim().split(/\s+/);
        if (masks.length < encrypted.length) return null;
        let out = "";
        for (let i = 0; i < encrypted.length; i++) {
            out += String.fromCharCode(encrypted.charCodeAt(i) ^ parseInt(masks[i], 2));
        }
        return out;
    }

    function decodeBaseN(data) {
        const parts = String(data || "").split(",");
        if (parts.length < 2) return null;
        const base = Number(parts[0]);
        const encoded = parts.slice(1).join(",").trim().toUpperCase();
        if (!(base > 1) || !encoded) return null;
        const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const dot = encoded.indexOf(".");
        const integerDigits = dot < 0 ? encoded.length : dot;
        let value = 0;
        for (let i = 0; i < encoded.length; i++) {
            if (encoded[i] === ".") continue;
            const d = chars.indexOf(encoded[i]);
            if (d < 0) return null;
            const logicalIndex = i < integerDigits ? i : i - 1;
            const power = integerDigits - logicalIndex - 1;
            value += d * Math.pow(base, power);
        }
        return String(Math.round(value));
    }

    function normalizeExpression(expr) {
        return String(expr || "")
            .replaceAll("ҳ", "*")
            .replaceAll("÷", "/")
            .replaceAll("➕", "+")
            .replaceAll("➖", "-")
            .replaceAll("ns.exit(),", "")
            .split(",")[0]
            .replace(/[^0-9+\-*/().\s]/g, "");
    }

    function evalArithmetic(expr) {
        expr = normalizeExpression(expr);
        let i = 0;
        function skip() { while (/\s/.test(expr[i] || "")) i++; }
        function parseAtom() {
            skip();
            let sign = 1;
            if (expr[i] === "+") i++;
            else if (expr[i] === "-") { sign = -1; i++; }
            skip();
            if (expr[i] === "(") {
                i++;
                const v = addsub();
                skip();
                if (expr[i] === ")") i++;
                return sign * v;
            }
            const start = i;
            while (/[0-9.]/.test(expr[i] || "")) i++;
            const v = Number(expr.slice(start, i));
            return sign * v;
        }
        function muldiv() {
            let v = parseAtom();
            for (;;) {
                skip();
                const op = expr[i];
                if (op !== "*" && op !== "/") break;
                i++;
                const rhs = parseAtom();
                v = op === "*" ? v * rhs : v / rhs;
            }
            return v;
        }
        function addsub() {
            let v = muldiv();
            for (;;) {
                skip();
                const op = expr[i];
                if (op !== "+" && op !== "-") break;
                i++;
                const rhs = muldiv();
                v = op === "+" ? v + rhs : v - rhs;
            }
            return v;
        }
        const v = addsub();
        return Number.isFinite(v) ? String(v) : null;
    }

    function parseMastermind(feedback) {
        if (!feedback) return null;
        if (typeof feedback.data === "string" && /^\d+,\d+$/.test(feedback.data)) {
            const p = feedback.data.split(",").map(Number);
            return { exact: p[0], misplaced: p[1] };
        }
        const msg = String(feedback.message || "");
        const m = msg.match(/(\d+) symbol.*match exactly.*?(\d+) symbol.*wrong place/i);
        return m ? { exact: Number(m[1]), misplaced: Number(m[2]) } : null;
    }

    function parseRms(feedback) {
        if (!feedback) return null;
        const text = String(feedback.data || "") + " " + String(feedback.message || "");
        const m = text.match(/RMS Deviation:\s*([0-9.]+)/i);
        return m ? Number(m[1]) : null;
    }

    async function solveMastermind(target, details) {
        const n = details.passwordLength;
        const charset = charsetFor(details.passwordFormat);
        const counts = new Map();
        let sentinel = null;

        for (const c of charset) {
            const r = await tryPassword(target, c.repeat(n), true);
            if (r.success) return c.repeat(n);
            const score = parseMastermind(r.feedback);
            if (!score) return null;
            const count = score.exact + score.misplaced;
            counts.set(c, count);
            if (count === 0 && sentinel === null) sentinel = c;
        }
        if (sentinel === null) return null;

        const remaining = new Map();
        for (const pair of counts) if (pair[1] > 0) remaining.set(pair[0], pair[1]);
        const result = Array(n).fill(sentinel);

        for (let pos = 0; pos < n; pos++) {
            let placed = false;
            for (const pair of Array.from(remaining.entries())) {
                const c = pair[0];
                if (pair[1] <= 0) continue;
                const guess = Array(n).fill(sentinel);
                guess[pos] = c;
                const r = await tryPassword(target, guess.join(""), true);
                if (r.success) return guess.join("");
                const score = parseMastermind(r.feedback);
                if (!score) return null;
                if (score.exact >= 1) {
                    result[pos] = c;
                    const left = pair[1] - 1;
                    if (left <= 0) remaining.delete(c);
                    else remaining.set(c, left);
                    placed = true;
                    break;
                }
            }
            if (!placed) return null;
        }
        const final = result.join("");
        const r = await tryPassword(target, final, false);
        return r.success ? final : null;
    }

    async function solveYesnt(target, details) {
        const n = details.passwordLength;
        const charset = charsetFor(details.passwordFormat);
        const result = Array(n).fill(null);
        for (const c of charset) {
            const r = await tryPassword(target, c.repeat(n), true);
            if (r.success) return c.repeat(n);
            if (!r.feedback || typeof r.feedback.data !== "string") return null;
            const feedbackFlags = r.feedback.data.split(",");
            for (let i = 0; i < Math.min(n, feedbackFlags.length); i++) {
                if (feedbackFlags[i] === "yes") result[i] = c;
            }
            if (result.every(function (x) { return x !== null; })) break;
        }
        if (result.some(function (x) { return x === null; })) return null;
        const final = result.join("");
        const r = await tryPassword(target, final, false);
        return r.success ? final : null;
    }

    async function solveSortedEcho(target, details) {
        const n = details.passwordLength;
        if (details.passwordFormat !== "numeric") return null;
        const zero = "0".repeat(n);
        const base = await tryPassword(target, zero, true);
        if (base.success) return zero;
        const rms0 = parseRms(base.feedback);
        if (!Number.isFinite(rms0)) return null;
        const sse0 = rms0 * rms0 * n;
        const digits = [];
        for (let pos = 0; pos < n; pos++) {
            const chars = Array(n).fill("0");
            chars[pos] = "9";
            const guess = chars.join("");
            const r = await tryPassword(target, guess, true);
            if (r.success) return guess;
            const rms = parseRms(r.feedback);
            if (!Number.isFinite(rms)) return null;
            const sse = rms * rms * n;
            const actual = Math.max(0, Math.min(9, Math.round((81 - (sse - sse0)) / 18)));
            digits.push(String(actual));
        }
        const final = digits.join("");
        const r = await tryPassword(target, final, false);
        return r.success ? final : null;
    }

    async function solveGuessNumber(target, details, low, high, romanMode) {
        low = Math.max(0, Math.floor(low));
        high = Math.max(low, Math.floor(high));
        for (let steps = 0; steps < 80 && low <= high; steps++) {
            const mid = Math.floor((low + high) / 2);
            const pw = String(mid);
            const r = await tryPassword(target, pw, true);
            if (r.success) return pw;
            if (!r.feedback) return null;
            const data = String(r.feedback.data || "").toUpperCase();
            if (romanMode) {
                if (data.includes("ALTUS")) high = mid - 1;
                else if (data.includes("PARUM")) low = mid + 1;
                else return null;
            } else {
                if (data.includes("LOWER")) high = mid - 1;
                else if (data.includes("HIGHER")) low = mid + 1;
                else return null;
            }
        }
        return null;
    }

    async function solveTiming(target, details) {
        const n = details.passwordLength;
        const charset = charsetFor(details.passwordFormat);
        let prefix = "";
        const filler = charset[0];
        for (let pos = 0; pos < n; pos++) {
            let found = false;
            for (const c of charset) {
                const guess = prefix + c + filler.repeat(n - pos - 1);
                const r = await tryPassword(target, guess, true);
                if (r.success) return guess;
                if (!r.feedback) return null;
                const msg = String(r.feedback.message || "");
                const m = msg.match(/mismatch while checking each character\s*\((-?\d+)\)/i);
                if (!m) return null;
                const mismatch = Number(m[1]);
                if (mismatch > pos || mismatch === -1) {
                    prefix += c;
                    found = true;
                    break;
                }
            }
            if (!found) return null;
        }
        const r = await tryPassword(target, prefix, false);
        return r.success ? prefix : null;
    }

    async function solveDivisibility(target, details) {
        let r = await tryPassword(target, "1", true);
        if (r.success) return "1";
        let product = 1n;
        const primes = SMALL_PRIMES.concat(LARGE_PRIMES);
        const maxValue = 10n ** BigInt(Math.max(1, details.passwordLength));
        for (const prime of primes) {
            const p = BigInt(prime);
            let power = p;
            let exponent = 0;
            while (power <= maxValue) {
                r = await tryPassword(target, power.toString(), true);
                if (r.success) return power.toString();
                const fb = r.feedback;
                if (!fb) break;
                const yes = String(fb.data || "").toLowerCase() === "true" || / IS divisible/i.test(String(fb.message || ""));
                if (!yes) break;
                exponent++;
                power *= p;
                if (exponent > 20) break;
            }
            for (let i = 0; i < exponent; i++) product *= p;
        }
        const candidate = product.toString();
        r = await tryPassword(target, candidate, false);
        return r.success ? candidate : null;
    }

    function modInv(a, m) {
        let t = 0n, newT = 1n;
        let r = m, newR = ((a % m) + m) % m;
        while (newR !== 0n) {
            const q = r / newR;
            const tmpT = t - q * newT; t = newT; newT = tmpT;
            const tmpR = r - q * newR; r = newR; newR = tmpR;
        }
        if (r > 1n) return null;
        if (t < 0n) t += m;
        return t;
    }

    async function solveTripleModulo(target, details) {
        const mods = [31,29,23,19,17,13,11,7,5,3,2];
        const residues = [];
        for (const m of mods) {
            const r = await tryPassword(target, String(m), true);
            if (r.success) return String(m).padStart(details.passwordLength, "0");
            if (!r.feedback) return null;
            const value = Number(r.feedback.data);
            if (!Number.isFinite(value)) return null;
            residues.push(BigInt(Math.trunc(value)));
        }
        let M = 1n;
        for (const m of mods) M *= BigInt(m);
        let x = 0n;
        for (let i = 0; i < mods.length; i++) {
            const mi = BigInt(mods[i]);
            const Mi = M / mi;
            const inv = modInv(Mi, mi);
            if (inv === null) return null;
            x += residues[i] * Mi * inv;
        }
        x = ((x % M) + M) % M;
        const candidate = x.toString().padStart(details.passwordLength, "0");
        const r = await tryPassword(target, candidate, false);
        return r.success ? candidate : null;
    }

    async function solvePacketSniffer(target, details) {
        // First intentionally fail once to force packet data into an auth log.
        await tryPassword(target, "", true);
        for (let round = 0; round < 20; round++) {
            try {
                await waitForDnetSlot();
                phase = "heartbleed";
                activeTarget = target;
                const hb = await ns.dnet.heartbleed(target, { peek: false, logsToCapture: 8 });
                if (hb && hb.success && Array.isArray(hb.logs)) {
                    harvestRawLogCredentials(target, hb.logs);
                    for (const line of hb.logs) {
                        if (typeof line !== "string") continue;
                        const escaped = target.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
                        const named = line.match(new RegExp(escaped + ":([^\\s]+)"));
                        if (named) {
                            const r = await tryPassword(target, named[1], false);
                            if (r.success) return named[1];
                        }
                        const pass = line.match(/Logging in with passcode:\s*([^\s]+)\s*\.\.\./i);
                        if (pass) {
                            const r = await tryPassword(target, pass[1], false);
                            if (r.success) return pass[1];
                        }
                    }
                }
            } catch {
        // Intentionally ignored: this operation is best-effort.
    }
            await ns.sleep(500);
        }
        return null;
    }

    async function genericNumericBrute(target, details) {
        if (details.passwordFormat !== "numeric" || details.passwordLength > 3) return null;
        const max = Math.min(MAX_BRUTE_ATTEMPTS, Math.pow(10, details.passwordLength));
        for (let i = 0; i < max; i++) {
            const candidate = String(i).padStart(details.passwordLength, "0");
            const r = await tryPassword(target, candidate, false);
            if (r.success) return candidate;
        }
        return null;
    }

    async function solveTarget(target) {
        const until = cooldownUntil.get(target) || 0;
        if (Date.now() < until) return null;

        const details = getDetails(target);
        if (!details || details.isConnectedToCurrentServer === false) return null;
        const model = String(details.modelId || "");

        let solved = await tryCandidates(target, localClueCandidates(target), model);
        if (solved !== null) return solved;

        try {
            switch (model) {
                case "ZeroLogon":
                    solved = await tryCandidates(target, [""], model);
                    break;

                case "DeskMemo_3.1": {
                    const hint = String(details.passwordHint || "");
                    const n = Number(details.passwordLength || 0);
                    const candidate = n > 0 ? hint.slice(-n) : "";
                    solved = await tryCandidates(target, [candidate], model);
                    break;
                }

                case "CloudBlare(tm)": {
                    const candidate = String(details.data || "").replace(/\D/g, "");
                    solved = await tryCandidates(target, [candidate], model);
                    break;
                }

                case "FreshInstall_1.0":
                    solved = await tryCandidates(target, DEFAULT_PASSWORDS, model);
                    break;

                case "Laika4":
                    solved = await tryCandidates(target, DOG_NAMES, model);
                    break;

                case "TopPass":
                    solved = await tryCandidates(target, COMMON_PASSWORDS, model);
                    break;

                case "EuroZone Free":
                    solved = await tryCandidates(target, EU_COUNTRIES, model);
                    break;

                case "Pr0verFl0":
                    solved = await tryCandidates(target, ["A".repeat(Number(details.passwordLength || 0) * 2)], model);
                    break;

                case "110100100":
                    solved = await tryCandidates(target, [decodeBinary(details.data)], model);
                    break;

                case "OrdoXenos":
                    solved = await tryCandidates(target, [decodeXor(details.data)], model);
                    break;

                case "PrimeTime 2":
                    solved = await tryCandidates(target, [largestPrimeFactor(details.data)], model);
                    break;

                case "OctantVoxel":
                    solved = await tryCandidates(target, [decodeBaseN(details.data)], model);
                    break;

                case "MathML":
                    solved = await tryCandidates(target, [evalArithmetic(details.data)], model);
                    break;

                case "AccountsManager_4.2":
                    solved = await solveGuessNumber(target, details, 0, Math.pow(10, details.passwordLength) - 1, false);
                    break;

                case "BellaCuore": {
                    const data = String(details.data || "");
                    if (data.includes(",")) {
                        const p = data.split(",");
                        solved = await solveGuessNumber(target, details, romanToInt(p[0]), romanToInt(p[1]), true);
                    } else {
                        solved = await tryCandidates(target, [String(romanToInt(data))], model);
                    }
                    break;
                }

                case "DeepGreen":
                    solved = await solveMastermind(target, details);
                    break;

                case "NIL":
                    solved = await solveYesnt(target, details);
                    break;

                case "PHP 5.4":
                    solved = await solveSortedEcho(target, details);
                    break;

                case "2G_cellular":
                    solved = await solveTiming(target, details);
                    break;

                case "Factori-Os":
                    solved = await solveDivisibility(target, details);
                    break;

                case "BigMo%od":
                    solved = await solveTripleModulo(target, details);
                    break;

                case "OpenWebAccessPoint":
                    solved = await solvePacketSniffer(target, details);
                    break;
            }
        } catch { solved = null; }

        if (solved === null) solved = await genericNumericBrute(target, details);

        if (solved !== null) {
            recordCredential(target, solved, model);
            return solved;
        }

        // Don't hammer an unsolved interactive model continuously. Phishing on already
        // accessed servers will raise CHA, then we'll retry later with better Heartbleed access.
        cooldownUntil.set(target, Date.now() + 60000);
        return null;
    }

    async function fullyReallocate(target) {
        let pid = 0;
        try { pid = ns.exec(RAM_LAUNCHER, target, 1); }
        catch { pid = 0; }

        if (pid === 0) return;

        for (let i = 0; i < 120; i++) {
            let blocked = 0;
            try { blocked = ns.dnet.getBlockedRam(target); }
            catch { return; }

            if (!(blocked > 0)) return;
            await ns.sleep(250);
        }
    }

    async function wasVisitedThisCrawl(target) {
        if (!crawlId) return false;

        try {
            if (!ns.fileExists(VISIT_MARKER, target)) return false;
            await ns.write(VISIT_MARKER, crawlId, "w");
            const copied = await ns.scp(VISIT_MARKER, host, target);
            if (!copied) return false;
            const targetCrawlId = String(ns.read(VISIT_MARKER) || "");
            await ns.write(VISIT_MARKER, crawlId, "w");
            return targetCrawlId === crawlId;
        } catch {
            try { await ns.write(VISIT_MARKER, crawlId, "w"); }
            catch {
        // Intentionally ignored: this operation is best-effort.
    }
            return false;
        }
    }

    function completionFileFor(target) {
        return COMPLETION_PREFIX + hashString(crawlId + "|" + target) + ".txt";
    }

    async function signalParentCompletion() {
        if (!parentCompletionFile) return;
        try {
            await ns.write(
                parentCompletionFile,
                JSON.stringify({
                    crawlId: crawlId,
                    host: host,
                    phase: phase,
                    ts: Date.now()
                }),
                "w"
            );
            for (let signalTry = 0; signalTry < MAX_COMPLETION_SIGNAL_ATTEMPTS; signalTry++) {
                let copied = false;
                try { copied = await ns.scp(parentCompletionFile, "home", host); }
                catch {
                    // Intentionally ignored: retry below.
                }
                if (copied) {
                    ns.rm(parentCompletionFile, host);
                    return;
                }
                await ns.sleep(COMPLETION_RETRY_MS);
            }
        } catch {
            // Intentionally ignored: the parent has a fail-safe timeout.
        }
    }

    async function waitForChild(target, childPid, completionFile) {
        phase = "wait-child";
        activeTarget = target;
        const deadline = Date.now() + MAX_CHILD_WAIT_MS;

        for (;;) {
            try {
                if (ns.fileExists(completionFile, "home")) {
                    ns.rm(completionFile, "home");
                    lastProgress = Date.now();
                    return true;
                }
            } catch {
                // Intentionally ignored: retry until completion or timeout.
            }
            if (Date.now() >= deadline) {
                try { ns.kill(childPid); }
                catch {
                    // Intentionally ignored: the target may already be offline.
                }
                phase = "child-timeout";
                await saveReport("Timed out waiting for child " + target + ".");
                return false;
            }
            if (Date.now() - lastReport >= REPORT_INTERVAL) {
                await maybeToggleStasis();
                ensurePhishing();
                await saveReport("");
            }
            await ns.sleep(CHILD_POLL_MS);
        }
    }

    async function deployChild(target, password) {
        if (!crawlId || crawlDepth >= MAX_CRAWL_DEPTH) return false;
        const completionFile = completionFileFor(target);

        try {
            await ns.write(VISIT_MARKER, crawlId, "w");
            await ns.scp(
                [
                    AGENT,
                    PHISH,
                    PHISH_LAUNCHER,
                    RAM_LAUNCHER,
                    RAM_WORKER,
                    STASIS,
                    LOOT,
                    PLAN,
                    PHISH_PLAN,
                    DB_FILE,
                    VISIT_MARKER
                ],
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
            for (let i = 0; i < 40; i++) {
                let running = false;
                try {
                    running = ns.ps(target).some(function (p) { return p.pid === lootPid; });
                } catch {
        // Intentionally ignored: this operation is best-effort.
    }
                if (!running) break;
                await ns.sleep(50);
            }
        }

        try {
            const managed = [AGENT, PHISH, PHISH_LAUNCHER, RAM_LAUNCHER, RAM_WORKER, STASIS, LOOT];
            const processes = ns.ps(target);
            const existing = processes.find(function (p) { return p.filename === AGENT; });
            if (
                existing &&
                String(existing.args && existing.args[1] || "") === AGENT_VERSION &&
                String(existing.args && existing.args[2] || "") === crawlId
            ) {
                return await waitForChild(
                    target,
                    existing.pid,
                    completionFile
                );
            }
            for (const proc of processes) {
                if (managed.includes(proc.filename)) {
                    try { ns.kill(proc.pid); } catch {
        // Intentionally ignored: this operation is best-effort.
    }
                }
            }
            if (processes.length > 0) await ns.sleep(50);
        } catch {
        // Intentionally ignored: this operation is best-effort.
    }

        let childPid = 0;
        try {
            childPid = ns.exec(
                AGENT,
                target,
                1,
                password,
                AGENT_VERSION,
                crawlId,
                crawlDepth + 1,
                completionFile
            );
        } catch {
            childPid = 0;
        }
        if (childPid === 0) return false;
        return await waitForChild(target, childPid, completionFile);
    }

    async function lootSelf() {
        if (Date.now() - lastLoot < LOOT_INTERVAL) return;
        lastLoot = Date.now();
        try {
            const running = ns.ps(host).some(function (p) { return p.filename === LOOT; });
            if (!running) ns.exec(LOOT, host, 1, "periodic");
        } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    }

    function readPlan() {
        try {
            const raw = ns.read(PLAN);
            if (!raw) return null;
            const p = JSON.parse(raw);
            return p && Array.isArray(p.desired) ? p : null;
        } catch { return null; }
    }

    function readPhishPlan() {
        try {
            const raw = ns.read(PHISH_PLAN);
            if (!raw) return null;
            const plan = JSON.parse(raw);
            if (!plan || !Array.isArray(plan.desired)) return null;
            if (plan.desired.length > 4) return null;
            if (Date.now() - Number(plan.ts || 0) > 90000) return null;
            return plan;
        } catch { return null; }
    }

    async function maybeToggleStasis() {
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
        } catch {
        // Intentionally ignored: this operation is best-effort.
    }

        return false;
    }

    function ensurePhishing() {
        try {
            const plan = readPhishPlan();
            const allowed =
                host !== "darkweb" && plan && plan.desired.includes(host);
            const processes = ns.ps(host);
            const phishing = processes.filter(function (p) {
                return p.filename === PHISH;
            });
            const launchers = processes.filter(function (p) {
                return p.filename === PHISH_LAUNCHER;
            });

            if (!allowed) {
                for (const process of phishing.concat(launchers)) {
                    try { ns.kill(process.pid); }
                    catch {
        // Intentionally ignored: this operation is best-effort.
    }
                }
                return;
            }

            for (const duplicate of phishing.slice(1).concat(launchers.slice(1))) {
                try { ns.kill(duplicate.pid); }
                catch {
        // Intentionally ignored: this operation is best-effort.
    }
            }
            if (phishing.length === 0 && launchers.length === 0) {
                ns.exec(PHISH_LAUNCHER, host, 1);
            }
        } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    }

    async function saveReport(errorText) {
        try {
            if (!selfDetails) selfDetails = getDetails(host);
            const details = selfDetails;
            let phishPid = 0;
            let phishThreads = 0;
            let managedProcesses = 0;
            try {
                const managed = [AGENT, PHISH, PHISH_LAUNCHER, RAM_LAUNCHER, RAM_WORKER, STASIS, LOOT];
                for (const process of ns.ps(host)) {
                    if (managed.includes(process.filename)) managedProcesses++;
                    if (process.filename === PHISH) {
                        phishPid = Number(process.pid || 0);
                        phishThreads += Number(process.threads || 0);
                    }
                }
            } catch {
        // Intentionally ignored: this operation is best-effort.
    }
            const report = {
                ts: Date.now(),
                host: host,
                password: selfPassword,
                maxRam: 0,
                usedRam: 0,
                blockedRam: details ? Number(details.blockedRam || 0) : 0,
                depth: details ? Number(details.depth ?? -1) : -1,
                difficulty: details ? Number(details.difficulty ?? -1) : -1,
                modelId: details ? String(details.modelId || "") : "",
                agentVersion: AGENT_VERSION,
                phase: phase,
                activeTarget: activeTarget,
                authAttempts: authAttempts,
                authSuccesses: authSuccesses,
                authFailures: authFailures,
                authTimeouts: authTimeouts,
                loopCount: loopCount,
                crawlId: crawlId,
                crawlDepth: crawlDepth,
                completed: phase === "complete" || phase === "failed",
                lastProgress: lastProgress,
                managedProcesses: managedProcesses,
                phishPid: phishPid,
                phishThreads: phishThreads,
                requiredCharismaSkill: details ? Number(details.requiredCharismaSkill ?? -1) : -1,
                isStationary: details ? !!details.isStationary : false,
                neighbors: lastNeighbors.slice(),
                found: foundCredentials.slice(-25),
                error: errorText ? String(errorText) : ""
            };
            const file = reportFileFor(host);
            await ns.write(file, JSON.stringify(report), "w");
            await ns.scp(file, "home", host);
            lastReport = Date.now();
        } catch {
        // Intentionally ignored: this operation is best-effort.
    }
    }

    if (!crawlId || crawlDepth > MAX_CRAWL_DEPTH) return;
    try { await ns.write(VISIT_MARKER, crawlId, "w"); }
    catch { return; }

    selfDetails = getDetails(host);
    phase = "initial-report";
    await saveReport("");
    await ns.sleep(250 + (parseInt(hashString(host), 16) % 750));

    try {
        loopCount = 1;
        phase = "loot";
        activeTarget = "";
        await lootSelf();

        phase = "stasis";
        await maybeToggleStasis();

        phase = "probe";
        lastNeighbors = safeProbe();
        if (crawlDepth < MAX_CRAWL_DEPTH) {
            for (const target of lastNeighbors) {
                if (target === host) continue;
                activeTarget = target;
                phase = "inspect";
                if (await wasVisitedThisCrawl(target)) continue;

                phase = "solve";
                const password = await solveTarget(target);
                if (password === null) continue;
                phase = "deploy";
                if (await deployChild(target, password)) {
                    lastProgress = Date.now();
                }
            }
        }

        phase = "stasis";
        activeTarget = "";
        await maybeToggleStasis();
        phase = "phish-control";
        ensurePhishing();
        phase = "complete";
        await saveReport("");
    } catch (e) {
        phase = "failed";
        await saveReport(String(e));
    }
    await signalParentCompletion();
}
`;

    function log(message, terminal) {
        const text = "[DNET " + VERSION + "] " + message;
        ns.print(text);
        if (terminal) ns.tprint(text);
    }

    async function enforceSingleManager() {
        const ownPid = ns.pid;
        const ownScript = ns.getScriptName();
        let killed = 0;

        try {
            for (const process of ns.ps("home")) {
                if (process.pid === ownPid || process.filename !== ownScript) {
                    continue;
                }
                try {
                    if (ns.kill(process.pid)) killed++;
                } catch {
                    // Intentionally ignored: another process may have won the race.
                }
            }
        } catch {
            // Intentionally ignored: the manager will still start normally.
        }

        if (killed > 0) {
            log(
                "Stopped " +
                    killed +
                    " older manager instance(s) before starting.",
                true
            );
            // Let killed instances finish cleanup before replacing their workers.
            await ns.sleep(100);
        }
    }

    async function writeWorkers() {
        await ns.write(AGENT, AGENT_SOURCE, "w");
        await ns.write(PHISH, PHISH_SOURCE, "w");
        await ns.write(PHISH_LAUNCHER, PHISH_LAUNCHER_SOURCE, "w");
        await ns.write(RAM_LAUNCHER, RAM_LAUNCHER_SOURCE, "w");
        await ns.write(RAM_WORKER, RAM_WORKER_SOURCE, "w");
        await ns.write(STASIS, STASIS_SOURCE, "w");
        await ns.write(LOOT, LOOT_SOURCE, "w");
        if (!ns.fileExists(PLAN, "home"))
            await ns.write(
                PLAN,
                JSON.stringify({ desired: [], ts: Date.now() }),
                "w"
            );
        if (!ns.fileExists(PHISH_PLAN, "home"))
            await ns.write(
                PHISH_PLAN,
                JSON.stringify({ desired: [], ts: Date.now(), maxHosts: 0 }),
                "w"
            );
        if (!ns.fileExists(DB_FILE, "home")) await ns.write(DB_FILE, "{}", "w");
    }

    async function resetPhishPlan() {
        await ns.write(
            PHISH_PLAN,
            JSON.stringify({
                desired: [],
                ts: Date.now(),
                maxHosts: configuredPhishHosts,
                version: VERSION,
                reason: configuredPhishHosts > 0 ? "starting" : "disabled",
            }),
            "w"
        );
    }

    function stopKnownPhishing(db) {
        const targets = new Set(["darkweb"].concat(Object.keys(db)));
        try {
            for (const file of ns.ls("home", REPORT_PREFIX)) {
                try {
                    const report = JSON.parse(ns.read(file));
                    if (report && typeof report.host === "string") {
                        targets.add(report.host);
                    }
                } catch {
                    // Intentionally ignored: this operation is best-effort.
                }
            }
        } catch {
            // Intentionally ignored: this operation is best-effort.
        }

        let killed = 0;
        for (const target of targets) {
            try {
                for (const process of ns.ps(target)) {
                    if (
                        process.filename !== PHISH &&
                        process.filename !== PHISH_LAUNCHER
                    ) {
                        continue;
                    }
                    try {
                        if (ns.kill(process.pid)) killed++;
                    } catch {
                        // Intentionally ignored: this operation is best-effort.
                    }
                }
            } catch {
                // Intentionally ignored: this operation is best-effort.
            }
        }
        return killed;
    }

    function loadDb() {
        try {
            const raw = ns.read(DB_FILE);
            if (!raw) return {};
            const db = JSON.parse(raw);
            return db && typeof db === "object" ? db : {};
        } catch {
            return {};
        }
    }

    async function saveDb(db) {
        await ns.write(DB_FILE, JSON.stringify(db, null, 2), "w");
    }

    function readReports() {
        const reports = [];
        const now = Date.now();
        for (const file of ns.ls("home", REPORT_PREFIX)) {
            try {
                const r = JSON.parse(ns.read(file));
                if (!r || !r.host) continue;
                if (now - Number(r.ts || 0) > REPORT_RETENTION_MS) {
                    try {
                        ns.rm(file, "home");
                    } catch {
                        // Intentionally ignored: this operation is best-effort.
                    }
                    continue;
                }
                try {
                    const server = ns.getServer(r.host);
                    if (server && server.isOnline === false) continue;
                    if (server) {
                        r.maxRam = Number(server.maxRam || 0);
                        r.usedRam = Number(server.ramUsed || 0);
                    }
                } catch {
                    // Intentionally ignored: this operation is best-effort.
                }
                reports.push(r);
            } catch {
                // Intentionally ignored: this operation is best-effort.
            }
        }
        return reports;
    }

    async function ingestReports(db, reports) {
        let changed = false;
        for (const r of reports) {
            if (r && r.host && typeof r.password === "string") {
                const old = db[r.host];
                if (
                    !old ||
                    old.password !== r.password ||
                    Number(r.ts || 0) > Number(old.lastSeen || 0)
                ) {
                    db[r.host] = {
                        password: r.password,
                        lastSeen: Number(r.ts || Date.now()),
                        maxRam: Number(r.maxRam || 0),
                        depth: Number(r.depth ?? -1),
                        modelId: String(r.modelId || ""),
                    };
                    changed = true;
                }
            }
            if (r && Array.isArray(r.found)) {
                for (const f of r.found) {
                    if (!f || !f.host || typeof f.password !== "string")
                        continue;
                    const old = db[f.host];
                    if (
                        !old ||
                        old.password !== f.password ||
                        Number(f.ts || 0) > Number(old.lastSeen || 0)
                    ) {
                        db[f.host] = {
                            password: f.password,
                            lastSeen: Number(f.ts || Date.now()),
                            maxRam: old ? Number(old.maxRam || 0) : 0,
                            depth: old ? Number(old.depth ?? -1) : -1,
                            modelId: String(
                                f.modelId || (old ? old.modelId || "" : "")
                            ),
                        };
                        changed = true;
                    }
                }
            }
        }
        if (changed) await saveDb(db);
    }

    let crawlWasRunning = false;
    let currentCrawlId = "";
    let descendantDrainNoticeShown = false;
    let nextCrawlAt = 0;

    async function seedDarkweb(reports) {
        let running = null;
        const now = Date.now();
        const activeReports = reports.filter(function (report) {
            return (
                report &&
                report.host &&
                report.agentVersion === VERSION &&
                !report.completed &&
                now - Number(report.ts || 0) <= REPORT_FRESH_MS
            );
        });
        try {
            running = ns.ps("darkweb").find(function (p) {
                return p.filename === AGENT;
            });
            if (
                running &&
                String((running.args && running.args[1]) || "") === VERSION
            ) {
                crawlWasRunning = true;
                currentCrawlId = String(
                    (running.args && running.args[2]) || currentCrawlId
                );
                descendantDrainNoticeShown = false;
                return true;
            }
            if (running) {
                try {
                    ns.kill(running.pid);
                } catch {
                    // Intentionally ignored: this operation is best-effort.
                }
                await ns.sleep(50);
                running = null;
                crawlWasRunning = false;
                currentCrawlId = "";
                descendantDrainNoticeShown = false;
                nextCrawlAt = 0;
            }
        } catch {
            // Intentionally ignored: this operation is best-effort.
        }

        if (!running && activeReports.length > 0) {
            crawlWasRunning = true;
            if (!currentCrawlId) {
                currentCrawlId = String(activeReports[0].crawlId || "");
            }
            if (!descendantDrainNoticeShown) {
                log(
                    "Root crawler exited; waiting for " +
                        activeReports.length +
                        " descendant stack agent(s) before another crawl.",
                    false
                );
                descendantDrainNoticeShown = true;
            }
            return false;
        }

        if (!running && crawlWasRunning) {
            crawlWasRunning = false;
            currentCrawlId = "";
            descendantDrainNoticeShown = false;
            nextCrawlAt = Date.now() + CRAWL_RESTART_DELAY_MS;
            log(
                "Bounded crawl completed; next mutation rescan in " +
                    Math.floor(CRAWL_RESTART_DELAY_MS / 1000) +
                    " seconds.",
                false
            );
            return false;
        }
        if (Date.now() < nextCrawlAt) return false;

        let auth;
        try {
            auth = await ns.dnet.authenticate("darkweb", "");
        } catch {
            return false;
        }
        if (!auth || !auth.success) return false;

        try {
            const crawlId = VERSION + ":" + Date.now().toString(36);
            await ns.write(VISIT_MARKER, crawlId, "w");
            await ns.scp(
                [
                    AGENT,
                    PHISH,
                    PHISH_LAUNCHER,
                    RAM_LAUNCHER,
                    RAM_WORKER,
                    STASIS,
                    LOOT,
                    PLAN,
                    PHISH_PLAN,
                    DB_FILE,
                    VISIT_MARKER,
                ],
                "darkweb",
                "home"
            );
            const pid = ns.exec(AGENT, "darkweb", 1, "", VERSION, crawlId, 0);
            if (pid) {
                crawlWasRunning = true;
                currentCrawlId = crawlId;
                descendantDrainNoticeShown = false;
                log(
                    "Started bounded serial crawl on darkweb (PID " +
                        pid +
                        ", stack cap " +
                        MAX_CRAWL_STACK +
                        ").",
                    false
                );
            }
            return pid !== 0;
        } catch {
            return false;
        }
    }

    async function pushPlanFiles(host, password) {
        try {
            const session = ns.dnet.connectToSession(host, password);
            if (!session || !session.success) return false;
            await ns.scp([PLAN, STASIS], host, "home");
            try {
                const plan = JSON.parse(ns.read(PLAN) || "{}");
                const shouldLink =
                    Array.isArray(plan.desired) && plan.desired.includes(host);
                const alreadyRunning = ns.ps(host).some(function (process) {
                    return process.filename === STASIS;
                });
                if (!alreadyRunning) {
                    ns.exec(STASIS, host, 1, shouldLink ? "1" : "0");
                }
            } catch {
                // A remote exec can fail until the host is linked or adjacent.
            }
            return true;
        } catch {
            return false;
        }
    }

    function readCurrentPhishPlan() {
        try {
            const raw = ns.read(PHISH_PLAN);
            if (!raw) return { desired: [], ts: 0 };
            const plan = JSON.parse(raw);
            if (!plan || !Array.isArray(plan.desired)) {
                return { desired: [], ts: 0 };
            }
            return plan;
        } catch {
            return { desired: [], ts: 0 };
        }
    }

    function readPhishHeartbeats() {
        const now = Date.now();
        const latest = new Map();
        try {
            for (const file of ns.ls("home", PHISH_HEARTBEAT_PREFIX)) {
                try {
                    const heartbeat = JSON.parse(ns.read(file));
                    if (!heartbeat || typeof heartbeat.host !== "string") {
                        continue;
                    }
                    const age = now - Number(heartbeat.ts || 0);
                    if (age > PHISH_HEARTBEAT_RETENTION_MS) {
                        ns.rm(file, "home");
                        continue;
                    }
                    const old = latest.get(heartbeat.host);
                    if (
                        !old ||
                        Number(heartbeat.ts || 0) > Number(old.ts || 0)
                    ) {
                        latest.set(heartbeat.host, heartbeat);
                    }
                } catch {
                    // Intentionally ignored: another heartbeat may still be valid.
                }
            }
        } catch {
            // Intentionally ignored: an empty result is safe and self-correcting.
        }
        return Array.from(latest.values()).filter(function (heartbeat) {
            const state = String(heartbeat.state || "");
            return (
                heartbeat.version === VERSION &&
                (state === "starting" || state === "running") &&
                now - Number(heartbeat.ts || 0) <= PHISH_HEARTBEAT_FRESH_MS
            );
        });
    }

    function clearPhishHeartbeats() {
        try {
            for (const file of ns.ls("home", PHISH_HEARTBEAT_PREFIX)) {
                try {
                    ns.rm(file, "home");
                } catch {
                    // Intentionally ignored: another cleanup may have removed it.
                }
            }
        } catch {
            // Intentionally ignored: workers overwrite their own heartbeat files.
        }
    }

    async function pushPhishPlanFiles(host, password) {
        try {
            const session = ns.dnet.connectToSession(host, password);
            if (!session || !session.success) return false;
            await ns.scp([PHISH_PLAN, PHISH, PHISH_LAUNCHER], host, "home");
            try {
                const plan = readCurrentPhishPlan();
                const allowed = plan.desired.includes(host);
                const alreadyRunning = ns.ps(host).some(function (process) {
                    return (
                        process.filename === PHISH ||
                        process.filename === PHISH_LAUNCHER
                    );
                });
                if (allowed && !alreadyRunning) {
                    ns.exec(PHISH_LAUNCHER, host, 1, "manager-plan");
                }
            } catch {
                // A remote exec can fail until the host is linked or adjacent.
            }
            return true;
        } catch {
            return false;
        }
    }

    let phishCircuitOpen = false;
    async function updatePhishingPlan(db, reports) {
        const now = Date.now();
        const latest = new Map();
        for (const report of reports) {
            if (
                !report ||
                !report.host ||
                report.host === "darkweb" ||
                report.isStationary ||
                report.agentVersion !== VERSION ||
                now - Number(report.ts || 0) > REPORT_FRESH_MS
            ) {
                continue;
            }
            const old = latest.get(report.host);
            if (!old || Number(report.ts || 0) > Number(old.ts || 0)) {
                latest.set(report.host, report);
            }
        }

        const activeCrawlerCount = reports.filter(function (report) {
            return (
                report &&
                report.host &&
                report.agentVersion === VERSION &&
                !report.completed &&
                now - Number(report.ts || 0) <= REPORT_FRESH_MS
            );
        }).length;
        const overloaded = activeCrawlerCount > MAX_CRAWL_STACK;
        if (overloaded && !phishCircuitOpen) {
            log(
                "Crawler safety circuit opened: " +
                    activeCrawlerCount +
                    " active stack reports exceeds the hard cap of " +
                    MAX_CRAWL_STACK +
                    ".",
                true
            );
        } else if (!overloaded && phishCircuitOpen) {
            log("Crawler safety circuit recovered; phishing may resume.", true);
        }
        phishCircuitOpen = overloaded;

        const candidates = Array.from(latest.values()).sort(function (a, b) {
            const ramDelta = Number(b.maxRam || 0) - Number(a.maxRam || 0);
            if (ramDelta !== 0) return ramDelta;
            return String(a.host).localeCompare(String(b.host));
        });
        const desired =
            overloaded || configuredPhishHosts === 0
                ? []
                : candidates
                      .slice(0, configuredPhishHosts)
                      .map(function (report) {
                          return report.host;
                      });

        const previous = readCurrentPhishPlan();
        const oldDesired = Array.isArray(previous.desired)
            ? previous.desired.slice(0, PHISH_HOST_HARD_LIMIT)
            : [];
        const changed = JSON.stringify(oldDesired) !== JSON.stringify(desired);
        const needsRepush = now - Number(previous.ts || 0) >= PHISH_REPUSH_MS;
        const heartbeatHosts = readPhishHeartbeats().map(function (heartbeat) {
            return heartbeat.host;
        });
        const needsHeartbeatCorrection = heartbeatHosts.some(function (host) {
            return !desired.includes(host);
        });
        if (!changed && !needsRepush && !needsHeartbeatCorrection) {
            return previous;
        }

        const plan = {
            desired: desired,
            ts: now,
            maxHosts: configuredPhishHosts,
            version: VERSION,
            reason: overloaded
                ? "crawler-stack-circuit-breaker"
                : configuredPhishHosts === 0
                  ? "disabled"
                  : "bounded",
        };
        await ns.write(PHISH_PLAN, JSON.stringify(plan), "w");

        const targets = Array.from(
            new Set((changed ? oldDesired : []).concat(desired, heartbeatHosts))
        );
        for (const target of targets) {
            const report = latest.get(target);
            const entry = db[target];
            const password =
                report && typeof report.password === "string"
                    ? report.password
                    : entry && entry.password;
            if (typeof password !== "string") continue;
            await pushPhishPlanFiles(target, password);
        }

        if (changed) {
            log(
                "Phishing plan -> [" +
                    desired.join(", ") +
                    "] (hard cap " +
                    PHISH_HOST_HARD_LIMIT +
                    ").",
                false
            );
        }
        return plan;
    }

    async function updateStasisPlan(db, reports) {
        let limit;
        try {
            limit = ns.dnet.getStasisLinkLimit();
        } catch {
            return;
        }

        const now = Date.now();
        const latest = new Map();
        for (const r of reports) {
            if (!r || !r.host || r.host === "darkweb" || r.isStationary)
                continue;
            if (now - Number(r.ts || 0) > REPORT_FRESH_MS) continue;
            const old = latest.get(r.host);
            if (!old || Number(r.ts || 0) > Number(old.ts || 0))
                latest.set(r.host, r);
        }

        const candidates = Array.from(latest.values()).sort(function (a, b) {
            const ramDelta = Number(b.maxRam || 0) - Number(a.maxRam || 0);
            if (ramDelta !== 0) return ramDelta;
            const blocked =
                Number(a.blockedRam || 0) - Number(b.blockedRam || 0);
            if (blocked !== 0) return blocked;
            return Number(b.depth || -1) - Number(a.depth || -1);
        });
        const desired = candidates
            .slice(0, Math.max(0, limit))
            .map(function (r) {
                return r.host;
            });

        let previous = { desired: [], ts: 0 };
        try {
            const raw = ns.read(PLAN);
            if (raw) previous = JSON.parse(raw);
        } catch {
            // Intentionally ignored: this operation is best-effort.
        }
        const oldDesired = Array.isArray(previous.desired)
            ? previous.desired
            : [];
        const changed = JSON.stringify(oldDesired) !== JSON.stringify(desired);
        const needsRepush = now - Number(previous.ts || 0) >= STASIS_REPUSH_MS;
        if (!changed && !needsRepush) return;

        await ns.write(
            PLAN,
            JSON.stringify({ desired: desired, ts: now }),
            "w"
        );
        let linked = [];
        try {
            linked = ns.dnet.getStasisLinkedServers(false);
        } catch {
            // Intentionally ignored: this operation is best-effort.
        }
        const targets = Array.from(new Set(desired.concat(linked)));
        for (const h of targets) {
            const report = latest.get(h);
            const entry = db[h];
            const password =
                report && typeof report.password === "string"
                    ? report.password
                    : entry && entry.password;
            if (typeof password !== "string") continue;
            await pushPlanFiles(h, password);
        }
        if (changed) log("Stasis plan -> [" + desired.join(", ") + "]", false);
    }

    async function summary(db, reports) {
        const now = Date.now();
        const latest = new Map();
        for (const r of reports) {
            if (!r || !r.host || now - Number(r.ts || 0) > REPORT_FRESH_MS)
                continue;
            const old = latest.get(r.host);
            if (!old || Number(r.ts || 0) > Number(old.ts || 0))
                latest.set(r.host, r);
        }
        const list = Array.from(latest.values());
        const totalRam = list.reduce(function (sum, r) {
            return sum + Number(r.maxRam || 0);
        }, 0);
        let linked = [];
        try {
            linked = ns.dnet.getStasisLinkedServers(false);
        } catch {
            // Intentionally ignored: this operation is best-effort.
        }
        let ramText = String(totalRam) + " GB";
        try {
            ramText = ns.format.ram(totalRam);
        } catch {
            // Intentionally ignored: this operation is best-effort.
        }
        const phishPlan = readCurrentPhishPlan();
        const phishHeartbeats = readPhishHeartbeats();
        const phishHostsRunning = phishHeartbeats.map(function (heartbeat) {
            return heartbeat.host;
        });
        const phishThreads = phishHeartbeats.reduce(function (
            total,
            heartbeat
        ) {
            return total + Number(heartbeat.threads || 0);
        }, 0);
        const phishAttackCycles = phishHeartbeats.reduce(function (
            total,
            heartbeat
        ) {
            return total + Number(heartbeat.attackCycles || 0);
        }, 0);
        const phishSuccessfulAttacks = phishHeartbeats.reduce(function (
            total,
            heartbeat
        ) {
            return total + Number(heartbeat.successfulAttacks || 0);
        }, 0);
        const phishCharismaXp = phishHeartbeats.reduce(function (
            total,
            heartbeat
        ) {
            return total + Number(heartbeat.charismaXpEarned || 0);
        }, 0);
        const unauthorizedPhishHeartbeats = phishHeartbeats
            .filter(function (heartbeat) {
                return !phishPlan.desired.includes(heartbeat.host);
            })
            .map(function (heartbeat) {
                return heartbeat.host;
            });
        const activeCrawlReports = list.filter(function (report) {
            return report.agentVersion === VERSION && !report.completed;
        });
        const passwordAuthCalls = list.reduce(function (sum, report) {
            return sum + Number(report.authAttempts || 0);
        }, 0);
        const passwordAuthSuccesses = list.reduce(function (sum, report) {
            return sum + Number(report.authSuccesses || 0);
        }, 0);
        const passwordAuthFailures = list.reduce(function (sum, report) {
            return sum + Number(report.authFailures || 0);
        }, 0);
        const passwordAuthTimeouts = list.reduce(function (sum, report) {
            return sum + Number(report.authTimeouts || 0);
        }, 0);
        const phases = {};
        for (const report of list) {
            const name = String(report.phase || "unknown");
            phases[name] = Number(phases[name] || 0) + 1;
        }

        const status = {
            version: VERSION,
            ts: now,
            charisma: Number(ns.getPlayer().skills.charisma || 0),
            activeAgents: activeCrawlReports.length,
            crawlerStack: activeCrawlReports.length,
            crawlerStackLimit: MAX_CRAWL_STACK,
            freshHosts: list.length,
            discoveredHosts: Object.keys(db).length,
            knownHosts: Object.keys(db).length,
            knownPasswords: Object.keys(db).length,
            discoveredRam: totalRam,
            managedProcessesReported: list.reduce(function (sum, report) {
                return sum + Number(report.managedProcesses || 0);
            }, 0),
            phishPlan: phishPlan,
            phishHostsReported: phishHostsRunning,
            phishThreadsReported: phishThreads,
            phishAttackCyclesReported: phishAttackCycles,
            phishSuccessfulAttacksReported: phishSuccessfulAttacks,
            phishCharismaXpReported: phishCharismaXp,
            phishTelemetry: "worker-heartbeat",
            phishHeartbeats: phishHeartbeats,
            unauthorizedPhishHeartbeats: unauthorizedPhishHeartbeats,
            passwordAuthCallsReported: passwordAuthCalls,
            passwordAuthSuccessesReported: passwordAuthSuccesses,
            passwordAuthFailuresReported: passwordAuthFailures,
            passwordAuthTimeoutsReported: passwordAuthTimeouts,
            phases: phases,
            stasis: linked,
            agents: list.map(function (report) {
                return {
                    host: report.host,
                    ts: Number(report.ts || 0),
                    phase: String(report.phase || ""),
                    activeTarget: String(report.activeTarget || ""),
                    authAttempts: Number(report.authAttempts || 0),
                    authSuccesses: Number(report.authSuccesses || 0),
                    authFailures: Number(report.authFailures || 0),
                    authTimeouts: Number(report.authTimeouts || 0),
                    loopCount: Number(report.loopCount || 0),
                    crawlId: String(report.crawlId || ""),
                    crawlDepth: Number(report.crawlDepth || 0),
                    completed: !!report.completed,
                    phishPid: Number(report.phishPid || 0),
                    phishThreads: Number(report.phishThreads || 0),
                    modelId: String(report.modelId || ""),
                    error: String(report.error || ""),
                };
            }),
        };
        try {
            await ns.write(STATUS_FILE, JSON.stringify(status, null, 2), "w");
        } catch {
            // Intentionally ignored: terminal summary still works.
        }

        log(
            "crawler stack=" +
                activeCrawlReports.length +
                "/" +
                MAX_CRAWL_STACK +
                " | fresh hosts=" +
                list.length +
                " | known passwords=" +
                Object.keys(db).length +
                " | password auth=" +
                passwordAuthCalls +
                " calls (" +
                passwordAuthSuccesses +
                " success, " +
                passwordAuthFailures +
                " wrong, " +
                passwordAuthTimeouts +
                " timeout)" +
                " | discovered Dark Net RAM=" +
                ramText +
                " | phishing=" +
                phishHostsRunning.length +
                "/" +
                configuredPhishHosts +
                " hosts (" +
                phishThreads +
                " threads, " +
                phishAttackCycles +
                " attack cycles, " +
                phishSuccessfulAttacks +
                " successful, " +
                Math.round(phishCharismaXp).toLocaleString("en-US") +
                " CHA XP since worker start; heartbeat)" +
                (unauthorizedPhishHeartbeats.length > 0
                    ? " | phish safety correction=" +
                      unauthorizedPhishHeartbeats.join(",")
                    : "") +
                " | stasis=" +
                linked.length +
                " [" +
                linked.join(", ") +
                "]",
            false
        );
    }

    await enforceSingleManager();
    await writeWorkers();
    const agentRam = ns.getScriptRam(AGENT, "home");
    const db = loadDb();
    clearPhishHeartbeats();
    await resetPhishPlan();
    const stoppedLegacyPhish = stopKnownPhishing(db);
    log("Dark Net manager started. Persistent credential DB: " + DB_FILE, true);
    log(
        "Generated bounded crawler/RAM/loot/phishing/stasis workers automatically under /Temp.",
        true
    );
    log(
        "Crawler safety: one advancing branch, stack hard cap " +
            MAX_CRAWL_STACK +
            ", " +
            Math.floor(CRAWL_RESTART_DELAY_MS / 1000) +
            " second rescan delay.",
        true
    );
    log(
        "Phishing safety: " +
            configuredPhishHosts +
            " authorized host(s) maximum, 5-8 second worker cooldown; " +
            "direct worker heartbeat telemetry." +
            (stoppedLegacyPhish > 0
                ? " Stopped " +
                  stoppedLegacyPhish +
                  " pre-existing phishing process(es)."
                : ""),
        true
    );
    log(
        "Generated crawler RAM: " +
            ns.format.ram(agentRam) +
            " (darkweb capacity: 16 GB).",
        true
    );
    try {
        const dwMax = ns.getServerMaxRam("darkweb");
        const dwUsed = ns.getServerUsedRam("darkweb");
        log(
            "darkweb RAM now: max=" +
                ns.format.ram(dwMax) +
                " | used=" +
                ns.format.ram(dwUsed) +
                " | free=" +
                ns.format.ram(Math.max(0, dwMax - dwUsed)) +
                ".",
            true
        );
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }

    if (!(agentRam > 0) || agentRam > 16) {
        log(
            "ERROR: generated crawler exceeds the 16 GB darkweb gateway limit; refusing to start.",
            true
        );
        return;
    }

    let lastStasis = 0;
    let lastPhish = 0;
    let lastSummary = 0;
    let lastWorkerRefresh = Date.now();
    let warnedNoDnet = false;

    for (;;) {
        try {
            let dnetAvailable = true;
            try {
                ns.dnet.probe();
            } catch {
                dnetAvailable = false;
            }

            if (!dnetAvailable) {
                if (!warnedNoDnet) {
                    log(
                        "Dark Net API unavailable. Buy TOR + DarkscapeNavigator.exe; retrying automatically.",
                        true
                    );
                    warnedNoDnet = true;
                }
                await ns.sleep(10000);
                continue;
            }
            warnedNoDnet = false;

            if (Date.now() - lastWorkerRefresh >= WORKER_REFRESH_MS) {
                await writeWorkers();
                lastWorkerRefresh = Date.now();
            }

            const reports = readReports();
            await ingestReports(db, reports);
            await seedDarkweb(reports);

            if (Date.now() - lastPhish >= PHISH_REFRESH_MS) {
                await updatePhishingPlan(db, reports);
                lastPhish = Date.now();
            }

            if (Date.now() - lastStasis >= STASIS_REFRESH_MS) {
                await updateStasisPlan(db, reports);
                lastStasis = Date.now();
            }

            if (Date.now() - lastSummary >= SUMMARY_INTERVAL_MS) {
                await summary(db, reports);
                lastSummary = Date.now();
            }
        } catch (e) {
            log("Suppressed manager error: " + String(e), false);
        }

        await ns.sleep(5000);
    }
}

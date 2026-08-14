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
    const VERSION = "1.0.3";

    const AGENT = "/Temp/dnet-agent.js";
    const PHISH = "/Temp/dnet-phish.js";
    const PHISH_LAUNCHER = "/Temp/dnet-phish-launcher.js";
    const RAM_WORKER = "/Temp/dnet-ram-worker.js";
    const STASIS = "/Temp/dnet-stasis.js";
    const LOOT = "/Temp/dnet-loot.js";
    const PLAN = "/Temp/dnet-stasis-plan.txt";
    const DB_FILE = "darknet-passwords.txt";
    const REPORT_PREFIX = "/Temp/dnet-report-";

    const REPORT_FRESH_MS = 120000;
    const STASIS_REFRESH_MS = 15000;
    const SUMMARY_INTERVAL_MS = 30000;
    const WORKER_REFRESH_MS = 60000;

    // Keep all generated-worker code free of template literals so it can live safely
    // inside these String.raw blocks.
    const PHISH_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    while (true) {
        try {
            await ns.dnet.phishingAttack();
        } catch {
            await ns.sleep(1000);
        }
    }
}
`;

    const RAM_WORKER_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    let unchanged = 0;
    let lastBlocked = Number.POSITIVE_INFINITY;

    while (true) {
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

    const STASIS_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    const shouldLink = String(ns.args[0] ?? "1") !== "0";
    try { await ns.dnet.setStasisLink(shouldLink); }
    catch { }
}
`;

    const LOOT_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    const host = ns.getHostname();

    try {
        const caches = ns.ls(host, ".cache");
        for (const cache of caches) {
            try { ns.dnet.openCache(cache, true); }
            catch { }
        }
    } catch { }

    try {
        const files = ns.ls(host).filter(function (f) {
            return !f.startsWith("/Temp/dnet-") &&
                   !f.endsWith(".cache") &&
                   f !== "darknet-passwords.txt";
        });

        for (const file of files) {
            try { await ns.scp(file, "home", host); }
            catch { }

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
                } catch { }
            }
        }
    } catch { }
}
`;

    const PHISH_LAUNCHER_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    const PHISH = "/Temp/dnet-phish.js";
    const host = ns.getHostname();

    try {
        if (ns.ps(host).some(function (p) { return p.filename === PHISH; })) return;

        const ram = ns.getScriptRam(PHISH, host);
        if (!(ram > 0)) return;

        const free = Math.max(
            0,
            ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
        );

        const threads = Math.floor(free / ram);
        if (threads > 0) ns.exec(PHISH, host, threads);
    } catch { }
}
`;

    const AGENT_SOURCE = String.raw`
/** @param {NS} ns */
export async function main(ns) {
    const AGENT = "/Temp/dnet-agent.js";
    const PHISH = "/Temp/dnet-phish.js";
    const PHISH_LAUNCHER = "/Temp/dnet-phish-launcher.js";
    const RAM_WORKER = "/Temp/dnet-ram-worker.js";
    const STASIS = "/Temp/dnet-stasis.js";
    const LOOT = "/Temp/dnet-loot.js";
    const PLAN = "/Temp/dnet-stasis-plan.txt";
    const DB_FILE = "darknet-passwords.txt";
    const REPORT_PREFIX = "/Temp/dnet-report-";

    const host = ns.getHostname();
    const selfPassword = String(ns.args[0] ?? "");
    const REPORT_INTERVAL = 7000;
    const MAX_AUTH_RETRIES = 4;
    const MAX_BRUTE_ATTEMPTS = 1000;
    const PHISH_UTILIZATION = 0.90;

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
        if (foundCredentials.length > 200) foundCredentials.shift();
    }

    function readLocalDbCandidate(server) {
        try {
            const raw = ns.read(DB_FILE);
            if (!raw) return null;
            const db = JSON.parse(raw);
            if (db && db[server] && typeof db[server].password === "string") return db[server].password;
        } catch { }
        return null;
    }

    function parsePasswordResponse(line) {
        if (typeof line !== "string") return null;
        try {
            const obj = JSON.parse(line);
            if (obj && typeof obj === "object" && "passwordAttempted" in obj) return obj;
        } catch { }
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

    async function heartbleedFeedback(target, attempted, count) {
        try {
            const hb = await ns.dnet.heartbleed(target, { peek: false, logsToCapture: count || 3 });
            if (!hb || !hb.success || !Array.isArray(hb.logs)) return null;
            harvestRawLogCredentials(target, hb.logs);
            for (const line of hb.logs) {
                const obj = parsePasswordResponse(line);
                if (obj && String(obj.passwordAttempted) === String(attempted)) return obj;
            }
        } catch { }
        return null;
    }

    async function attempt(target, password, wantFeedback) {
        password = String(password);
        let last = null;
        for (let retry = 0; retry < MAX_AUTH_RETRIES; retry++) {
            try {
                const r = await ns.dnet.authenticate(target, password);
                last = r;
                if (r && r.success) return { success: true, password: password, feedback: null };
                // 408 = Request Timeout. Retry without consuming puzzle logic.
                if (r && r.code === 408) continue;
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
            const r = await attempt(target, candidate, false);
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
        try { n = BigInt(String(value).trim()); }
        catch { return null; }
        if (n < 2n) return n.toString();
        let largest = 1n;
        while (n % 2n === 0n) { largest = 2n; n /= 2n; }
        let f = 3n;
        while (f * f <= n) {
            while (n % f === 0n) { largest = f; n /= f; }
            f += 2n;
        }
        if (n > 1n) largest = n;
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
        function number() {
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
            let v = number();
            while (true) {
                skip();
                const op = expr[i];
                if (op !== "*" && op !== "/") break;
                i++;
                const rhs = number();
                v = op === "*" ? v * rhs : v / rhs;
            }
            return v;
        }
        function addsub() {
            let v = muldiv();
            while (true) {
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
            const r = await attempt(target, c.repeat(n), true);
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
                const r = await attempt(target, guess.join(""), true);
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
        const r = await attempt(target, final, false);
        return r.success ? final : null;
    }

    async function solveYesnt(target, details) {
        const n = details.passwordLength;
        const charset = charsetFor(details.passwordFormat);
        const result = Array(n).fill(null);
        for (const c of charset) {
            const r = await attempt(target, c.repeat(n), true);
            if (r.success) return c.repeat(n);
            if (!r.feedback || typeof r.feedback.data !== "string") return null;
            const flags = r.feedback.data.split(",");
            for (let i = 0; i < Math.min(n, flags.length); i++) {
                if (flags[i] === "yes") result[i] = c;
            }
            if (result.every(function (x) { return x !== null; })) break;
        }
        if (result.some(function (x) { return x === null; })) return null;
        const final = result.join("");
        const r = await attempt(target, final, false);
        return r.success ? final : null;
    }

    async function solveSortedEcho(target, details) {
        const n = details.passwordLength;
        if (details.passwordFormat !== "numeric") return null;
        const zero = "0".repeat(n);
        const base = await attempt(target, zero, true);
        if (base.success) return zero;
        const rms0 = parseRms(base.feedback);
        if (!Number.isFinite(rms0)) return null;
        const sse0 = rms0 * rms0 * n;
        const digits = [];
        for (let pos = 0; pos < n; pos++) {
            const chars = Array(n).fill("0");
            chars[pos] = "9";
            const guess = chars.join("");
            const r = await attempt(target, guess, true);
            if (r.success) return guess;
            const rms = parseRms(r.feedback);
            if (!Number.isFinite(rms)) return null;
            const sse = rms * rms * n;
            const actual = Math.max(0, Math.min(9, Math.round((81 - (sse - sse0)) / 18)));
            digits.push(String(actual));
        }
        const final = digits.join("");
        const r = await attempt(target, final, false);
        return r.success ? final : null;
    }

    async function solveGuessNumber(target, details, low, high, romanMode) {
        low = Math.max(0, Math.floor(low));
        high = Math.max(low, Math.floor(high));
        for (let steps = 0; steps < 80 && low <= high; steps++) {
            const mid = Math.floor((low + high) / 2);
            const pw = String(mid);
            const r = await attempt(target, pw, true);
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
                const r = await attempt(target, guess, true);
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
        const r = await attempt(target, prefix, false);
        return r.success ? prefix : null;
    }

    async function solveDivisibility(target, details) {
        let r = await attempt(target, "1", true);
        if (r.success) return "1";
        let product = 1n;
        const primes = SMALL_PRIMES.concat(LARGE_PRIMES);
        const maxValue = 10n ** BigInt(Math.max(1, details.passwordLength));
        for (const prime of primes) {
            const p = BigInt(prime);
            let power = p;
            let exponent = 0;
            while (power <= maxValue) {
                r = await attempt(target, power.toString(), true);
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
        r = await attempt(target, candidate, false);
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
            const r = await attempt(target, String(m), true);
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
        const r = await attempt(target, candidate, false);
        return r.success ? candidate : null;
    }

    async function solvePacketSniffer(target, details) {
        // First intentionally fail once to force packet data into an auth log.
        await attempt(target, "", true);
        for (let round = 0; round < 20; round++) {
            try {
                const hb = await ns.dnet.heartbleed(target, { peek: false, logsToCapture: 8 });
                if (hb && hb.success && Array.isArray(hb.logs)) {
                    harvestRawLogCredentials(target, hb.logs);
                    for (const line of hb.logs) {
                        if (typeof line !== "string") continue;
                        const escaped = target.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
                        const named = line.match(new RegExp(escaped + ":([^\\s]+)"));
                        if (named) {
                            const r = await attempt(target, named[1], false);
                            if (r.success) return named[1];
                        }
                        const pass = line.match(/Logging in with passcode:\s*([^\s]+)\s*\.\.\./i);
                        if (pass) {
                            const r = await attempt(target, pass[1], false);
                            if (r.success) return pass[1];
                        }
                    }
                }
            } catch { }
            await ns.sleep(500);
        }
        return null;
    }

    async function genericNumericBrute(target, details) {
        if (details.passwordFormat !== "numeric" || details.passwordLength > 3) return null;
        const max = Math.min(MAX_BRUTE_ATTEMPTS, Math.pow(10, details.passwordLength));
        for (let i = 0; i < max; i++) {
            const candidate = String(i).padStart(details.passwordLength, "0");
            const r = await attempt(target, candidate, false);
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
        cooldownUntil.set(target, Date.now() + 30000);
        return null;
    }

    async function fullyReallocate(target) {
        let pid = 0;
        try { pid = ns.exec(RAM_WORKER, target, 1); }
        catch { pid = 0; }

        if (pid === 0) return;

        for (let i = 0; i < 1200; i++) {
            let blocked = 0;
            try { blocked = ns.dnet.getBlockedRam(target); }
            catch { return; }

            if (!(blocked > 0)) return;
            await ns.sleep(250);
        }
    }

    async function deployChild(target, password) {
        try {
            await ns.scp(
                [AGENT, PHISH, PHISH_LAUNCHER, RAM_WORKER, STASIS, LOOT, PLAN, DB_FILE],
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
            for (let i = 0; i < 600; i++) {
                let running = false;
                try {
                    running = ns.ps(target).some(function (p) { return p.pid === lootPid; });
                } catch { }
                if (!running) break;
                await ns.sleep(50);
            }
        }

        try {
            const existing = ns.ps(target).some(function (p) {
                return p.filename === AGENT;
            });
            if (existing) return true;
        } catch { }

        try { return ns.exec(AGENT, target, 1, password) !== 0; }
        catch { return false; }
    }

    async function lootSelf() {
        try {
            const running = ns.ps(host).some(function (p) {
                return p.filename === LOOT;
            });
            if (!running) ns.exec(LOOT, host, 1);
        } catch { }
    }

    function readPlan() {
        try {
            const raw = ns.read(PLAN);
            if (!raw) return null;
            const p = JSON.parse(raw);
            return p && Array.isArray(p.desired) ? p : null;
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
        } catch { }

        return false;
    }

    function ensurePhishing() {
        try {
            const busy = ns.ps(host).some(function (p) {
                return p.filename === PHISH || p.filename === PHISH_LAUNCHER;
            });
            if (!busy) ns.exec(PHISH_LAUNCHER, host, 1);
        } catch { }
    }

    async function saveReport(errorText) {
        try {
            const details = getDetails(host);
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
                requiredCharismaSkill: details ? Number(details.requiredCharismaSkill ?? -1) : -1,
                isStationary: details ? !!details.isStationary : false,
                neighbors: safeProbe(),
                found: foundCredentials.slice(-100),
                error: errorText ? String(errorText) : ""
            };
            const file = reportFileFor(host);
            await ns.write(file, JSON.stringify(report), "w");
            await ns.scp(file, "home", host);
            lastReport = Date.now();
        } catch { }
    }

    while (true) {
        try {
            await lootSelf();

            if (await maybeToggleStasis()) return;

            const neighbors = safeProbe();
            for (const target of neighbors) {
                if (target === host) continue;
                let alreadyRunning = false;
                try { alreadyRunning = ns.ps(target).some(function (p) { return p.filename === AGENT; }); }
                catch { }
                if (alreadyRunning) continue;

                const password = await solveTarget(target);
                if (password === null) continue;
                await deployChild(target, password);
            }

            ensurePhishing();
            if (Date.now() - lastReport >= REPORT_INTERVAL) await saveReport("");
        } catch (e) {
            await saveReport(String(e));
        }

        try {
            // Wake quickly enough to catch mutations but don't busy-loop.
            await ns.sleep(1500);
        } catch { }
    }
}
`;

    function log(message, terminal) {
        const text = "[DNET " + VERSION + "] " + message;
        ns.print(text);
        if (terminal) ns.tprint(text);
    }

    async function writeWorkers() {
        await ns.write(AGENT, AGENT_SOURCE, "w");
        await ns.write(PHISH, PHISH_SOURCE, "w");
        await ns.write(PHISH_LAUNCHER, PHISH_LAUNCHER_SOURCE, "w");
        await ns.write(RAM_WORKER, RAM_WORKER_SOURCE, "w");
        await ns.write(STASIS, STASIS_SOURCE, "w");
        await ns.write(LOOT, LOOT_SOURCE, "w");
        if (!ns.fileExists(PLAN, "home")) await ns.write(PLAN, JSON.stringify({ desired: [], ts: Date.now() }), "w");
        if (!ns.fileExists(DB_FILE, "home")) await ns.write(DB_FILE, "{}", "w");
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
        for (const file of ns.ls("home", REPORT_PREFIX)) {
            try {
                const r = JSON.parse(ns.read(file));
                if (r && r.host) {
                    try { r.maxRam = ns.getServerMaxRam(r.host); } catch { }
                    reports.push(r);
                }
            } catch { }
        }
        return reports;
    }

    async function ingestReports(db, reports) {
        let changed = false;
        for (const r of reports) {
            if (r && r.host && typeof r.password === "string") {
                const old = db[r.host];
                if (!old || old.password !== r.password || Number(r.ts || 0) > Number(old.lastSeen || 0)) {
                    db[r.host] = {
                        password: r.password,
                        lastSeen: Number(r.ts || Date.now()),
                        maxRam: Number(r.maxRam || 0),
                        depth: Number(r.depth ?? -1),
                        modelId: String(r.modelId || "")
                    };
                    changed = true;
                }
            }
            if (r && Array.isArray(r.found)) {
                for (const f of r.found) {
                    if (!f || !f.host || typeof f.password !== "string") continue;
                    const old = db[f.host];
                    if (!old || old.password !== f.password || Number(f.ts || 0) > Number(old.lastSeen || 0)) {
                        db[f.host] = {
                            password: f.password,
                            lastSeen: Number(f.ts || Date.now()),
                            maxRam: old ? Number(old.maxRam || 0) : 0,
                            depth: old ? Number(old.depth ?? -1) : -1,
                            modelId: String(f.modelId || (old ? old.modelId || "" : ""))
                        };
                        changed = true;
                    }
                }
            }
        }
        if (changed) await saveDb(db);
    }

    async function seedDarkweb() {
        try {
            if (ns.ps("darkweb").some(function (p) { return p.filename === AGENT; })) return true;
        } catch { }

        let auth = null;
        try { auth = await ns.dnet.authenticate("darkweb", ""); }
        catch { return false; }
        if (!auth || !auth.success) return false;

        try {
            await ns.scp([AGENT, PHISH, PHISH_LAUNCHER, RAM_WORKER, STASIS, LOOT, PLAN, DB_FILE], "darkweb", "home");
            const pid = ns.exec(AGENT, "darkweb", 1, "");
            if (pid) log("Seeded recursive crawler on darkweb (PID " + pid + ").", false);
            return pid !== 0;
        } catch {
            return false;
        }
    }

    async function pushControlFiles(host, password) {
        try {
            const session = ns.dnet.connectToSession(host, password);
            if (!session || !session.success) return false;
            await ns.scp([AGENT, PHISH, PHISH_LAUNCHER, RAM_WORKER, STASIS, LOOT, PLAN, DB_FILE], host, "home");
            return true;
        } catch {
            return false;
        }
    }

    async function updateStasisPlan(db, reports) {
        let limit = 0;
        try { limit = ns.dnet.getStasisLinkLimit(); }
        catch { return; }

        const now = Date.now();
        const latest = new Map();
        for (const r of reports) {
            if (!r || !r.host || r.host === "darkweb" || r.isStationary) continue;
            if (now - Number(r.ts || 0) > REPORT_FRESH_MS) continue;
            const old = latest.get(r.host);
            if (!old || Number(r.ts || 0) > Number(old.ts || 0)) latest.set(r.host, r);
        }

        const candidates = Array.from(latest.values()).sort(function (a, b) {
            const ram = Number(b.maxRam || 0) - Number(a.maxRam || 0);
            if (ram !== 0) return ram;
            return Number(b.depth || -1) - Number(a.depth || -1);
        });
        const desired = candidates.slice(0, Math.max(0, limit)).map(function (r) { return r.host; });
        await ns.write(PLAN, JSON.stringify({ desired: desired, ts: now }), "w");

        // A session is enough to SCP the plan at any distance. Each running agent
        // then applies/removes stasis locally so remote-exec restrictions don't matter.
        for (const r of candidates) {
            const entry = db[r.host];
            const password = typeof r.password === "string" ? r.password : entry && entry.password;
            if (typeof password !== "string") continue;
            await pushControlFiles(r.host, password);
        }

        // Also push the plan to currently linked servers even if their report just became stale,
        // so obsolete stasis links can remove themselves.
        let linked = [];
        try { linked = ns.dnet.getStasisLinkedServers(false); } catch { }
        for (const h of linked) {
            if (candidates.some(function (r) { return r.host === h; })) continue;
            const entry = db[h];
            if (!entry || typeof entry.password !== "string") continue;
            await pushControlFiles(h, entry.password);
        }
    }

    function summary(db, reports) {
        const now = Date.now();
        const latest = new Map();
        for (const r of reports) {
            if (!r || !r.host || now - Number(r.ts || 0) > REPORT_FRESH_MS) continue;
            const old = latest.get(r.host);
            if (!old || Number(r.ts || 0) > Number(old.ts || 0)) latest.set(r.host, r);
        }
        const list = Array.from(latest.values());
        const totalRam = list.reduce(function (sum, r) { return sum + Number(r.maxRam || 0); }, 0);
        let linked = [];
        try { linked = ns.dnet.getStasisLinkedServers(false); } catch { }
        let ramText = String(totalRam) + " GB";
        try { ramText = ns.format.ram(totalRam); } catch { }
        log("active agents=" + list.length +
            " | known passwords=" + Object.keys(db).length +
            " | discovered Dark Net RAM=" + ramText +
            " | stasis=" + linked.length + " [" + linked.join(", ") + "]", false);
    }

    await writeWorkers();
    const agentRam = ns.getScriptRam(AGENT, "home");
    const db = loadDb();
    log("Dark Net manager started. Persistent credential DB: " + DB_FILE, true);
    log("Generated crawler/RAM/loot/phishing/stasis workers automatically under /Temp.", true);
    log("Generated crawler RAM: " + ns.format.ram(agentRam) + " (darkweb capacity: 16 GB).", true);

    if (!(agentRam > 0) || agentRam > 16) {
        log("ERROR: generated crawler exceeds the 16 GB darkweb gateway limit; refusing to retry-loop.", true);
        return;
    }

    let lastStasis = 0;
    let lastSummary = 0;
    let lastWorkerRefresh = Date.now();
    let warnedNoDnet = false;

    while (true) {
        try {
            let dnetAvailable = true;
            try { ns.dnet.probe(); } catch { dnetAvailable = false; }

            if (!dnetAvailable) {
                if (!warnedNoDnet) {
                    log("Dark Net API unavailable. Buy TOR + DarkscapeNavigator.exe; retrying automatically.", true);
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

            await seedDarkweb();
            const reports = readReports();
            await ingestReports(db, reports);

            if (Date.now() - lastStasis >= STASIS_REFRESH_MS) {
                await updateStasisPlan(db, reports);
                lastStasis = Date.now();
            }

            if (Date.now() - lastSummary >= SUMMARY_INTERVAL_MS) {
                summary(db, reports);
                lastSummary = Date.now();
            }
        } catch (e) {
            log("Suppressed manager error: " + String(e), false);
        }

        await ns.sleep(2000);
    }
}

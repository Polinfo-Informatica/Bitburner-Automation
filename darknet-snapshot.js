/**
 * darknet-snapshot.js
 * One-shot process/report snapshot for Dark Net runtime diagnosis.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    try {
        ns.disableLog("ALL");
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }

    const VERSION = "1.2.1";
    const MAX_CRAWL_STACK = 17;
    const DB_FILE = "darknet-passwords.txt";
    const REPORT_PREFIX = "/Temp/dnet-report-";
    const PHISH_PLAN = "/Temp/dnet-phish-plan.txt";
    const STATUS_FILE = "darknet-runtime-status.txt";
    const OUTPUT_FILE = "darknet-diagnostic-snapshot.txt";
    const MANAGER = "darknet-manager.js";
    const MANAGED = new Set([
        "/Temp/dnet-agent.js",
        "/Temp/dnet-phish.js",
        "/Temp/dnet-phish-launcher.js",
        "/Temp/dnet-ram-launcher.js",
        "/Temp/dnet-ram-worker.js",
        "/Temp/dnet-stasis.js",
        "/Temp/dnet-loot.js",
    ]);

    function readJson(file, fallback) {
        try {
            const raw = ns.read(file);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    const now = Date.now();
    const db = readJson(DB_FILE, {});
    const plan = readJson(PHISH_PLAN, { desired: [], ts: 0 });
    const lastManagerStatus = readJson(STATUS_FILE, null);
    const targets = new Set(["home", "darkweb"]);
    if (db && typeof db === "object") {
        for (const host of Object.keys(db)) targets.add(host);
    }

    const reports = [];
    try {
        for (const file of ns.ls("home", REPORT_PREFIX)) {
            const report = readJson(file, null);
            if (!report || typeof report.host !== "string") continue;
            reports.push(report);
            targets.add(report.host);
        }
    } catch {
        // Intentionally ignored: process inspection can still proceed.
    }

    const counts = {
        managers: 0,
        agents: 0,
        phishing: 0,
        phishLaunchers: 0,
        ramLaunchers: 0,
        ramWorkers: 0,
        stasis: 0,
        loot: 0,
        totalManaged: 0,
        phishThreads: 0,
    };
    const hostProcesses = [];
    const agentVersions = {};
    const activeCrawlIds = new Set();
    const unauthorizedPhishHosts = [];
    const desired =
        plan && Array.isArray(plan.desired) ? plan.desired.slice() : [];

    for (const host of targets) {
        let processes;
        try {
            processes = ns.ps(host);
        } catch {
            hostProcesses.push({ host: host, unavailable: true, managed: [] });
            continue;
        }

        const managed = [];
        for (const process of processes) {
            if (host === "home" && process.filename === MANAGER) {
                counts.managers++;
                managed.push({
                    filename: process.filename,
                    pid: process.pid,
                    threads: process.threads,
                    args: process.args,
                });
                continue;
            }
            if (!MANAGED.has(process.filename)) continue;
            counts.totalManaged++;
            managed.push({
                filename: process.filename,
                pid: process.pid,
                threads: process.threads,
                args: process.args,
            });
            if (process.filename === "/Temp/dnet-agent.js") {
                counts.agents++;
                const agentVersion = String(
                    (process.args && process.args[1]) || "unknown"
                );
                agentVersions[agentVersion] =
                    Number(agentVersions[agentVersion] || 0) + 1;
                const crawlId = String(
                    (process.args && process.args[2]) || "unknown"
                );
                activeCrawlIds.add(crawlId);
            } else if (process.filename === "/Temp/dnet-phish.js") {
                counts.phishing++;
                counts.phishThreads += Number(process.threads || 0);
                if (!desired.includes(host)) unauthorizedPhishHosts.push(host);
            } else if (process.filename === "/Temp/dnet-phish-launcher.js") {
                counts.phishLaunchers++;
            } else if (process.filename === "/Temp/dnet-ram-launcher.js") {
                counts.ramLaunchers++;
            } else if (process.filename === "/Temp/dnet-ram-worker.js") {
                counts.ramWorkers++;
            } else if (process.filename === "/Temp/dnet-stasis.js") {
                counts.stasis++;
            } else if (process.filename === "/Temp/dnet-loot.js") {
                counts.loot++;
            }
        }
        if (managed.length > 0)
            hostProcesses.push({ host: host, managed: managed });
    }

    let charisma = 0;
    try {
        charisma = Number(ns.getPlayer().skills.charisma || 0);
    } catch {
        // Intentionally ignored: all other snapshot fields remain useful.
    }

    const freshReports = reports.filter(function (report) {
        return now - Number(report.ts || 0) <= 180000;
    });
    const phaseCounts = {};
    for (const report of freshReports) {
        const phase = String(report.phase || "unknown");
        phaseCounts[phase] = Number(phaseCounts[phase] || 0) + 1;
    }

    const warnings = [];
    if (counts.managers > 1) warnings.push("multiple managers");
    if (counts.agents > MAX_CRAWL_STACK) {
        warnings.push("crawler stack hard cap exceeded");
    }
    if (activeCrawlIds.size > 1) {
        warnings.push("overlapping crawler generations");
    }
    if (counts.phishing > 4) warnings.push("phishing host hard cap exceeded");
    if (desired.length > 4) warnings.push("phishing plan hard cap exceeded");
    if (unauthorizedPhishHosts.length > 0) {
        warnings.push("phishing running outside plan");
    }
    if (
        Object.keys(agentVersions).some(function (version) {
            return version !== VERSION;
        })
    ) {
        warnings.push("old agent version still running");
    }

    const snapshot = {
        version: VERSION,
        ts: now,
        date: new Date(now).toISOString(),
        charisma: charisma,
        knownHosts: targets.size,
        reportCount: reports.length,
        freshReportCount: freshReports.length,
        processCounts: counts,
        agentVersions: agentVersions,
        activeCrawlIds: Array.from(activeCrawlIds),
        phishingPlan: plan,
        phishingPlanAgeMs: now - Number((plan && plan.ts) || 0),
        unauthorizedPhishHosts: Array.from(new Set(unauthorizedPhishHosts)),
        phases: phaseCounts,
        warnings: warnings,
        lastManagerStatus: lastManagerStatus,
        freshReports: freshReports.map(function (report) {
            return {
                host: report.host,
                ageMs: now - Number(report.ts || 0),
                phase: String(report.phase || ""),
                activeTarget: String(report.activeTarget || ""),
                authAttempts: Number(report.authAttempts || 0),
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
        hosts: hostProcesses,
    };

    await ns.write(OUTPUT_FILE, JSON.stringify(snapshot, null, 2), "w");
    ns.tprint(
        "[DNET SNAPSHOT " +
            VERSION +
            "] managers=" +
            counts.managers +
            " | agents=" +
            counts.agents +
            " | managed=" +
            counts.totalManaged +
            " | phishing=" +
            counts.phishing +
            "/4 hosts (" +
            counts.phishThreads +
            " threads) | fresh reports=" +
            freshReports.length +
            " | warnings=" +
            (warnings.join(", ") || "none")
    );
    ns.tprint("[DNET SNAPSHOT] Wrote " + OUTPUT_FILE + ".");
}

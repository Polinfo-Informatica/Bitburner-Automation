/**
 * darknet-cleanup.js
 * One-shot cleanup utility for the custom Dark Net automation.
 *
 * Run this before switching manager builds. It kills only this project's
 * manager/workers; Alain's autopilot and unrelated scripts are left alone.
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
    const DB_FILE = "darknet-passwords.txt";
    const REPORT_PREFIX = "/Temp/dnet-report-";
    const COMPLETION_PREFIX = "/Temp/dnet-complete-";
    const PHISH_HEARTBEAT_PREFIX = "/Temp/dnet-phish-heartbeat-";
    const PHISH_PLAN = "/Temp/dnet-phish-plan.txt";
    const MANAGER = "darknet-manager.js";
    const CLEANUP_PASSES = 4;
    const MANAGED = new Set([
        "/Temp/dnet-agent.js",
        "/Temp/dnet-phish.js",
        "/Temp/dnet-phish-launcher.js",
        "/Temp/dnet-ram-launcher.js",
        "/Temp/dnet-ram-worker.js",
        "/Temp/dnet-stasis.js",
        "/Temp/dnet-loot.js",
    ]);

    function collectTargets() {
        /** @type {Map<string, string>} */
        const targets = new Map();
        targets.set("darkweb", "");

        try {
            const raw = ns.read(DB_FILE);
            if (raw) {
                const db = JSON.parse(raw);
                if (db && typeof db === "object") {
                    for (const [host, entry] of Object.entries(db)) {
                        if (entry && typeof entry.password === "string") {
                            targets.set(host, entry.password);
                        }
                    }
                }
            }
        } catch {
            // Intentionally ignored: reports can still identify targets.
        }

        try {
            for (const file of ns.ls("home", REPORT_PREFIX)) {
                try {
                    const report = JSON.parse(ns.read(file));
                    if (
                        report &&
                        typeof report.host === "string" &&
                        typeof report.password === "string"
                    ) {
                        targets.set(report.host, report.password);
                    }
                } catch {
                    // Intentionally ignored: another report may still be valid.
                }
            }
        } catch {
            // Intentionally ignored: the DB and darkweb can still be cleaned.
        }

        return targets;
    }

    let processesKilled = 0;
    let managersKilled = 0;
    let completionFilesRemoved = 0;
    let heartbeatFilesRemoved = 0;
    const checkedHosts = new Set();
    const unavailableHosts = new Set();

    // Managers must stop first or they can recreate workers during cleanup.
    try {
        for (const process of ns.ps("home")) {
            if (process.filename !== MANAGER) continue;
            try {
                if (ns.kill(process.pid)) {
                    processesKilled++;
                    managersKilled++;
                }
            } catch {
                // Intentionally ignored: another cleanup may have won the race.
            }
        }
    } catch {
        // Intentionally ignored: worker cleanup can still proceed.
    }

    // Re-read the DB/reports on every pass. This catches a late report or a
    // worker deployed just as its parent was being stopped.
    for (let pass = 1; pass <= CLEANUP_PASSES; pass++) {
        const targets = collectTargets();
        for (const host of targets.keys()) {
            checkedHosts.add(host);
            try {
                for (const process of ns.ps(host)) {
                    if (!MANAGED.has(process.filename)) continue;
                    try {
                        if (ns.kill(process.pid)) processesKilled++;
                    } catch {
                        // Intentionally ignored: a prior pass may have killed it.
                    }
                }
                for (const file of ns.ls(host, COMPLETION_PREFIX)) {
                    try {
                        if (ns.rm(file, host)) completionFilesRemoved++;
                    } catch {
                        // Intentionally ignored: a prior pass may have removed it.
                    }
                }
                for (const file of ns.ls(host, PHISH_HEARTBEAT_PREFIX)) {
                    try {
                        if (ns.rm(file, host)) heartbeatFilesRemoved++;
                    } catch {
                        // Intentionally ignored: a prior pass may have removed it.
                    }
                }
            } catch {
                unavailableHosts.add(host);
            }
        }
        if (pass < CLEANUP_PASSES) await ns.sleep(1000);
    }

    // Any v1.2.3 worker that briefly survives a race sees an empty plan and
    // refuses to start phishing when it next receives the home control file.
    try {
        await ns.write(
            PHISH_PLAN,
            JSON.stringify({
                desired: [],
                ts: Date.now(),
                maxHosts: 0,
                version: VERSION,
                reason: "cleanup",
            }),
            "w"
        );
    } catch {
        // Intentionally ignored: processes have already been stopped directly.
    }

    let reportsRemoved = 0;
    try {
        for (const file of ns.ls("home", REPORT_PREFIX)) {
            try {
                if (ns.rm(file, "home")) reportsRemoved++;
            } catch {
                // Intentionally ignored: this operation is best-effort.
            }
        }
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }

    try {
        for (const file of ns.ls("home", PHISH_HEARTBEAT_PREFIX)) {
            try {
                if (ns.rm(file, "home")) heartbeatFilesRemoved++;
            } catch {
                // Intentionally ignored: another cleanup may have removed it.
            }
        }
    } catch {
        // Intentionally ignored: heartbeat files are diagnostic only.
    }

    ns.tprint(
        "[DNET CLEANUP " +
            VERSION +
            "] passes=" +
            CLEANUP_PASSES +
            " | checked=" +
            checkedHosts.size +
            " | managers=" +
            managersKilled +
            " | killed=" +
            processesKilled +
            " | unavailable=" +
            unavailableHosts.size +
            " | reports removed=" +
            reportsRemoved +
            " | completion files removed=" +
            completionFilesRemoved +
            " | heartbeat files removed=" +
            heartbeatFilesRemoved
    );
    ns.tprint(
        "[DNET CLEANUP " +
            VERSION +
            "] Done. You can now run darknet-manager.js."
    );
}

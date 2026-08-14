/**
 * darknet-cleanup.js
 * One-shot cleanup utility for the custom Dark Net automation.
 *
 * Run this ONCE before switching from an older darknet-manager.js build to v1.0.9+.
 * It kills only this project's manager/workers; unrelated scripts are left alone.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    try {
        ns.disableLog("ALL");
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }

    const DB_FILE = "darknet-passwords.txt";
    const REPORT_PREFIX = "/Temp/dnet-report-";
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

    /** @type {Map<string, string>} */
    const targets = new Map();
    targets.set("darkweb", "");

    // Known credentials are the most reliable source of previously-authenticated nodes.
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
        // Intentionally ignored: this operation is best-effort.
    }

    // Reports can contain a node that has not yet made it into the credential DB.
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
                // Intentionally ignored: this operation is best-effort.
            }
        }
    } catch {
        // Intentionally ignored: this operation is best-effort.
    }

    let hostsChecked = 0;
    let sessionsOpened = 0;
    let processesKilled = 0;
    let offlineOrUnavailable = 0;

    // A running pre-update manager immediately recreates the workers we kill below.
    // Stop every manager instance first, while leaving Alain's autopilot untouched.
    try {
        for (const process of ns.ps("home")) {
            if (process.filename !== MANAGER) continue;
            try {
                if (ns.kill(process.pid)) processesKilled++;
            } catch {
                // Intentionally ignored: another cleanup may have won the race.
            }
        }
    } catch {
        // Intentionally ignored: worker cleanup can still proceed.
    }

    for (const [host, password] of targets) {
        hostsChecked++;

        try {
            const server = ns.getServer(host);
            if (server && server.isOnline === false) {
                offlineOrUnavailable++;
                continue;
            }
        } catch {
            offlineOrUnavailable++;
            continue;
        }

        try {
            let session;
            if (host === "darkweb") {
                session = await ns.dnet.authenticate("darkweb", "");
            } else {
                session = ns.dnet.connectToSession(host, password);
            }
            if (session && session.success) sessionsOpened++;
        } catch {
            // Intentionally ignored: this operation is best-effort.
        }

        try {
            for (const process of ns.ps(host)) {
                if (!MANAGED.has(process.filename)) continue;
                try {
                    if (ns.kill(process.pid)) processesKilled++;
                } catch {
                    // Intentionally ignored: this operation is best-effort.
                }
            }
        } catch {
            // Intentionally ignored: this operation is best-effort.
        }
    }

    // Remove stale home-side reports so v1.0.9 starts with a clean topology view.
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

    ns.tprint(
        "[DNET CLEANUP] checked=" +
            hostsChecked +
            " | sessions=" +
            sessionsOpened +
            " | killed=" +
            processesKilled +
            " | unavailable=" +
            offlineOrUnavailable +
            " | reports removed=" +
            reportsRemoved
    );
    ns.tprint(
        "[DNET CLEANUP] Done. You can now run darknet-manager.js v1.0.9."
    );
}

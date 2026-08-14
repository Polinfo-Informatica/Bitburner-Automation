const VERSION = "1.0.0";
const CONFIG_FILE = "daemon.js.config.txt";
const DAEMON_FILE = "daemon.js";
const AUTOPILOT_FILE = "autopilot.js";
const STOP_WAIT_MS = 5000;

/**
 * Enables Alain Bryden's supported persistent misfire-suppression option and
 * refreshes daemon.js without stopping autopilot.js or unrelated scripts.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    try {
        ns.disableLog("ALL");
    } catch {
        // Logging state does not affect the configuration change.
    }

    if (ns.getHostname() !== "home") {
        ns.tprint(
            `ERROR: ${ns.getScriptName()} must be run on home so it can update ${CONFIG_FILE}.`
        );
        return;
    }

    const configResult = readConfig(ns);
    if (configResult.error) {
        ns.tprint(
            `[ALAIN MISFIRE FIX ${VERSION}] ERROR: ${CONFIG_FILE} was not changed: ` +
                configResult.error
        );
        return;
    }

    const config = configResult.config;
    config["silent-misfires"] = true;
    try {
        await ns.write(CONFIG_FILE, JSON.stringify(config, null, 2), "w");
    } catch (error) {
        ns.tprint(
            `[ALAIN MISFIRE FIX ${VERSION}] ERROR: Could not write ${CONFIG_FILE}: ${String(error)}`
        );
        return;
    }

    ns.tprint(
        `[ALAIN MISFIRE FIX ${VERSION}] Set silent-misfires=true in ${CONFIG_FILE}.`
    );

    let processes;
    try {
        processes = ns.ps("home");
    } catch (error) {
        ns.tprint(
            `[ALAIN MISFIRE FIX ${VERSION}] WARNING: Could not inspect home processes: ${String(error)}`
        );
        ns.tprint(
            `[ALAIN MISFIRE FIX ${VERSION}] The setting will apply the next time ${DAEMON_FILE} starts.`
        );
        return;
    }

    const daemons = processes.filter(function (process) {
        return process.filename === DAEMON_FILE;
    });
    if (daemons.length === 0) {
        ns.tprint(
            `[ALAIN MISFIRE FIX ${VERSION}] ${DAEMON_FILE} is not running; the setting will apply on its next start.`
        );
        return;
    }

    const autopilotRunning = processes.some(function (process) {
        return process.filename === AUTOPILOT_FILE;
    });
    const preservedArgs = Array.isArray(daemons[0].args)
        ? daemons[0].args.slice()
        : [];

    let stopped = 0;
    for (const daemon of daemons) {
        try {
            if (ns.kill(daemon.pid)) stopped++;
        } catch {
            // A competing singleton cleanup may already have stopped it.
        }
    }

    if (stopped === 0) {
        ns.tprint(
            `[ALAIN MISFIRE FIX ${VERSION}] WARNING: Could not stop the running ${DAEMON_FILE}; restart it manually to apply the setting.`
        );
        return;
    }

    await waitForDaemonsToStop(ns);

    if (autopilotRunning) {
        ns.tprint(
            `[ALAIN MISFIRE FIX ${VERSION}] Stopped ${stopped} ${DAEMON_FILE} process(es). ` +
                `${AUTOPILOT_FILE} remains running and will relaunch it automatically.`
        );
    } else if (ns.fileExists(DAEMON_FILE, "home")) {
        if (!preservedArgs.includes("--silent-misfires")) {
            preservedArgs.push("--silent-misfires");
        }
        const pid = ns.exec(DAEMON_FILE, "home", 1, ...preservedArgs);
        if (pid > 0) {
            ns.tprint(
                `[ALAIN MISFIRE FIX ${VERSION}] Restarted ${DAEMON_FILE} with PID ${pid}; its previous arguments were preserved.`
            );
        } else {
            ns.tprint(
                `[ALAIN MISFIRE FIX ${VERSION}] WARNING: ${DAEMON_FILE} stopped, but could not be restarted. Start it normally; the persistent setting is ready.`
            );
        }
    } else {
        ns.tprint(
            `[ALAIN MISFIRE FIX ${VERSION}] WARNING: ${DAEMON_FILE} is not installed on home. The persistent setting is ready for when it is installed.`
        );
    }

    ns.tprint(
        `[ALAIN MISFIRE FIX ${VERSION}] Already-scheduled workers may show a few final toasts before they finish.`
    );
}

function readConfig(ns) {
    let raw;
    try {
        raw = ns.read(CONFIG_FILE);
    } catch (error) {
        return {
            config: {},
            error: `could not read the existing file (${String(error)})`,
        };
    }

    if (!raw.trim()) return { config: {}, error: "" };

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return {
            config: {},
            error: `existing JSON is invalid (${String(error)})`,
        };
    }

    if (Array.isArray(parsed)) {
        const validEntries = parsed.every(function (entry) {
            return (
                Array.isArray(entry) &&
                entry.length === 2 &&
                typeof entry[0] === "string"
            );
        });
        if (!validEntries) {
            return {
                config: {},
                error: "existing array configuration does not contain valid [name, value] entries",
            };
        }
        return { config: Object.fromEntries(parsed), error: "" };
    }

    if (parsed && typeof parsed === "object") {
        return { config: { ...parsed }, error: "" };
    }

    return {
        config: {},
        error: "existing configuration must be a JSON object or an array of [name, value] entries",
    };
}

async function waitForDaemonsToStop(ns) {
    const started = Date.now();
    while (Date.now() - started < STOP_WAIT_MS) {
        try {
            if (
                !ns.ps("home").some(function (process) {
                    return process.filename === DAEMON_FILE;
                })
            ) {
                return;
            }
        } catch {
            return;
        }
        await ns.sleep(100);
    }
}

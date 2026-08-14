const ARGS_SCHEMA = [
    ["branch", "main"],
    ["no-self", false],
    ["help", false],
];

const GITHUB_OWNER = "Polinfo-Informatica";
const GITHUB_REPOSITORY = "Bitburner-Automation";
const UPDATER_FILE = "dnet-git-pull.js";
const RUNTIME_FILES = ["darknet-manager.js", "darknet-cleanup.js"];

export function autocomplete(data, _args) {
    data.flags(ARGS_SCHEMA);
    return [];
}

/**
 * Pulls the Bitburner Dark Net runtime files directly from this repository.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    try {
        ns.disableLog("ALL");
    } catch {
        // Best-effort only; logging state does not affect updating.
    }

    const options = ns.flags(ARGS_SCHEMA);
    if (options.help) {
        printHelp(ns);
        return;
    }

    if (ns.getHostname() !== "home") {
        ns.tprint(`ERROR: ${UPDATER_FILE} must be run on home.`);
        return;
    }

    const branch = String(options.branch || "main");
    const selfFile = ns.getScriptName();
    const targets = RUNTIME_FILES.map((file) => ({
        remote: file,
        local: file,
    }));

    if (!options["no-self"]) {
        targets.push({ remote: UPDATER_FILE, local: selfFile });
    }

    let managerWasRunning = false;
    try {
        managerWasRunning = ns
            .ps("home")
            .some((process) => process.filename === "darknet-manager.js");
    } catch {
        // The update can still proceed if process inspection fails.
    }

    ns.tprint(
        `INFO: Pulling Bitburner-Automation from ${GITHUB_OWNER}/${GITHUB_REPOSITORY} ` +
            `(branch: ${branch}).`
    );

    let updated = 0;
    let failed = 0;
    let managerVersion = "";

    for (const target of targets) {
        const stage = makeStagePath(target.remote);
        removeStage(ns, stage);

        const url = makeRawUrl(branch, target.remote);
        ns.print(`Downloading ${target.remote} from ${url}`);

        let downloaded = false;
        try {
            downloaded = await ns.wget(
                `${url}?ts=${Date.now()}`,
                stage,
                "home"
            );
        } catch (error) {
            ns.tprint(
                `WARNING: Download failed for ${target.remote}: ${String(error)}`
            );
        }

        if (!downloaded) {
            failed++;
            removeStage(ns, stage);
            continue;
        }

        let contents = "";
        try {
            contents = ns.read(stage);
        } catch (error) {
            ns.tprint(
                `WARNING: Could not read staged ${target.remote}: ${String(error)}`
            );
        }

        const validation = getValidationError(target.remote, contents);
        if (validation) {
            failed++;
            ns.tprint(
                `WARNING: Refusing to overwrite ${target.local}: ${validation}`
            );
            removeStage(ns, stage);
            continue;
        }

        try {
            await ns.write(target.local, contents, "w");
            updated++;

            if (target.remote === "darknet-manager.js") {
                managerVersion = getManagerVersion(contents);
            }

            ns.tprint(
                `SUCCESS: Updated ${target.local} from GitHub` +
                    (target.remote === "darknet-manager.js" && managerVersion
                        ? ` (v${managerVersion})`
                        : "") +
                    "."
            );
        } catch (error) {
            failed++;
            ns.tprint(
                `WARNING: Could not write ${target.local}: ${String(error)}`
            );
        }

        removeStage(ns, stage);
    }

    ns.tprint(`INFO: Pull complete: ${updated} updated, ${failed} failed.`);

    if (managerWasRunning) {
        ns.tprint(
            "WARNING: darknet-manager.js was already running. The running process still " +
                "uses the old code. Stop it, run darknet-cleanup.js, then start the " +
                "updated manager."
        );
    } else if (failed === 0) {
        ns.tprint(
            "INFO: Runtime files are current. For a clean Dark Net restart, run " +
                "darknet-cleanup.js before darknet-manager.js."
        );
    }
}

function makeStagePath(remoteFile) {
    const safeName = remoteFile.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return `/Temp/dnet-git-pull-${safeName}`;
}

function makeRawUrl(branch, remoteFile) {
    const encodedPath = remoteFile
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
    const encodedBranch = encodeURIComponent(branch);

    return (
        `https://raw.githubusercontent.com/${GITHUB_OWNER}/` +
        `${GITHUB_REPOSITORY}/${encodedBranch}/${encodedPath}`
    );
}

function getValidationError(remoteFile, contents) {
    if (typeof contents !== "string" || contents.trim().length < 20) {
        return "downloaded file is empty or unexpectedly short";
    }

    const beginning = contents.trimStart().slice(0, 200).toLowerCase();
    if (beginning.startsWith("<!doctype") || beginning.startsWith("<html")) {
        return "GitHub returned HTML instead of JavaScript";
    }

    if (!contents.includes("export") || !contents.includes("function main")) {
        return "download does not look like a Bitburner script";
    }

    if (
        remoteFile === "darknet-manager.js" &&
        !/const VERSION = "[^"]+";/.test(contents)
    ) {
        return "darknet-manager.js does not contain a VERSION marker";
    }

    if (
        remoteFile === UPDATER_FILE &&
        (!contents.includes(GITHUB_OWNER) ||
            !contents.includes(GITHUB_REPOSITORY) ||
            !contents.includes(UPDATER_FILE))
    ) {
        return `${UPDATER_FILE} does not identify the expected repository`;
    }

    return "";
}

function getManagerVersion(contents) {
    const match = contents.match(/const VERSION = "([^"]+)";/);
    return match ? match[1] : "";
}

function removeStage(ns, stage) {
    try {
        if (ns.fileExists(stage, "home")) ns.rm(stage, "home");
    } catch {
        // Temporary-file cleanup is best-effort.
    }
}

function printHelp(ns) {
    ns.tprint("Bitburner-Automation Dark Net GitHub updater");
    ns.tprint(`Usage: run ${UPDATER_FILE} [--branch main] [--no-self]`);
    ns.tprint("");
    ns.tprint("Downloads:");
    ns.tprint("  darknet-manager.js");
    ns.tprint("  darknet-cleanup.js");
    ns.tprint(`  ${UPDATER_FILE} (unless --no-self is supplied)`);
    ns.tprint("");
    ns.tprint(
        "The updater does not start, stop, or clean Dark Net workers automatically."
    );
}

# Bitburner-Automation

Dark Net automation for Bitburner 3.0.1.

## Install directly from GitHub inside Bitburner

This repository includes `dnet-git-pull.js`, following the same bootstrap idea
used by Alain Bryden's Bitburner scripts without conflicting with his
`git-pull.js`.

### Alain-style bootstrap

From the Bitburner terminal:

```text
nano dnet-git-pull.js
```

Paste the contents of the repository's `dnet-git-pull.js`, save, and close the
editor. Then run:

```text
run dnet-git-pull.js
```

The updater downloads these runtime files directly from the `main` branch:

- `darknet-manager.js`
- `darknet-cleanup.js`
- `darknet-snapshot.js`
- `alain-silence-misfires.js`
- `dnet-git-pull.js`

After the first install, updating is simply:

```text
run dnet-git-pull.js
```

Optional alias:

```text
alias dnet-pull="run dnet-git-pull.js"
```

Then future updates can be installed with:

```text
dnet-pull
```

### Direct bootstrap without nano

```text
wget https://raw.githubusercontent.com/Polinfo-Informatica/Bitburner-Automation/main/dnet-git-pull.js dnet-git-pull.js
run dnet-git-pull.js
```

### Other branch

```text
run dnet-git-pull.js --branch branch-name
```

### Do not self-update dnet-git-pull.js

```text
run dnet-git-pull.js --no-self
```

The updater stages and validates downloads before overwriting the installed
files. It deliberately does not kill, restart, or clean Dark Net processes
automatically. If `darknet-manager.js` was already running during an update,
run `darknet-cleanup.js` before starting the newly downloaded manager. The
cleanup stops only this project's manager and generated workers; it does not
stop Alain's `autopilot.js` or other unrelated scripts.

## Silence Alain batch misfire toasts

Alain's `daemon.js` already supports a persistent `silent-misfires` option. To
enable it without modifying Alain's source files or losing other daemon
settings, run:

```text
run alain-silence-misfires.js
```

The helper merges `"silent-misfires": true` into
`daemon.js.config.txt`. If `autopilot.js` is running, the helper stops only the
current `daemon.js`; autopilot then relaunches it with the persistent option.
If daemon is running without autopilot, the helper restarts it while preserving
its arguments. Already-scheduled hack/grow/weaken workers may display a few
final toasts before completing.

## Runtime

For a clean manual start:

```text
run darknet-cleanup.js
run darknet-manager.js
```

The manager generates its own worker scripts under `/Temp`. Dark Net discovery
uses a serialized depth-first crawler: only one branch advances at a time and
waiting parents perform no Dark Net actions. Traversal starts with the game's
official eight-row structural segment, expands by eight only when necessary,
and never exceeds the engine's official forty-row maximum. A completed crawl
waits for a real Dark Net mutation plus one 30-second quiet window before it can
restart.

Phishing is manager-controlled. Automatic mode uses the player's live stasis
capacity (one to four servers), selects stable high-RAM targets, and packs each
worker into the exact currently free RAM. The game API already paces each
attack, so the manager adds no redundant successful-call cooldown.

To request fewer phishing hosts:

```text
run darknet-manager.js --phish-hosts 1
```

To isolate the crawler with phishing fully disabled:

```text
run darknet-manager.js --no-phish
```

The researched mechanics, formulas, source links, and derivation of every
important runtime ceiling are documented in
[`docs/runtime-limits.md`](docs/runtime-limits.md).

To capture a one-shot runtime diagnosis while the manager is running:

```text
run darknet-snapshot.js
cat darknet-diagnostic-snapshot.txt
```

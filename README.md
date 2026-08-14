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

## Runtime

For a clean manual start:

```text
run darknet-cleanup.js
run darknet-manager.js
```

The manager generates its own worker scripts under `/Temp`. Dark Net discovery
uses a serialized depth-first crawler: only one branch advances at a time,
waiting parent agents do no Dark Net work, the traversal stack is capped at 17
agents, and completed crawls pause for two minutes before rescanning mutations.

Phishing is manager-controlled, limited to the four highest-RAM eligible
servers, staggered, and rate-limited. To isolate the crawler with phishing
fully disabled, start it with:

```text
run darknet-manager.js --no-phish
```

To capture a one-shot runtime diagnosis while the manager is running:

```text
run darknet-snapshot.js
cat darknet-diagnostic-snapshot.txt
```

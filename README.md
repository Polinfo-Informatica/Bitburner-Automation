# Bitburner-Automation

Dark Net automation for Bitburner 3.0.1.

## Install directly from GitHub inside Bitburner

This repository includes `git-pull.js`, following the same bootstrap idea used by
Alain Bryden's Bitburner scripts.

### Alain-style bootstrap

From the Bitburner terminal:

```text
nano git-pull.js
```

Paste the contents of the repository's `git-pull.js`, save, and close the editor.
Then run:

```text
run git-pull.js
```

The updater downloads these runtime files directly from the `main` branch:

- `darknet-manager.js`
- `darknet-cleanup.js`
- `git-pull.js`

After the first install, updating is simply:

```text
run git-pull.js
```

Optional alias:

```text
alias dnet-pull="run git-pull.js"
```

Then future updates can be installed with:

```text
dnet-pull
```

### Other branch

```text
run git-pull.js --branch branch-name
```

### Do not self-update git-pull.js

```text
run git-pull.js --no-self
```

The updater stages and validates downloads before overwriting the installed files.
It deliberately does not kill, restart, or clean Dark Net processes automatically.
If `darknet-manager.js` was already running during an update, stop it and run
`darknet-cleanup.js` before starting the newly downloaded manager.

## Runtime

For a clean manual start:

```text
run darknet-cleanup.js
run darknet-manager.js
```

The manager generates its own worker scripts under `/Temp`.

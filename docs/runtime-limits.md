# Runtime limits and optimization basis

This document records why each important Dark Net limit exists. The runtime is
targeted at Bitburner 3.0.1 and was checked against the upstream `dev` tree at
commit `79e5cd8716e0ab04897460f82006294cc92d39d9` on 2026-08-14.

## Crawler

| Decision | Runtime behavior | Upstream basis |
| --- | --- | --- |
| Gateway RAM | Refuse to launch when the generated crawler is larger than the live `darkweb` capacity. | `darkweb.maxRam = 16` in [`NetworkGenerator.ts`](https://github.com/bitburner-official/bitburner-src/blob/79e5cd8716e0ab04897460f82006294cc92d39d9/src/DarkNet/controllers/NetworkGenerator.ts). |
| Traversal shape | One advancing depth-first branch; parents wait for an explicit completion file. | Prevents process count from multiplying by branch count. This is an application safety invariant rather than a game restriction. |
| Initial depth | Eight rows. | `AIR_GAP_DEPTH = 8` in [`Enums.ts`](https://github.com/bitburner-official/bitburner-src/blob/79e5cd8716e0ab04897460f82006294cc92d39d9/src/DarkNet/Enums.ts). The normal pre-SF15 network is only five rows. |
| Absolute depth | Forty rows; increase by eight only when a crawl reaches its current edge. | `MAX_NET_DEPTH = 40` and the eight-row structural interval in `Enums.ts`; actual progression depths are defined in [`labyrinth.ts`](https://github.com/bitburner-official/bitburner-src/blob/79e5cd8716e0ab04897460f82006294cc92d39d9/src/DarkNet/effects/labyrinth.ts). |
| Rescan trigger | Require both a real `nextMutation()` event and a 30-second quiet window after completion. | Mutations are event-backed; `MS_PER_MUTATION_PER_ROW = 30_000` in `Enums.ts`. This avoids blind timer rescans when nothing changed. |
| Timeout retries | Four retries only for response code 408. | Dark Net instability is capped at a 50% timeout chance in [`offlineServerHandling.ts`](https://github.com/bitburner-official/bitburner-src/blob/79e5cd8716e0ab04897460f82006294cc92d39d9/src/DarkNet/effects/offlineServerHandling.ts). Four attempts give at least a 93.75% chance that one request is not timed out at the worst possible instability. |

## Phishing

| Decision | Runtime behavior | Upstream basis |
| --- | --- | --- |
| Host count | Automatic mode uses the live stasis-link limit. Explicit values are still capped by that live limit. | The game grants one base link and at most three augmentation links, for a total of 1-4, in [`effects.ts`](https://github.com/bitburner-official/bitburner-src/blob/79e5cd8716e0ab04897460f82006294cc92d39d9/src/DarkNet/effects/effects.ts). |
| Host stability | Start phishing only on currently linked stasis servers. | Stasis prevents movement, deletion, and restart, avoiding worker churn and repeated deployment. |
| Threads | Use every whole thread that fits in the server's current free RAM. | Success XP, failed-attempt XP, money, and cache chance scale linearly with threads in [`phishing.ts`](https://github.com/bitburner-official/bitburner-src/blob/79e5cd8716e0ab04897460f82006294cc92d39d9/src/DarkNet/effects/phishing.ts). Fewer, heavily threaded processes minimize JavaScript overhead without reducing RAM efficiency. |
| Action pacing | No additional successful-call cooldown. Add a one-second backoff only after exceptions. | `phishingAttack()` already waits between 10 seconds and a hard minimum of 200 ms according to the upstream speed formula. The Dark Net feature author's [reference worker](https://github.com/ficocelliguy/BitburnerScripts/blob/2329034a77321c72558bce9fdbce635917f2c68d/src/dn_phish.js) also awaits the API directly without another delay. |
| Telemetry | Unique worker heartbeat files are converted to monotonic manager-session totals. | Prevents totals from dropping when a worker rotates while keeping remote `ps()` out of the status hot path. |

## Control-plane load

- Home report files are scanned every 15 seconds, matching the worker report
  interval, instead of every five-second manager tick.
- Generated workers are rewritten only when their exact source changes.
- Status is printed every 60 seconds as two stable, labeled lines. Plan changes
  and lifecycle events are printed only when state actually changes.
- The manager keeps exactly one pending `nextMutation()` promise; it does not
  create a polling worker or accumulate unresolved promises.

## User controls

```text
run darknet-manager.js
run darknet-manager.js --phish-hosts 2
run darknet-manager.js --phish-hosts 0
run darknet-manager.js --no-phish
```

The default `--phish-hosts -1` means automatic. `0` and `--no-phish` both
disable phishing. Positive requests never exceed the player's current stasis
capacity.

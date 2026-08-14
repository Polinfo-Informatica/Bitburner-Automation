from pathlib import Path
import re
import subprocess
import tempfile

p = Path("darknet-manager.js")
s = p.read_text(encoding="utf-8")

if 'const VERSION = "1.0.3";' not in s:
    raise SystemExit("Stage 1 did not produce version 1.0.3")

def replace_span(start, end, new, label):
    global s
    a = s.find(start)
    if a < 0:
        raise SystemExit(f"Missing start marker for {label}")
    b = s.find(end, a)
    if b < 0:
        raise SystemExit(f"Missing end marker for {label}")
    s = s[:a] + new + s[b:]

replace_span(
    '    function localClueCandidates(target) {',
    '    function romanToInt(s) {',
    '''    function localClueCandidates(target) {
        const db = readLocalDbCandidate(target);
        return db === null ? [] : [db];
    }

''',
    "localClueCandidates"
)

old = '''                maxRam: ns.getServerMaxRam(host),
                usedRam: ns.getServerUsedRam(host),'''
new = '''                maxRam: 0,
                usedRam: 0,'''
if old not in s:
    raise SystemExit("Could not remove max/used RAM calls from agent report")
s = s.replace(old, new, 1)

old = '''                const r = JSON.parse(ns.read(file));
                if (r && r.host) reports.push(r);'''
new = '''                const r = JSON.parse(ns.read(file));
                if (r && r.host) {
                    try { r.maxRam = ns.getServerMaxRam(r.host); } catch { }
                    reports.push(r);
                }'''
if old not in s:
    raise SystemExit("Could not move max RAM lookup to manager")
s = s.replace(old, new, 1)

p.write_text(s, encoding="utf-8")

subprocess.run(["node", "--check", str(p)], check=True)
text = p.read_text(encoding="utf-8")
blocks = re.findall(r'const\s+([A-Z_]+_SOURCE)\s*=\s*String\.raw`(.*?)`;', text, re.S)
if len(blocks) < 6:
    raise SystemExit(f"Expected at least 6 generated workers, found {len(blocks)}")

for name, src in blocks:
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(src)
        tmp = f.name
    subprocess.run(["node", "--check", tmp], check=True)
    print("Syntax OK:", name)

agent = dict(blocks)["AGENT_SOURCE"]
forbidden = [
    "ns.dnet.openCache",
    "ns.dnet.memoryReallocation",
    "ns.spawn",
    "ns.run",
    "ns.kill",
    "ns.getScriptRam",
    "ns.getServerMaxRam",
    "ns.getServerUsedRam",
    "ns.isRunning",
    "ns.ls",
]
bad = [x for x in forbidden if x in agent]
if bad:
    raise SystemExit("Heavy APIs still present in persistent agent: " + ", ".join(bad))

cost = {
    "base": 1.6,
    "ns.dnet.authenticate": 0.4,
    "ns.dnet.getBlockedRam": 0.0,
    "ns.dnet.getServerDetails": 0.1,
    "ns.dnet.getStasisLinkedServers": 0.0,
    "ns.dnet.heartbleed": 0.6,
    "ns.dnet.probe": 0.2,
    "ns.exec": 1.3,
    "ns.getHostname": 0.05,
    "ns.ps": 0.2,
    "ns.read": 0.0,
    "ns.scp": 0.6,
    "ns.sleep": 0.0,
    "ns.write": 0.0,
}
present = sorted(k for k in cost if k != "base" and k in agent)
estimate = cost["base"] + sum(cost[k] for k in present)
print("Persistent agent API estimate:", estimate, "GB")
print("Retained APIs:", ", ".join(present))
if estimate >= 16:
    raise SystemExit("Estimated persistent agent RAM is still >=16 GB")

print("Stage 2 validation complete.")

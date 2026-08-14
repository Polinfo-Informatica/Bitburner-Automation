from pathlib import Path
import re

FILES = [Path("darknet-manager.js"), Path("darknet-cleanup.js")]

for path in FILES:
    text = path.read_text(encoding="utf-8")

    # Version runtime changes so old agents are replaced cleanly.
    if path.name == "darknet-manager.js":
        text = text.replace('"1.0.5"', '"1.0.6"')

    # Bitburner workers intentionally use perpetual service loops. `for (;;)` is
    # equivalent to `while (true)` but does not trigger no-constant-condition.
    text = text.replace("while (true) {", "for (;;) {")

    # Empty catches are deliberate around best-effort game API operations, but
    # keep the intent explicit so strict ESLint does not flag silent blocks.
    text = re.sub(
        r"catch\s*\{\s*\}",
        "catch {\n        // Intentionally ignored: this operation is best-effort.\n    }",
        text,
    )

    path.write_text(text, encoding="utf-8")

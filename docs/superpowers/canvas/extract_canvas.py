#!/usr/bin/env python3
"""Unpack a published Claude design canvas back into its per-artboard sources.

The canvas editor stores its entire editable state — one .dc.html per artboard,
canvas.json for the layout, the annotations — inside a single <script
id="appifact-doc"> block in the published page. Nothing else on the page is
source; everything around that block is the editor bundle.

The page is only reachable through an authenticated claude.ai session, so this
takes the already-fetched HTML rather than a URL. Save the page first (Claude
Code's WebFetch writes it to disk), then:

    python3 extract_canvas.py <saved-page.html> <output-dir>
"""

import json
import pathlib
import re
import sys

DOC = re.compile(r'<script[^>]*id="appifact-doc"[^>]*>(.*?)</script>', re.S)


def main() -> int:
    if len(sys.argv) != 3:
        sys.exit(__doc__)

    page = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    match = DOC.search(page)
    if match is None:
        sys.exit(f"{sys.argv[1]}: no appifact-doc block — not a published canvas page")

    doc = json.loads(match.group(1))
    out = pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)

    files = doc["content"]["files"]
    for name, content in sorted(files.items()):
        (out / name).write_text(content, encoding="utf-8")

    print(f'{doc["title"]}: {len(files)} files -> {out}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

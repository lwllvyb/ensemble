#!/usr/bin/env python3
"""Read a pane id out of a herdr socket-API response on stdin.

Why this is a separate file instead of a python -c inside the shell script:
herdr moves its response shape around between releases, and the inline version
only knew two of them. When `herdr tab create` started answering with
`result.root_pane` instead of `result.tab.panes[0]`, the parser returned an
empty string, the shell script pressed on with an empty pane id, and the
monitor silently never opened. Measured 15-09-2026.

So this does two things the inline version did not:

1. It tries every shape we have actually seen, newest first.
2. If none of them match it walks the whole response looking for a pane id,
   so a shape nobody has seen yet still works instead of failing at the exact
   moment someone needs the monitor.

It exits non-zero and says why on stderr rather than printing an empty id,
because an empty id is the failure that is hardest to notice.
"""

import json
import sys

# Shapes we have measured, in the order herdr is most likely to use them.
#   herdr pane split  -> result.pane.pane_id
#   herdr tab create  -> result.root_pane.pane_id
#   older releases    -> result.tab.panes[0].pane_id
KNOWN_PATHS = (
    ("pane", "pane_id"),
    ("root_pane", "pane_id"),
    ("new_pane", "pane_id"),
)


def via_known_paths(result):
    for path in KNOWN_PATHS:
        node = result
        for key in path[:-1]:
            node = node.get(key) if isinstance(node, dict) else None
            if node is None:
                break
        if isinstance(node, dict):
            value = node.get(path[-1])
            if isinstance(value, str) and value:
                return value

    tab = result.get("tab") if isinstance(result, dict) else None
    panes = tab.get("panes") if isinstance(tab, dict) else None
    if isinstance(panes, list) and panes:
        first = panes[0]
        if isinstance(first, dict):
            value = first.get("pane_id")
            if isinstance(value, str) and value:
                return value
    return None


def via_search(node):
    """Depth-first hunt for the first pane_id anywhere in the response."""
    if isinstance(node, dict):
        value = node.get("pane_id")
        if isinstance(value, str) and value:
            return value
        for child in node.values():
            found = via_search(child)
            if found:
                return found
    elif isinstance(node, list):
        for child in node:
            found = via_search(child)
            if found:
                return found
    return None


def main():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except Exception as exc:
        print("herdr-pane-id: response is not JSON (%s)" % exc, file=sys.stderr)
        return 1

    result = data.get("result") if isinstance(data, dict) else None
    if not isinstance(result, dict):
        result = data if isinstance(data, dict) else {}

    pane_id = via_known_paths(result) or via_search(data)
    if not pane_id:
        # Name the keys we did get, so the next person can add the shape
        # instead of guessing at an empty variable.
        keys = ", ".join(sorted(result)) if isinstance(result, dict) else "(none)"
        print("herdr-pane-id: no pane id in response; result keys: %s" % keys,
              file=sys.stderr)
        return 1

    print(pane_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Development notes

## Why this exists

The community plugins for this job throw on all-pages mode:

> Error: in findAll: Cannot access method `findAll()` on a page that has not been explicitly loaded.

That is a bug in those plugins, not a setting. Under Figma's `documentAccess: "dynamic-page"`
model only the current page is in memory; `figma.root.findAll()` requires an awaited
`figma.loadAllPagesAsync()` (or `page.loadAsync()` per page) first, and they never call it.
Community plugin source is not editable locally, hence this.

## Files

| File | Role |
|---|---|
| `manifest.json` | `documentAccess: "dynamic-page"`, `networkAccess: none` |
| `code.js` | Plugin sandbox: variable/page enumeration, per-page scan, alias graph, reveal-on-canvas, `clientStorage` settings |
| `ui.html` | Whole UI, inline CSS + JS, no build step |

No build, no dependencies. Import via **Plugins > Development > Import plugin from manifest…**

## Architecture

Scan is an explicit-stack DFS per page, not `findAll`, so a name-pattern match can prune a
whole subtree cheaply and progress can be reported between pages.

`boundVariables` mixes three shapes — a plain alias (`opacity`), arrays of aliases (`fills`,
`strokes`, `effects`) and nested maps (`componentProperties`). `walk()` handles all of them
and labels each hit with its property path (`fills[0]`, `property:Label`). Instance
component-property bindings are collected separately.

Location for a hit is derived by walking ancestors once, on hit only, to find the nearest
component set, component, and host instance, plus the top-level frame. Variant strings come
from `variantProperties`, falling back to VARIANT-typed `componentProperties` for instances.

"Follow aliases" builds a reverse alias graph over local variables (referenced -> consumers)
and BFSes it, so a primitive with zero direct bindings still reports the layers that reach
it through a semantic variable.

## Performance

`figma.loadAllPagesAsync()` on a 178-page library exceeds 30s. `page.loadAsync()` per page
runs roughly 5s per 50k nodes and keeps the UI responsive, which is why the scan streams
per-page results and can be stopped.

Measured on a 178-page library, six pages / 52,848 layers, pages preloaded so the timing
excludes page loading:

| Variant | Time | Layers walked | Bindings found |
|---|---|---|---|
| Allocating `collectBindings`, flag off | 10.7s | 52,848 | 100 |
| Null-returning `collectBindings`, flag off | 6.2s | 52,848 | 100 |
| Both, `skipInvisibleInstanceChildren` on | 2.3s | 22,373 | 100 |

42% from the allocation change, a further 63% from the flag, **79% overall**, with no
change in results on that sample — the 30,475 skipped layers held no bindings.

Four things keep a whole-document scan from feeling stuck:

- `figma.skipInvisibleInstanceChildren` is set from the matching option (default on), so
  traversal skips hidden layers inside instances.
- `collectBindings()` returns `null` instead of an empty array, and pre-checks
  `boundVariables` for emptiness, so the common no-bindings node costs no allocation.
- The inner DFS flushes a `tick` message and yields with `setTimeout(0)` on a 120ms budget,
  checked every 2048 nodes. Without it a single 200k-layer page would post nothing from
  start to finish. Yielding also stops the scan from freezing the Figma window.
- The UI throttles full result re-renders to once per 250ms while streaming, and the
  progress bar's stripe and sweep are pure CSS, so they keep moving even when the sandbox
  is busy and posting nothing. Both respect `prefers-reduced-motion`.

If you drive this file's logic through an MCP Figma bridge for testing, note that a timed-out
`loadAllPagesAsync()` wedges the plugin sandbox for several minutes — every subsequent
execute times out until it clears.

## Verification state

| Part | Status |
|---|---|
| `collectBindings`, `describe`, variant strings, property paths, per-page totals | Verified against a 178-page, ~434k-node library. Component set, variant, host instance and field labels all resolve; per-page totals matched an independent scan. |
| `code.js` and `ui.html` syntax | Verified with `node --check` (UI script extracted from the HTML). |
| Name-pattern exclusion | Verified. Substring and glob forms prune identically (85 -> 66 hits, 4,144 subtrees pruned, 3.2s -> 1.9s on one page); a comma-separated pair pruned 8,039 subtrees on another; a non-matching pattern leaves results byte-identical to the baseline. |
| `Skip inside instances` | Verified. 19,263 layers walked down to 901, 3.2s to 0.08s, hits 85 -> 65. |
| Page exclusion checklist | Logic verified as a set filter over `figma.root.children`; the checklist UI itself is untested. |
| Two-pane layout, page checklist rendering, `clientStorage` persistence, CSV copy, reveal-on-canvas | Not run live. A local dev plugin cannot be driven from an MCP bridge. |

## Not implemented

- Library (remote) variables in the picker — local only.
- Per-character text range bindings via `getRangeBoundVariable`.
- Variable references from paint/text styles.
- Result list caps at 8000 rows; counts stay accurate above that.
- Window resize handle.

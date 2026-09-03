# Variable Usage Map

Figma plugin. Finds every layer in the **whole document** bound to a chosen variable
and shows where it lives: page, component set, variant, host instance, layer, and which
property is bound.

<img width="600" height="auto" alt="Screenshot 2026-09-03 at 09 34 22" src="https://github.com/user-attachments/assets/7bfcf519-1242-42c7-9de9-4ddfb21d1eac" />
<img width="600" height="auto" alt="Screenshot 2026-09-03 at 09 34 43" src="https://github.com/user-attachments/assets/0def2827-ed0e-452e-a188-4852a974f92a" />
<img width="600" height="auto" alt="Screenshot 2026-09-03 at 09 35 24" src="https://github.com/user-attachments/assets/a106bd87-fafe-4987-81b9-6d9002c854e2" />





## Install

1. Figma desktop: **Plugins > Development > Import plugin from manifest…**
2. Pick `manifest.json` in this folder.
3. Run it from **Plugins > Development > Variable Usage Map**.

## Use

1. Filter the variable list by name, tick one or more. Ticking several maps them in one pass.
2. Optionally narrow the scan (see Excluding below).
3. **Scan**. Progress shows pages done, bindings found and layers walked. **Stop** ends it early and keeps partial results.
4. Expand a page, then a component set. Click a row to jump: it switches page, selects the layer and zooms to it. Double-click a group header to select every match in that group at once.
5. **Copy CSV** exports the full table.

## Excluding

Two independent filters, both remembered per file between runs:

**Pages** — checklist of every page in document order. Untick to exclude. Filter the list
by name, then **Exclude shown** / **Include shown** to drop or restore a whole section in
one click. **All**, **None** and **Only current** are shortcuts. The header shows how many
pages are in scope.

**Exclude by name** — comma or line separated patterns matched against layer names. Plain
text matches any part of a name (`Icons`); add `*` for a whole-name glob
(`Lucide Icons / *`, `*Deprecated*`). A match skips that layer **and its whole subtree**,
so it excludes component sets, components and instances alike, and speeds up the scan
rather than just filtering output. The summary reports how many layers were skipped this way.

## Alias graph

Second tab on the right. Draws variables as a map of alias links: who references what,
laid out left to right so consumers sit left of the primitives they resolve to, one column
per step in the chain. Edges are labelled with the mode the alias belongs to, so a semantic
variable that points at different primitives in Light and Dark shows both links.

Large token systems are too dense to draw whole, so the graph focuses by default:

- Type a name to focus on it, or tick variables on the left — the graph shows their
  neighbourhood, 1 to 3 hops or the whole chain.
- **Show all** renders everything anyway. Past 600 nodes it declines and asks you to narrow.
- Hover a node to fade everything not on its chain, up and down.
- Click a node to select that variable on the left, ready to scan. Double-click to re-centre.
- Drag to pan, scroll to zoom, **Fit** to frame it.
- Nodes are coloured by collection. Aliases pointing outside the file are drawn as
  `outside this file`, so you can see where a chain leaves for a subscribed library.

**Following one mode.** Each mode in the file gets a chip in the graph toolbar. Click to
toggle it off and its alias links disappear, along with any node only reachable through it.
Double-click a chip to follow that mode alone — useful when a collection's modes point at
different primitives and you only care about one path. With a single mode active the edge
labels are dropped, since there is nothing left to disambiguate, and the toolbar says which
mode you are following.

**Count bindings** runs one pass over the document and tallies bindings for *every*
variable at once, then annotates each node with its count. Variables with none get a dashed
outline, and **unused only** filters the graph down to them — that is the fast way to find
dead tokens, including primitives that look unused but are in fact reached through an alias.
It honours the same page and name exclusions as a normal scan.

## Options

- **Follow aliases** — also reports layers that reach the variable indirectly, through
  another variable that aliases it. If a primitive like `color/light/accent` has no direct
  bindings because layers bind a semantic `accent` that aliases to it per mode, those rows
  appear tagged `via accent`.
- **Skip inside instances** — reports the instance itself but does not walk its internals.
  Much faster and far less noise when you only care about main components.
- **Skip hidden layers inside instances** — on by default. Uses Figma's own
  `skipInvisibleInstanceChildren` traversal fast path, which is a large speedup on big
  documents. Note it genuinely skips those layers, so a binding that only exists on a
  hidden layer inside an instance will not be reported. Turn it off for an exhaustive pass.

## Limitations

- Local variables only. Variables consumed from another library are not listed in the picker.
- Per-character text range bindings (`getRangeBoundVariable`) are not scanned; whole-node
  text fills are.
- Variable references from paint/text styles are not scanned.
- Result list caps at 8000 rows; counts stay accurate above that.

## License

MIT

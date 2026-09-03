# Variable Usage Map

Figma plugin. Finds every layer in the **whole document** bound to a chosen variable
and shows where it lives: page, component set, variant, host instance, layer, and which
property is bound.

<img width="600" height="auto" alt="Screenshot 2026-09-03 at 08 50 19" src="https://github.com/user-attachments/assets/b851ae84-68a2-48f1-8942-d34bfff8a1db" />
<img width="600" height="auto" alt="Screenshot 2026-09-03 at 08 53 33" src="https://github.com/user-attachments/assets/a8fa1f40-380e-4d67-81b2-a7d9dd8d1804" />


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

## Options

- **Follow aliases** — also reports layers that reach the variable indirectly, through
  another variable that aliases it. If a primitive like `color/light/accent` has no direct
  bindings because layers bind a semantic `accent` that aliases to it per mode, those rows
  appear tagged `via accent`.
- **Skip inside instances** — reports the instance itself but does not walk its internals.
  Much faster and far less noise when you only care about main components.

## Limitations

- Local variables only. Variables consumed from another library are not listed in the picker.
- Per-character text range bindings (`getRangeBoundVariable`) are not scanned; whole-node
  text fills are.
- Variable references from paint/text styles are not scanned.
- Result list caps at 8000 rows; counts stay accurate above that.

## License

MIT

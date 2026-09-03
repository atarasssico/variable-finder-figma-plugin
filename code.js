// Variable Usage Map
// Finds every node in the document bound to the selected variable(s) and reports
// page / component set / variant / instance / node / bound property for each one.
//
// Loads pages one at a time with page.loadAsync() instead of figma.loadAllPagesAsync(),
// which keeps large libraries responsive and progress reportable.

const MAX_HITS = 8000;
const SETTINGS_KEY = 'vum-settings-' + (figma.fileKey || figma.root.id);
const state = { scanning: false, cancel: false };

figma.showUI(__html__, { width: 920, height: 680, themeColors: true });

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'init') return await sendInit();
    if (msg.type === 'graph') return await sendGraph();
    if (msg.type === 'count-all') return await countAll(msg);
    if (msg.type === 'scan') return await runScan(msg);
    if (msg.type === 'cancel') { state.cancel = true; return; }
    if (msg.type === 'reveal') return await reveal(msg.pageId, msg.nodeIds);
  } catch (err) {
    state.scanning = false;
    figma.ui.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};

/* ---------- init: variables, pages, saved settings ---------- */

function toHex(c) {
  const p = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
  return '#' + p(c.r) + p(c.g) + p(c.b);
}

async function sendInit() {
  const [vars, collections] = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
  ]);
  const byId = new Map(vars.map((v) => [v.id, v]));
  const colById = new Map(collections.map((c) => [c.id, c]));

  const resolve = (variable, modeId, depth) => {
    if (!variable || depth > 8) return null;
    const raw = variable.valuesByMode[modeId];
    if (raw === undefined) return null;
    if (raw && raw.type === 'VARIABLE_ALIAS') {
      const next = byId.get(raw.id);
      if (!next) return null;
      const col = colById.get(next.variableCollectionId);
      if (!col) return null;
      const nextMode = col.modes.some((m) => m.modeId === modeId) ? modeId : col.defaultModeId;
      return resolve(next, nextMode, depth + 1);
    }
    return raw;
  };

  const variables = vars.map((v) => {
    const col = colById.get(v.variableCollectionId);
    const previews = (col ? col.modes : []).map((m) => {
      const val = resolve(v, m.modeId, 0);
      if (val && typeof val === 'object' && 'r' in val) return { mode: m.name, hex: toHex(val) };
      return { mode: m.name, text: val === null || val === undefined ? '—' : String(val) };
    });
    return { id: v.id, name: v.name, type: v.resolvedType, collection: col ? col.name : 'unknown', previews };
  });
  variables.sort((a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name));

  // Page names are readable without loading the page.
  const pages = figma.root.children.map((p) => ({ id: p.id, name: p.name }));

  let settings = null;
  try {
    settings = await figma.clientStorage.getAsync(SETTINGS_KEY);
  } catch (err) {
    settings = null;
  }

  figma.ui.postMessage({
    type: 'init-data',
    variables,
    pages,
    settings: settings || null,
    fileName: figma.root.name,
    currentPageId: figma.currentPage.id,
  });
}

/* ---------- alias graph ---------- */

async function sendGraph() {
  const [vars, collections] = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
  ]);
  const colById = new Map(collections.map((c) => [c.id, c]));
  const known = new Set(vars.map((v) => v.id));

  const nodes = vars.map((v) => {
    const col = colById.get(v.variableCollectionId);
    return {
      id: v.id,
      name: v.name,
      type: v.resolvedType,
      collection: col ? col.name : 'unknown',
    };
  });

  const edges = [];
  const missing = new Set();
  for (const v of vars) {
    const col = colById.get(v.variableCollectionId);
    for (const modeId in v.valuesByMode) {
      const val = v.valuesByMode[modeId];
      if (!val || val.type !== 'VARIABLE_ALIAS') continue;
      const mode = col ? (col.modes.find((m) => m.modeId === modeId) || {}).name : '';
      edges.push({ from: v.id, to: val.id, mode: mode || '' });
      if (!known.has(val.id)) missing.add(val.id);
    }
  }

  // Aliases can point at variables from a subscribed library. Resolve their
  // names so the graph shows where a chain leaves this file.
  for (const id of missing) {
    let name = 'library variable';
    try {
      const remote = await figma.variables.getVariableByIdAsync(id);
      if (remote) name = remote.name;
    } catch (err) {
      /* unresolvable, keep the placeholder */
    }
    nodes.push({ id, name, type: 'UNKNOWN', collection: 'external', external: true });
  }

  figma.ui.postMessage({
    type: 'graph-data',
    nodes,
    edges,
    collections: collections.map((c) => c.name).concat(missing.size ? ['external'] : []),
  });
}

/* ---------- count bindings for every variable ---------- */

async function countAll(opts) {
  if (state.scanning) return;
  state.scanning = true;
  state.cancel = false;
  figma.skipInvisibleInstanceChildren = opts.skipHiddenInInstances !== false;

  const excluded = new Set(opts.excludedPageIds || []);
  const pages = figma.root.children.filter((p) => !excluded.has(p.id));
  const matchers = compilePatterns(opts.excludeText);
  const counts = Object.create(null);

  const FLUSH_MS = 120;
  let lastFlush = Date.now();
  let nodesScanned = 0;

  figma.ui.postMessage({ type: 'count-start', totalPages: pages.length });

  for (let p = 0; p < pages.length; p++) {
    if (state.cancel) break;
    const page = pages[p];
    figma.ui.postMessage({ type: 'page-start', index: p, totalPages: pages.length, pageName: page.name });
    await page.loadAsync();

    const stack = [];
    for (let i = page.children.length - 1; i >= 0; i--) stack.push(page.children[i]);
    let sinceCheck = 0;

    while (stack.length) {
      if (++sinceCheck >= 2048) {
        sinceCheck = 0;
        const now = Date.now();
        if (now - lastFlush >= FLUSH_MS) {
          lastFlush = now;
          figma.ui.postMessage({
            type: 'tick', index: p, totalPages: pages.length, pageName: page.name,
            nodesScanned, totalHits: 0, queued: stack.length,
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const node = stack.pop();
      let skip = false;
      for (let m = 0; m < matchers.length; m++) {
        if (matchers[m].test(node.name)) { skip = true; break; }
      }
      if (skip) continue;
      nodesScanned++;

      const bindings = collectBindings(node);
      if (bindings) {
        const seen = new Set();
        for (const b of bindings) {
          if (seen.has(b.id)) continue;
          seen.add(b.id);
          counts[b.id] = (counts[b.id] || 0) + 1;
        }
      }

      if ('children' in node && node.children.length) {
        if (opts.skipInsideInstances && node.type === 'INSTANCE') continue;
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
      }
    }
  }

  state.scanning = false;
  figma.ui.postMessage({ type: 'count-done', counts, nodesScanned, cancelled: state.cancel });
}

/* ---------- exclusion patterns ---------- */

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Comma or newline separated. Plain text matches as a case-insensitive substring;
// a pattern containing * is treated as a glob anchored to the whole name.
function compilePatterns(raw) {
  const out = [];
  const parts = String(raw || '').split(/[,\n]/);
  for (const part of parts) {
    const s = part.trim();
    if (!s) continue;
    if (s.indexOf('*') !== -1) {
      const rx = new RegExp('^' + s.split('*').map(escapeRx).join('.*') + '$', 'i');
      out.push({ source: s, test: (name) => rx.test(name) });
    } else {
      const lower = s.toLowerCase();
      out.push({ source: s, test: (name) => name.toLowerCase().indexOf(lower) !== -1 });
    }
  }
  return out;
}

/* ---------- binding collection ---------- */

// boundVariables mixes shapes: a plain alias (opacity), arrays of aliases (fills,
// strokes, effects) and nested maps (componentProperties). Walk all of them.
function walk(obj, prefix, out, depth) {
  if (!obj || depth > 4) return;
  for (const key in obj) {
    const val = obj[key];
    if (!val || typeof val !== 'object') continue;
    const label = prefix ? prefix + '.' + key : key;
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const item = val[i];
        if (!item || typeof item !== 'object') continue;
        if (typeof item.id === 'string') out.push({ id: item.id, field: label + '[' + i + ']' });
        else walk(item, label + '[' + i + ']', out, depth + 1);
      }
    } else if (typeof val.id === 'string') {
      out.push({ id: val.id, field: label });
    } else {
      walk(val, label, out, depth + 1);
    }
  }
}

function isEmpty(obj) {
  for (const k in obj) return false;
  return true;
}

// Returns null rather than an empty array: this runs once per node, so skipping
// the allocation matters on documents with hundreds of thousands of layers.
function collectBindings(node) {
  const bv = node.boundVariables;
  const props = node.type === 'INSTANCE' ? node.componentProperties : null;
  const noBv = !bv || isEmpty(bv);
  if (noBv && !props) return null;

  const out = [];
  if (!noBv) walk(bv, '', out, 0);
  if (props) {
    for (const key in props) {
      const p = props[key];
      if (p && p.boundVariables) walk(p.boundVariables, 'property:' + key.split('#')[0], out, 0);
    }
  }
  return out.length ? out : null;
}

/* ---------- location description ---------- */

function variantString(node) {
  if (node.variantProperties) {
    const parts = [];
    for (const k in node.variantProperties) parts.push(k + '=' + node.variantProperties[k]);
    if (parts.length) return parts.join(', ');
  }
  if (node.type === 'INSTANCE' && node.componentProperties) {
    const parts = [];
    const props = node.componentProperties;
    for (const k in props) if (props[k] && props[k].type === 'VARIANT') parts.push(k + '=' + props[k].value);
    if (parts.length) return parts.join(', ');
  }
  return null;
}

function describe(node) {
  let component = node.type === 'COMPONENT' ? node : null;
  let componentSet = node.type === 'COMPONENT_SET' ? node : null;
  let instance = node.type === 'INSTANCE' ? node : null;
  let topLevel = node;

  let cur = node.parent;
  while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') {
    if (!instance && cur.type === 'INSTANCE') instance = cur;
    if (!component && cur.type === 'COMPONENT') component = cur;
    if (!componentSet && cur.type === 'COMPONENT_SET') componentSet = cur;
    topLevel = cur;
    cur = cur.parent;
  }

  return {
    componentSet: componentSet ? componentSet.name : null,
    component: component ? component.name : null,
    variant: variantString(component || instance || node),
    instance: instance ? instance.name : null,
    topLevel: topLevel.name,
    insideInstance: !!instance && instance !== node,
  };
}

/* ---------- scan ---------- */

async function runScan(opts) {
  if (state.scanning) return;
  state.scanning = true;
  state.cancel = false;

  try {
    await figma.clientStorage.setAsync(SETTINGS_KEY, {
      excludedPageIds: opts.excludedPageIds || [],
      excludeText: opts.excludeText || '',
      followAliases: !!opts.followAliases,
      skipInsideInstances: !!opts.skipInsideInstances,
      skipHiddenInInstances: opts.skipHiddenInInstances !== false,
    });
  } catch (err) {
    /* storage is best effort */
  }

  const vars = await figma.variables.getLocalVariablesAsync();
  const byId = new Map(vars.map((v) => [v.id, v]));

  const targets = new Map();
  for (const id of opts.variableIds) {
    const v = byId.get(id);
    targets.set(id, { name: v ? v.name : id, via: null });
  }

  if (opts.followAliases) {
    const consumers = new Map(); // referenced id -> Set(consumer ids)
    for (const v of vars) {
      for (const modeId in v.valuesByMode) {
        const val = v.valuesByMode[modeId];
        if (val && val.type === 'VARIABLE_ALIAS') {
          if (!consumers.has(val.id)) consumers.set(val.id, new Set());
          consumers.get(val.id).add(v.id);
        }
      }
    }
    const queue = opts.variableIds.slice();
    const seen = new Set(queue);
    while (queue.length) {
      const cur = queue.shift();
      const list = consumers.get(cur);
      if (!list) continue;
      for (const cid of list) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        const v = byId.get(cid);
        targets.set(cid, { name: v ? v.name : cid, via: targets.get(cur).name });
        queue.push(cid);
      }
    }
  }

  // Documented fast path: traversal skips hidden layers inside instances.
  figma.skipInvisibleInstanceChildren = opts.skipHiddenInInstances !== false;

  const excluded = new Set(opts.excludedPageIds || []);
  const pages = figma.root.children.filter((p) => !excluded.has(p.id));
  const matchers = compilePatterns(opts.excludeText);

  const FLUSH_MS = 120;
  let lastFlush = Date.now();
  let nodesScanned = 0;
  let totalHits = 0;
  let prunedSubtrees = 0;
  let truncated = false;
  const perVariable = {};

  figma.ui.postMessage({
    type: 'scan-start',
    totalPages: pages.length,
    skippedPages: figma.root.children.length - pages.length,
    patterns: matchers.map((m) => m.source),
    targets: Array.from(targets.entries()).map(([id, t]) => ({ id, name: t.name, via: t.via })),
  });

  if (!pages.length) {
    state.scanning = false;
    figma.ui.postMessage({ type: 'scan-done', cancelled: false, nodesScanned: 0, totalHits: 0, prunedSubtrees: 0, truncated: false, perVariable: {}, noPages: true });
    return;
  }

  for (let p = 0; p < pages.length; p++) {
    if (state.cancel) break;
    const page = pages[p];
    figma.ui.postMessage({ type: 'page-start', index: p, totalPages: pages.length, pageName: page.name });
    await page.loadAsync();

    const hits = [];
    const stack = [];
    for (let i = page.children.length - 1; i >= 0; i--) stack.push(page.children[i]);

    let sinceCheck = 0;
    while (stack.length) {
      // Yield on a time budget, not a node count: one page can hold 200k layers,
      // and without this the UI gets no message until the whole page is done.
      if (++sinceCheck >= 2048) {
        sinceCheck = 0;
        const now = Date.now();
        if (now - lastFlush >= FLUSH_MS) {
          lastFlush = now;
          figma.ui.postMessage({
            type: 'tick',
            index: p,
            totalPages: pages.length,
            pageName: page.name,
            nodesScanned,
            totalHits,
            queued: stack.length,
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const node = stack.pop();

      let skip = false;
      for (let m = 0; m < matchers.length; m++) {
        if (matchers[m].test(node.name)) { skip = true; break; }
      }
      if (skip) { prunedSubtrees++; continue; }

      nodesScanned++;

      const bindings = collectBindings(node);
      if (bindings) {
        const matched = new Map();
        for (const b of bindings) {
          if (!targets.has(b.id)) continue;
          if (!matched.has(b.id)) matched.set(b.id, []);
          matched.get(b.id).push(b.field);
        }
        for (const [varId, fields] of matched) {
          const t = targets.get(varId);
          perVariable[t.name] = (perVariable[t.name] || 0) + 1;
          totalHits++;
          if (totalHits <= MAX_HITS) {
            hits.push(
              Object.assign(
                {
                  nodeId: node.id,
                  nodeName: node.name,
                  nodeType: node.type,
                  variable: t.name,
                  via: t.via,
                  fields: Array.from(new Set(fields)),
                },
                describe(node)
              )
            );
          } else {
            truncated = true;
          }
        }
      }

      if ('children' in node && node.children.length) {
        if (opts.skipInsideInstances && node.type === 'INSTANCE') continue;
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
      }
    }

    figma.ui.postMessage({
      type: 'page-done',
      index: p,
      totalPages: pages.length,
      pageId: page.id,
      pageName: page.name,
      hits,
      nodesScanned,
      totalHits,
      prunedSubtrees,
    });
  }

  state.scanning = false;
  figma.ui.postMessage({
    type: 'scan-done',
    cancelled: state.cancel,
    nodesScanned,
    totalHits,
    prunedSubtrees,
    truncated,
    perVariable,
  });
}

/* ---------- reveal on canvas ---------- */

async function reveal(pageId, nodeIds) {
  const page = await figma.getNodeByIdAsync(pageId);
  if (!page || page.type !== 'PAGE') throw new Error('That page no longer exists.');
  await page.loadAsync();
  if (figma.currentPage.id !== page.id) await figma.setCurrentPageAsync(page);

  const nodes = [];
  for (const id of nodeIds) {
    const n = await figma.getNodeByIdAsync(id);
    if (n && !n.removed && n.type !== 'PAGE' && n.type !== 'DOCUMENT') nodes.push(n);
  }
  if (!nodes.length) throw new Error('Those layers no longer exist. Re-run the scan.');

  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
  figma.ui.postMessage({ type: 'revealed', count: nodes.length });
}

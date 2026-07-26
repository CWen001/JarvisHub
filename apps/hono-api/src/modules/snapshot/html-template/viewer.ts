/**
 * Vanilla JS viewer for the exported snapshot. Embedded as a string
 * into the single .html. Zero runtime dependency.
 *
 * Responsibilities:
 *   - Fit-to-frame scaling: each .snapshot-canvas-frame has data-bounds-{w,h}.
 *     The cloned .react-flow__viewport inside is in native canvas pixels;
 *     we set transform = translate(-bx,-by) scale(K) where K = frameW / boundsW.
 *     Re-applied on resize to stay responsive.
 *   - Render the AI chat panel from window.__SNAPSHOT__.conversation
 *     (mirroring the live JarvisHub layout: user-right blue / assistant-left gray,
 *     todos inline, tool calls foldable).
 */
export const SNAPSHOT_VIEWER_JS = String.raw`
(function() {
  var DATA = window.__SNAPSHOT__ || {};
  var conversation = DATA.conversation || { sessions: [] };
  var ASSET_REGISTRY = (window.__SNAPSHOT_ASSETS__ && typeof window.__SNAPSHOT_ASSETS__ === "object") ? window.__SNAPSHOT_ASSETS__ : {};

  // \`data:asset/x-jh;id=<id>\` is a content-addressable placeholder
  // written by the server-side pipeline whenever an asset is inlined as
  // base64. The actual data URI lives in window.__SNAPSHOT_ASSETS__ exactly
  // once; we expand the placeholder back into the real data URI here so DOM
  // elements, nodeMeta JSON, and the PPT carousel all share that single copy.
  var ASSET_TOKEN_RE = /data:asset\/x-jh;id=([A-Za-z0-9_-]{4,32})/g;

  function resolveAssetToken(value) {
    if (typeof value !== "string" || value.indexOf("data:asset/x-jh;id=") < 0) return value;
    return value.replace(ASSET_TOKEN_RE, function(match, id) {
      var uri = ASSET_REGISTRY[id];
      return typeof uri === "string" && uri ? uri : match;
    });
  }

  // Decode a base64-encoded SVG data URI, expand any embedded asset tokens
  // (e.g. background images referenced by \`<image href="data:asset/x-jh;id=...">\`),
  // and re-encode the SVG so that the browser can load it directly through an
  // image element without further JS hooks.
  function rehydrateSvgDataUri(value) {
    if (typeof value !== "string") return value;
    if (value.indexOf("data:image/svg+xml;base64,") !== 0) return resolveAssetToken(value);
    var header = "data:image/svg+xml;base64,";
    var b64 = value.slice(header.length);
    var decoded;
    try {
      decoded = atob(b64);
    } catch (err) {
      return value;
    }
    if (decoded.indexOf("data:asset/x-jh;id=") < 0) return value;
    var expanded = decoded.replace(ASSET_TOKEN_RE, function(match, id) {
      var uri = ASSET_REGISTRY[id];
      return typeof uri === "string" && uri ? uri : match;
    });
    if (expanded === decoded) return value;
    var reBytes;
    try {
      reBytes = btoa(expanded);
    } catch (err) {
      return value;
    }
    return header + reBytes;
  }

  function rehydrateNodeMeta(meta) {
    if (!meta || typeof meta !== "object") return meta;
    if (Array.isArray(meta)) {
      for (var i = 0; i < meta.length; i++) meta[i] = rehydrateNodeMeta(meta[i]);
      return meta;
    }
    var keys = Object.keys(meta);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var v = meta[key];
      if (typeof v === "string") meta[key] = resolveAssetToken(v);
      else if (v && typeof v === "object") rehydrateNodeMeta(v);
    }
    return meta;
  }

  // Attributes that carry asset URLs in our exported HTML. \`xlink:href\`
  // appears on SVG <image>; we read it via getAttribute("xlink:href") which
  // works regardless of CSS-selector escaping rules.
  var REHYDRATE_ATTRS = ["src", "href", "xlink:href", "data", "poster", "srcset", "style"];

  function rehydrateElement(node) {
    if (!node || !node.getAttribute || !node.setAttribute) return;
    for (var i = 0; i < REHYDRATE_ATTRS.length; i++) {
      var attr = REHYDRATE_ATTRS[i];
      var current = node.getAttribute(attr);
      if (!current) continue;
      // First, rewrite SVG data URIs: their embedded placeholders need to
      // be expanded *inside* the base64 payload so the browser does not
      // attempt to fetch \`data:asset/x-jh;id=...\` recursively.
      var next = current;
      if (next.indexOf("data:image/svg+xml;base64,") === 0) {
        var rehydrated = rehydrateSvgDataUri(next);
        if (rehydrated !== next) next = rehydrated;
      }
      if (next.indexOf("data:asset/x-jh;id=") >= 0) {
        var resolved = resolveAssetToken(next);
        if (resolved !== next) next = resolved;
      }
      if (next !== current) node.setAttribute(attr, next);
    }
  }

  function rehydrateDom(root) {
    if (!root) return;
    // Walk every element under the canvas host once. The vast majority of
    // nodes have no asset attribute, so this is dominated by querySelectorAll
    // cost. We deliberately do NOT use the CSS attribute selector form
    // because \`xlink:href\` requires backslash-escaping the colon in CSS,
    // which html-to-image already had to special-case in earlier exports.
    var all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (var i = 0; i < all.length; i++) {
      rehydrateElement(all[i]);
    }
  }

  if (DATA && DATA.nodeMeta) DATA.nodeMeta = rehydrateNodeMeta(DATA.nodeMeta);

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function(k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "style") node.setAttribute("style", attrs[k]);
        else if (k.indexOf("data-") === 0) node.setAttribute(k, attrs[k]);
        else if (k === "text") node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function(c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function safeParse(s) {
    if (!s || typeof s !== "string") return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function parseTranslate(node) {
    var t = node.style.transform || "";
    var m = /translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*\)/.exec(t);
    return { x: m ? parseFloat(m[1]) : 0, y: m ? parseFloat(m[2]) : 0 };
  }

  function setNodeTranslate(node, x, y) {
    var t = node.style.transform || "";
    var rep = "translate(" + x + "px, " + y + "px)";
    if (/translate\(/.test(t)) {
      node.style.transform = t.replace(/translate\([^)]*\)/, rep);
    } else {
      node.style.transform = rep + (t ? " " + t : "");
    }
  }

  function looksLikeNaturalSummary(s) {
    if (!s || typeof s !== "string") return false;
    var trimmed = s.trim();
    if (trimmed.length === 0 || trimmed.length > 80) return false;
    if (/^[\{\[]/.test(trimmed)) return false;
    if (/"[\w_]+"\s*:/.test(trimmed)) return false;
    return true;
  }

  function formatTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var pad = function(n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
           " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  var FRAME_STATE = [];

  function getFrameState(frame) {
    for (var i = 0; i < FRAME_STATE.length; i++) {
      if (FRAME_STATE[i].frame === frame) return FRAME_STATE[i];
    }
    var st = { frame: frame, tx: 0, ty: 0, scale: 1, bw: 0, bh: 0, bx: 0, by: 0, viewport: null, panZoomReady: false };
    FRAME_STATE.push(st);
    return st;
  }

  function applyTransform(st) {
    if (!st.viewport) return;
    st.viewport.style.transform = "translate(" + st.tx + "px, " + st.ty + "px) scale(" + st.scale + ")";
    st.viewport.style.transformOrigin = "top left";
    st.viewport.style.width = st.bw + "px";
    st.viewport.style.height = st.bh + "px";
  }

  function setupPanZoom(st) {
    if (st.panZoomReady) return;
    st.panZoomReady = true;
    var frame = st.frame;
    frame.style.cursor = "grab";

    frame.addEventListener("wheel", function(e) {
      e.preventDefault();
      var rect = frame.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var factor = Math.exp(-e.deltaY * 0.0015);
      var newScale = Math.max(0.1, Math.min(4, st.scale * factor));
      var ratio = newScale / st.scale;
      st.tx = mx - (mx - st.tx) * ratio;
      st.ty = my - (my - st.ty) * ratio;
      st.scale = newScale;
      applyTransform(st);
    }, { passive: false });

    var dragging = false;
    var startX = 0;
    var startY = 0;
    var startTx = 0;
    var startTy = 0;

    frame.addEventListener("mousedown", function(e) {
      if (e.button !== 0) return;
      var t = e.target;
      if (t && t.closest && t.closest(".react-flow__node, button, input, textarea, video, a, [contenteditable='true']")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startTx = st.tx;
      startTy = st.ty;
      frame.style.cursor = "grabbing";
      e.preventDefault();
    });

    window.addEventListener("mousemove", function(e) {
      if (!dragging) return;
      st.tx = startTx + (e.clientX - startX);
      st.ty = startTy + (e.clientY - startY);
      applyTransform(st);
    });

    window.addEventListener("mouseup", function() {
      if (!dragging) return;
      dragging = false;
      frame.style.cursor = "grab";
    });
  }

  function setupNodeDrag(st) {
    var nodes = st.frame.querySelectorAll(".react-flow__node");
    Array.prototype.forEach.call(nodes, function(node) {
      if (node.__panDragReady) return;
      node.__panDragReady = true;
      node.style.cursor = "move";
      var dragging = false;
      var startMx = 0, startMy = 0, startNx = 0, startNy = 0;

      node.addEventListener("mousedown", function(e) {
        if (e.button !== 0) return;
        var t = e.target;
        if (t && t.closest && t.closest("button, input, textarea, video, a, [contenteditable='true']")) return;
        e.stopPropagation();
        e.preventDefault();
        dragging = true;
        var pos = parseTranslate(node);
        startNx = pos.x; startNy = pos.y;
        startMx = e.clientX; startMy = e.clientY;
        node.style.zIndex = "1000";
        node.style.cursor = "grabbing";
      });

      window.addEventListener("mousemove", function(e) {
        if (!dragging) return;
        var k = st.scale || 1;
        var dx = (e.clientX - startMx) / k;
        var dy = (e.clientY - startMy) / k;
        setNodeTranslate(node, startNx + dx, startNy + dy);
        redrawEdges(st, node);
      });

      window.addEventListener("mouseup", function() {
        if (!dragging) return;
        dragging = false;
        node.style.cursor = "move";
      });
    });
  }

  function setupEdges(st) {
    if (st.edgesReady) return;
    st.edgesReady = true;
    var nodeMap = {};
    Array.prototype.forEach.call(st.frame.querySelectorAll(".react-flow__node"), function(n) {
      var id = n.getAttribute("data-id");
      if (id) nodeMap[id] = n;
    });
    var labelRe = /^Edge from (.+) to (.+)$/;
    var pathRe = /M\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*C\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/;
    var edgesByNode = {};
    Array.prototype.forEach.call(st.frame.querySelectorAll(".react-flow__edge"), function(g) {
      var label = g.getAttribute("aria-label") || "";
      var lm = labelRe.exec(label);
      if (!lm) return;
      var src = nodeMap[lm[1]];
      var tgt = nodeMap[lm[2]];
      if (!src || !tgt) return;
      var paths = g.querySelectorAll("path");
      if (paths.length === 0) return;
      var d = paths[0].getAttribute("d") || "";
      var pm = pathRe.exec(d);
      if (!pm) return;
      var sx = parseFloat(pm[1]), sy = parseFloat(pm[2]);
      var c1x = parseFloat(pm[3]), c1y = parseFloat(pm[4]);
      var c2x = parseFloat(pm[5]), c2y = parseFloat(pm[6]);
      var tx = parseFloat(pm[7]), ty = parseFloat(pm[8]);
      var sp = parseTranslate(src);
      var tp = parseTranslate(tgt);
      var info = {
        paths: paths,
        src: src,
        tgt: tgt,
        sxOff: sx - sp.x, syOff: sy - sp.y,
        c1xOff: c1x - sp.x, c1yOff: c1y - sp.y,
        c2xOff: c2x - tp.x, c2yOff: c2y - tp.y,
        txOff: tx - tp.x, tyOff: ty - tp.y
      };
      var sid = lm[1], tid = lm[2];
      (edgesByNode[sid] = edgesByNode[sid] || []).push(info);
      if (tid !== sid) (edgesByNode[tid] = edgesByNode[tid] || []).push(info);
    });
    st.edgesByNode = edgesByNode;
  }

  function redrawEdges(st, movedNode) {
    if (!st.edgesByNode) return;
    var id = movedNode.getAttribute("data-id");
    var list = id && st.edgesByNode[id];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var sp = parseTranslate(e.src);
      var tp = parseTranslate(e.tgt);
      var sx = sp.x + e.sxOff, sy = sp.y + e.syOff;
      var c1x = sp.x + e.c1xOff, c1y = sp.y + e.c1yOff;
      var c2x = tp.x + e.c2xOff, c2y = tp.y + e.c2yOff;
      var tx = tp.x + e.txOff, ty = tp.y + e.tyOff;
      var d = "M" + sx + "," + sy + " C" + c1x + "," + c1y + " " + c2x + "," + c2y + " " + tx + "," + ty;
      for (var j = 0; j < e.paths.length; j++) {
        e.paths[j].setAttribute("d", d);
      }
    }
  }

  var NODE_META_INDEX = (function() {
    var list = (DATA && DATA.nodeMeta) || [];
    var byId = {};
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (entry && typeof entry.id === "string" && entry.id) byId[entry.id] = entry;
    }
    return byId;
  })();

  function findNodeMeta(node) {
    if (!node) return null;
    var id = node.getAttribute && node.getAttribute("data-id");
    if (id && NODE_META_INDEX[id]) return NODE_META_INDEX[id];
    // Try common fallbacks.
    if (node.dataset) {
      if (node.dataset.id && NODE_META_INDEX[node.dataset.id]) return NODE_META_INDEX[node.dataset.id];
      if (node.dataset.nodeid && NODE_META_INDEX[node.dataset.nodeid]) return NODE_META_INDEX[node.dataset.nodeid];
    }
    return null;
  }

  function ensureFramePopover(frame) {
    return frame.querySelector(".snapshot-node-popover");
  }

  function hidePopover(frame) {
    var pop = ensureFramePopover(frame);
    if (!pop) return;
    pop.setAttribute("hidden", "");
    pop.style.left = "";
    pop.style.top = "";
    pop.removeAttribute("data-active-node");
    // Clear any embedded pptDeck so its state does not bleed into the next
    // node that opens the popover.
    var deck = pop.querySelector("[data-role='ppt-deck']");
    if (deck && deck.parentNode) deck.parentNode.removeChild(deck);
  }

  function positionPopover(frame, node, popover) {
    var nodeRect = node.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();
    var left = nodeRect.right - frameRect.left + 12;
    var top = nodeRect.top - frameRect.top;
    // Keep within frame bounds (best effort; final clamp uses popover size).
    var maxLeft = frame.clientWidth - 24;
    if (left > maxLeft) left = Math.max(12, nodeRect.left - frameRect.left - popover.offsetWidth - 12);
    if (left < 12) left = 12;
    if (top < 12) top = 12;
    var maxTop = frame.clientHeight - 24;
    if (top > maxTop) top = Math.max(12, maxTop);
    popover.style.left = left + "px";
    popover.style.top = top + "px";
  }

  function showPopoverForNode(st, node) {
    var frame = st.frame;
    var pop = ensureFramePopover(frame);
    if (!pop) return;
    var meta = findNodeMeta(node);
    var titleEl = pop.querySelector("[data-role='title']");
    var kindEl = pop.querySelector("[data-role='kind']");
    var promptEl = pop.querySelector("[data-role='prompt']");
    var label = (meta && meta.label) || (node.getAttribute && node.getAttribute("data-id")) || "Node";
    var kind = meta ? [meta.kind, meta.type].filter(Boolean).join(" · ") : (node.getAttribute && node.getAttribute("data-id")) || "";
    var prompt = meta && meta.prompt ? meta.prompt : "";
    if (titleEl) titleEl.textContent = label || "";
    if (kindEl) kindEl.textContent = kind || "";
    if (promptEl) {
      if (prompt) {
        promptEl.textContent = prompt;
        promptEl.classList.remove("snapshot-node-popover-empty");
      } else {
        promptEl.textContent = "(no prompt recorded for this node)";
        promptEl.classList.add("snapshot-node-popover-empty");
      }
    }
    var deck = meta && meta.pptDeck ? meta.pptDeck : null;
    renderPopoverDownloads(pop, mergeDownloadsForMeta(meta));
    renderPopoverPptDeck(pop, deck);
    pop.removeAttribute("hidden");
    pop.setAttribute("data-active-node", node.getAttribute("data-id") || "");
    positionPopover(frame, node, pop);
  }

  function mergeDownloadsForMeta(meta) {
    var list = (meta && Array.isArray(meta.downloads)) ? meta.downloads.slice() : [];
    var deck = meta && meta.pptDeck;
    if (deck && deck.pptxUrl) {
      var seen = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].url === deck.pptxUrl) { seen = true; break; }
      }
      if (!seen) {
        list.unshift({
          label: "PPTX",
          url: deck.pptxUrl,
          filename: deck.pptxFilename || ""
        });
      }
    }
    return list;
  }

  function renderPopoverDownloads(pop, downloads) {
    var host = pop.querySelector("[data-role='downloads']");
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!downloads || !downloads.length) {
      host.setAttribute("hidden", "");
      return;
    }
    host.removeAttribute("hidden");
    var heading = document.createElement("div");
    heading.className = "snapshot-node-popover-downloads-title";
    heading.textContent = "下载";
    host.appendChild(heading);
    var list = document.createElement("div");
    list.className = "snapshot-node-popover-downloads-list";
    for (var i = 0; i < downloads.length; i++) {
      var d = downloads[i] || {};
      if (!d.url) continue;
      var a = document.createElement("a");
      a.className = "snapshot-node-popover-download";
      a.href = resolveAssetToken(d.url);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      if (d.filename) a.setAttribute("download", d.filename);
      else a.setAttribute("download", "");
      var icon = document.createElement("span");
      icon.className = "snapshot-node-popover-download-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "⬇";
      a.appendChild(icon);
      var labelEl = document.createElement("span");
      labelEl.className = "snapshot-node-popover-download-label";
      labelEl.textContent = d.label || "下载";
      a.appendChild(labelEl);
      // Same-origin/data: URLs that the <a download> attribute can satisfy
      // directly will simply work. For cross-origin remote URLs the attribute
      // is ignored by browsers (per spec), so we additionally trigger a
      // fetch-based fallback that streams the bytes and saves them with the
      // intended filename.
      a.addEventListener("click", function(event) {
        var anchor = event.currentTarget;
        var url = anchor.getAttribute("href") || "";
        if (!url) return;
        if (url.indexOf("data:") === 0) return; // browser handles it
        // Let same-origin direct links proceed natively.
        var isCrossOrigin = false;
        try {
          var u = new URL(url, window.location.href);
          if (u.origin && window.location.origin && u.origin !== window.location.origin) isCrossOrigin = true;
        } catch (err) { isCrossOrigin = false; }
        if (!isCrossOrigin) return;
        event.preventDefault();
        forceDownload(url, anchor.getAttribute("download") || "");
      });
      list.appendChild(a);
    }
    host.appendChild(list);
  }

  function renderPopoverPptDeck(pop, deck) {
    // Tear down any previous deck UI so we don't leak handlers across nodes.
    var existing = pop.querySelector("[data-role='ppt-deck']");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) return;

    var host = document.createElement("div");
    host.className = "snapshot-pptdeck";
    host.setAttribute("data-role", "ppt-deck");

    var ratio = pptDeckRatio(deck.format);
    var stage = document.createElement("div");
    stage.className = "snapshot-pptdeck-stage";
    stage.style.aspectRatio = ratio;
    host.appendChild(stage);

    var nav = document.createElement("div");
    nav.className = "snapshot-pptdeck-nav";
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "snapshot-pptdeck-nav-btn";
    prev.setAttribute("data-action", "prev");
    prev.setAttribute("aria-label", "上一页");
    prev.textContent = "‹";
    var counter = document.createElement("div");
    counter.className = "snapshot-pptdeck-counter";
    var next = document.createElement("button");
    next.type = "button";
    next.className = "snapshot-pptdeck-nav-btn";
    next.setAttribute("data-action", "next");
    next.setAttribute("aria-label", "下一页");
    next.textContent = "›";
    nav.appendChild(prev);
    nav.appendChild(counter);
    nav.appendChild(next);
    host.appendChild(nav);

    pop.appendChild(host);

    var state = { idx: 0, total: deck.slides.length, slides: deck.slides };
    function render() {
      while (stage.firstChild) stage.removeChild(stage.firstChild);
      var slide = state.slides[state.idx];
      stage.appendChild(buildSlideStage(slide));
      counter.textContent = (state.idx + 1) + " / " + state.total;
      prev.disabled = state.total <= 1;
      next.disabled = state.total <= 1;
    }
    prev.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      state.idx = (state.idx - 1 + state.total) % state.total;
      render();
    });
    next.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      state.idx = (state.idx + 1) % state.total;
      render();
    });
    render();
  }

  function pptDeckRatio(format) {
    if (format === "ppt43") return "4 / 3";
    if (format === "xhs") return "3 / 4";
    if (format === "story") return "9 / 16";
    return "16 / 9";
  }

  function buildSlideStage(slide) {
    var wrapper = document.createElement("div");
    wrapper.className = "snapshot-pptdeck-slide";
    if (!slide) return wrapper;

    // Priority: inline SVG markup (already self-contained) > svgUrl (likely a
    // data: URI after materialization) > imageUrl > text fallback. Both SVG
    // forms use the browser's non-executable image boundary.
    if (typeof slide.svgMarkup === "string" && slide.svgMarkup.trim().toLowerCase().indexOf("<svg") === 0) {
      var svgMarkupImage = document.createElement("img");
      svgMarkupImage.className = "snapshot-pptdeck-slide-svg";
      svgMarkupImage.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(resolveAssetToken(slide.svgMarkup));
      svgMarkupImage.alt = slide.title || "";
      wrapper.appendChild(svgMarkupImage);
    } else if (typeof slide.svgUrl === "string" && slide.svgUrl) {
      var svgUrlImage = document.createElement("img");
      svgUrlImage.src = rehydrateSvgDataUri(resolveAssetToken(slide.svgUrl));
      svgUrlImage.alt = slide.title || "";
      svgUrlImage.className = "snapshot-pptdeck-slide-object";
      wrapper.appendChild(svgUrlImage);
    } else if (typeof slide.imageUrl === "string" && slide.imageUrl) {
      var img = document.createElement("img");
      img.src = resolveAssetToken(slide.imageUrl);
      img.alt = slide.title || "";
      img.className = "snapshot-pptdeck-slide-img";
      wrapper.appendChild(img);
    } else {
      var text = document.createElement("div");
      text.className = "snapshot-pptdeck-slide-fallback";
      if (slide.title) {
        var t = document.createElement("div");
        t.className = "snapshot-pptdeck-slide-title";
        t.textContent = slide.title;
        text.appendChild(t);
      }
      if (slide.subtitle) {
        var sub = document.createElement("div");
        sub.className = "snapshot-pptdeck-slide-subtitle";
        sub.textContent = slide.subtitle;
        text.appendChild(sub);
      }
      if (Array.isArray(slide.bullets) && slide.bullets.length) {
        var ul = document.createElement("ul");
        ul.className = "snapshot-pptdeck-slide-bullets";
        for (var i = 0; i < slide.bullets.length; i++) {
          var li = document.createElement("li");
          li.textContent = slide.bullets[i];
          ul.appendChild(li);
        }
        text.appendChild(ul);
      }
      wrapper.appendChild(text);
    }
    return wrapper;
  }

  function forceDownload(url, filename) {
    // Try fetch -> blob -> objectURL anchor. Falls back to opening the URL.
    try {
      fetch(url, { mode: "cors" }).then(function(r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.blob();
      }).then(function(blob) {
        var objectUrl = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename || guessFilename(url);
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
          URL.revokeObjectURL(objectUrl);
          if (a.parentNode) a.parentNode.removeChild(a);
        }, 0);
      }).catch(function() {
        window.open(url, "_blank", "noopener");
      });
    } catch (err) {
      window.open(url, "_blank", "noopener");
    }
  }

  function guessFilename(url) {
    try {
      var u = new URL(url, window.location.href);
      var last = u.pathname.split("/").filter(Boolean).pop();
      if (last) return last;
    } catch (err) { /* ignore */ }
    return "download";
  }

  function setupNodeClick(st) {
    if (st.nodeClickReady) return;
    st.nodeClickReady = true;
    var frame = st.frame;
    var popover = ensureFramePopover(frame);

    // Center clicked node + show prompt popover.
    frame.addEventListener("click", function(e) {
      var t = e.target;
      if (!t) return;
      if (t.closest && t.closest(".snapshot-canvas-controls")) return;
      if (t.closest && t.closest(".snapshot-node-popover")) return;
      var node = t.closest && t.closest(".react-flow__node");
      if (!node || node.classList.contains("react-flow__node-groupNode")) {
        hidePopover(frame);
        return;
      }
      centerFrameOnNode(st, node);
      showPopoverForNode(st, node);
    });

    if (popover) {
      var closeBtn = popover.querySelector("[data-role='close']");
      if (closeBtn) closeBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        hidePopover(frame);
      });
      // Prevent clicks inside the popover from bubbling up to the frame
      // (which would re-trigger zoom/centering on the underlying node).
      popover.addEventListener("click", function(e) { e.stopPropagation(); });
      popover.addEventListener("mousedown", function(e) { e.stopPropagation(); });
    }

    // Hide when scrolling/dragging the canvas.
    frame.addEventListener("wheel", function() { hidePopover(frame); }, { passive: true });
    frame.addEventListener("mousedown", function(e) {
      var t = e.target;
      if (t && t.closest && (t.closest(".snapshot-node-popover") || t.closest(".snapshot-canvas-controls"))) return;
      hidePopover(frame);
    });
  }

  function setupCanvasControls(st) {
    if (st.controlsReady) return;
    var frame = st.frame;
    var controls = frame.querySelector(".snapshot-canvas-controls");
    if (!controls) return;
    st.controlsReady = true;
    controls.addEventListener("click", function(e) {
      var btn = e.target && e.target.closest && e.target.closest("button[data-action]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var action = btn.getAttribute("data-action");
      if (action === "zoom-in") {
        zoomFrame(st, 1.2);
      } else if (action === "zoom-out") {
        zoomFrame(st, 1 / 1.2);
      } else if (action === "fit-view") {
        // Recompute bounds from the live DOM so Fit View still works after
        // the user has dragged nodes around inside the offline viewer.
        var fallback = { bx: st.bx, by: st.by, bw: st.bw, bh: st.bh };
        var bounds = computeFrameBoundsFromDom(frame, fallback);
        st.bx = bounds.bx; st.by = bounds.by; st.bw = bounds.bw; st.bh = bounds.bh;
        fitFrame(st);
        hidePopover(frame);
      }
    });
    // Prevent control clicks from bubbling into the frame's mousedown/click
    // handlers (which would drag-pan or fire node-centering).
    controls.addEventListener("mousedown", function(e) { e.stopPropagation(); });
  }

  function fitFrame(st) {
    if (!st || !st.viewport) return;
    var frame = st.frame;
    var frameW = frame.clientWidth;
    var frameH = frame.clientHeight;
    if (frameW <= 0 || frameH <= 0) return;
    if (!isFinite(st.bw) || !isFinite(st.bh) || st.bw <= 0 || st.bh <= 0) return;
    var k = Math.min(frameW / st.bw, frameH / st.bh);
    var scaledW = st.bw * k;
    var scaledH = st.bh * k;
    var offsetX = (frameW - scaledW) / 2;
    var offsetY = (frameH - scaledH) / 2;
    st.scale = k;
    st.tx = offsetX - st.bx * k;
    st.ty = offsetY - st.by * k;
    applyTransform(st);
  }

  function zoomFrame(st, multiplier) {
    if (!st || !st.viewport) return;
    var frame = st.frame;
    var frameW = frame.clientWidth;
    var frameH = frame.clientHeight;
    if (frameW <= 0 || frameH <= 0) return;
    var newScale = Math.max(0.1, Math.min(4, st.scale * multiplier));
    var ratio = newScale / st.scale;
    var cx = frameW / 2;
    var cy = frameH / 2;
    st.tx = cx - (cx - st.tx) * ratio;
    st.ty = cy - (cy - st.ty) * ratio;
    st.scale = newScale;
    applyTransform(st);
  }

  function centerFrameOnNode(st, node) {
    if (!st || !st.viewport || !node) return;
    var pos = parseTranslate(node);
    var nodeW = node.offsetWidth || node.getBoundingClientRect().width || 0;
    var nodeH = node.offsetHeight || node.getBoundingClientRect().height || 0;
    if (nodeW <= 0 || nodeH <= 0) return;
    var frameW = st.frame.clientWidth;
    var frameH = st.frame.clientHeight;
    // Translate so the node's center sits at the frame's center (accounting
    // for the current zoom level).
    st.tx = (frameW / 2) - (pos.x + nodeW / 2) * st.scale;
    st.ty = (frameH / 2) - (pos.y + nodeH / 2) * st.scale;
    applyTransform(st);
  }

  // Compute a robust bounding box from the actual DOM nodes inside the
  // viewport. This is the source of truth for Fit View: the server-supplied
  // data-bounds-* attributes can be skewed by outlier nodes that drifted to
  // ridiculous positions (e.g. a leftover node at x=-436000), which would
  // collapse the entire canvas to a 0px wide strip on screen. We compute the
  // dataset's median center and drop any node whose center is more than a few
  // dozen typical-node-widths away from it before measuring.
  function median(values) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  function collectFrameNodeRects(frame) {
    var nodeEls = frame.querySelectorAll(".react-flow__node");
    var entries = [];
    for (var i = 0; i < nodeEls.length; i++) {
      var node = nodeEls[i];
      if (!node || node.hidden) continue;
      var pos = parseTranslate(node);
      var w = node.offsetWidth || (node.getBoundingClientRect && node.getBoundingClientRect().width) || 0;
      var h = node.offsetHeight || (node.getBoundingClientRect && node.getBoundingClientRect().height) || 0;
      if (w <= 0 || h <= 0) continue;
      entries.push({ x: pos.x, y: pos.y, w: w, h: h, cx: pos.x + w / 2, cy: pos.y + h / 2 });
    }
    return entries;
  }

  function computeFrameBoundsFromDom(frame, fallback) {
    var entries = collectFrameNodeRects(frame);
    if (entries.length === 0) return fallback;
    var cxs = entries.map(function(e) { return e.cx; });
    var cys = entries.map(function(e) { return e.cy; });
    var widths = entries.map(function(e) { return e.w; });
    var heights = entries.map(function(e) { return e.h; });
    var medCx = median(cxs);
    var medCy = median(cys);
    var medW = Math.max(120, median(widths));
    var medH = Math.max(120, median(heights));
    var maxDx = medW * 60;
    var maxDy = medH * 60;
    var kept = entries.filter(function(e) {
      return Math.abs(e.cx - medCx) <= maxDx && Math.abs(e.cy - medCy) <= maxDy;
    });
    if (kept.length === 0) kept = entries;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < kept.length; i++) {
      var e = kept[i];
      if (e.x < minX) minX = e.x;
      if (e.y < minY) minY = e.y;
      if (e.x + e.w > maxX) maxX = e.x + e.w;
      if (e.y + e.h > maxY) maxY = e.y + e.h;
    }
    if (!isFinite(minX)) return fallback;
    var pad = 48;
    return {
      bx: minX - pad,
      by: minY - pad,
      bw: (maxX - minX) + pad * 2,
      bh: (maxY - minY) + pad * 2,
    };
  }

  function fitCanvasFrames() {
    var frames = document.querySelectorAll(".snapshot-canvas-frame");
    Array.prototype.forEach.call(frames, function(frame) {
      var rawBw = parseFloat(frame.getAttribute("data-bounds-w"));
      var rawBh = parseFloat(frame.getAttribute("data-bounds-h"));
      var rawBx = parseFloat(frame.getAttribute("data-bounds-x"));
      var rawBy = parseFloat(frame.getAttribute("data-bounds-y"));
      var viewport = frame.querySelector(".react-flow__viewport");
      if (!viewport) return;
      var fallback = (isFinite(rawBw) && isFinite(rawBh) && rawBw > 0 && rawBh > 0)
        ? { bx: rawBx, by: rawBy, bw: rawBw, bh: rawBh }
        : { bx: 0, by: 0, bw: 1280, bh: 720 };
      // Always recompute the bounds from the current DOM so that
      //   (a) stray "outlier" nodes do not skew Fit View, and
      //   (b) Fit View stays correct after the user drags a node around.
      var bounds = computeFrameBoundsFromDom(frame, fallback);
      var st = getFrameState(frame);
      st.viewport = viewport;
      st.bw = bounds.bw; st.bh = bounds.bh; st.bx = bounds.bx; st.by = bounds.by;
      fitFrame(st);
      setupPanZoom(st);
      setupNodeDrag(st);
      setupEdges(st);
      setupNodeClick(st);
      setupCanvasControls(st);
    });
  }

  var TODO_MARKERS = {
    completed: "✓",
    in_progress: "●",
    blocked: "✕",
    waiting: "◐",
    pending: "○"
  };

  function renderTodo(uiSnapshot) {
    var todos = uiSnapshot && uiSnapshot.todoSnapshot;
    if (!Array.isArray(todos) || todos.length === 0) return null;
    var list = el("ul", { class: "snapshot-todo-list" }, todos.map(function(t) {
      var status = t && t.status ? t.status : "pending";
      var marker = TODO_MARKERS[status] || "○";
      return el("li", { class: "snapshot-todo-item", "data-status": status }, [
        el("span", { class: "snapshot-todo-item-marker", text: marker }),
        el("span", { class: "snapshot-todo-item-text", text: (t && t.content) || "" })
      ]);
    }));
    return el("div", { class: "snapshot-todo" }, [
      el("div", { class: "snapshot-todo-title", text: "Todos" }),
      list
    ]);
  }

  function renderToolCalls(uiSnapshot) {
    var byTurn = uiSnapshot && uiSnapshot.toolCallSnapshot &&
                 uiSnapshot.toolCallSnapshot.record &&
                 uiSnapshot.toolCallSnapshot.record.toolCallsByTurn;
    if (!byTurn) return null;
    var calls = [];
    Object.keys(byTurn).forEach(function(turnId) {
      (byTurn[turnId] || []).forEach(function(c) { calls.push(c); });
    });
    if (!calls.length) return null;
    var details = el("details", { class: "snapshot-chat-tools" });
    details.appendChild(el("summary", { text: "Tool calls (" + calls.length + ")" }));
    calls.forEach(function(c) {
      var raw = c.outputPreview ? String(c.outputPreview) : "";
      var summary = looksLikeNaturalSummary(raw) ? raw.trim() : "";
      details.appendChild(el("div", { class: "snapshot-chat-tool" }, [
        el("span", { class: "snapshot-chat-tool-name", text: c.toolName || "" }),
        el("span", {
          class: "snapshot-chat-tool-status",
          "data-status": c.status || "unknown",
          text: c.status || "unknown"
        }),
        summary ? el("div", { class: "snapshot-chat-tool-preview", text: summary }) : null
      ]));
    });
    return details;
  }

  function renderMessage(m) {
    var role = m.role || "user";
    var snap = safeParse(m.uiSnapshotJson);
    var bubble;
    var content = m.content || "";
    if (content) {
      bubble = el("div", { class: "snapshot-chat-msg-bubble", text: content });
    } else {
      bubble = el("div", { class: "snapshot-chat-msg-bubble snapshot-chat-msg-empty", text: "(no text content)" });
    }
    var msg = el("div", { class: "snapshot-chat-msg", "data-role": role }, [
      el("div", { class: "snapshot-chat-msg-meta", text: role + " · " + formatTime(m.createdAt) }),
      bubble
    ]);
    var todo = renderTodo(snap);
    if (todo) msg.appendChild(todo);
    var tools = renderToolCalls(snap);
    if (tools) msg.appendChild(tools);
    return msg;
  }

  function renderChat() {
    var container = document.querySelector(".snapshot-chat-panel-body");
    if (!container) return;
    container.innerHTML = "";
    var sessions = conversation.sessions || [];
    var hasMessages = sessions.some(function(s) { return (s.messages || []).length > 0; });
    if (!hasMessages) {
      container.appendChild(el("div", { class: "snapshot-chat-empty", text: "(No conversation history)" }));
      return;
    }
    var multipleSessions = sessions.filter(function(s) { return (s.messages || []).length > 0; }).length > 1;
    sessions.forEach(function(s, idx) {
      var msgs = s.messages || [];
      if (!msgs.length) return;
      if (multipleSessions) {
        var label = "Session " + (idx + 1);
        if (s.sessionKey) {
          var laneMatch = /lane:([^:]+)$/.exec(s.sessionKey);
          if (laneMatch) label += " · " + laneMatch[1];
        }
        container.appendChild(el("div", { class: "snapshot-chat-session-divider", text: label }));
      }
      msgs.forEach(function(m) {
        container.appendChild(renderMessage(m));
      });
    });
  }

  function init() {
    var hostRoot = document.querySelector(".snapshot-canvas-col") || document.body;
    rehydrateDom(hostRoot);
    fitCanvasFrames();
    renderChat();
    var resizeTimer = null;
    window.addEventListener("resize", function() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitCanvasFrames, 80);
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
`;

import {
  type WebHeroRefinementTarget,
  readWebHeroRefinementAttachments,
} from './webHeroTweaks'

export type WebHeroTweakToolMode = 'picker' | 'pod'

export type WebHeroTweakStrokePoint = {
  x: number
  y: number
}

export type WebHeroPreviewBridgeEvent =
  | {
      type: 'tc:webhero-tweak-hover'
      target: WebHeroRefinementTarget
    }
  | {
      type: 'tc:webhero-tweak-select'
      target: WebHeroRefinementTarget
    }
  | {
      type: 'tc:webhero-tweak-leave'
    }
  | {
      type: 'tc:webhero-tweak-pod-stroke'
      points: WebHeroTweakStrokePoint[]
    }
  | {
      type: 'tc:webhero-tweak-pod-clear'
    }
  | {
      type: 'tc:webhero-tweak-track-update'
      targets: WebHeroPreviewTrackedTarget[]
    }

export type WebHeroPreviewTrackedTarget = {
  trackId: string
  target: WebHeroRefinementTarget
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.round(numeric)
}

function readStrokePoints(value: unknown): WebHeroTweakStrokePoint[] {
  if (!Array.isArray(value)) return []
  const points: WebHeroTweakStrokePoint[] = []
  value.forEach((item) => {
    const record = isRecord(item) ? item : {}
    const x = readFiniteNumber(record.x)
    const y = readFiniteNumber(record.y)
    if (x === null || y === null) return
    points.push({ x, y })
  })
  return points
}

function readTarget(value: unknown): WebHeroRefinementTarget | null {
  const attachments = readWebHeroRefinementAttachments([{ ...(isRecord(value) ? value : {}), note: '__bridge__' }])
  if (!attachments.length) return null
  const [{ id: _id, note: _note, createdAt: _createdAt, executionScope: _executionScope, source: _source, ...target }] = attachments
  return target
}

function readTrackedTargets(value: unknown): WebHeroPreviewTrackedTarget[] {
  if (!Array.isArray(value)) return []
  const targets: WebHeroPreviewTrackedTarget[] = []
  value.forEach((item) => {
    const record = isRecord(item) ? item : {}
    const trackId = typeof record.trackId === 'string' ? record.trackId.trim() : ''
    const target = readTarget(record.target)
    if (!trackId || !target) return
    targets.push({ trackId, target })
  })
  return targets
}

export function readWebHeroPreviewBridgeEvent(value: unknown): WebHeroPreviewBridgeEvent | null {
  const record = isRecord(value) ? value : {}
  const type = typeof record.type === 'string' ? record.type.trim() : ''
  if (type === 'tc:webhero-tweak-leave') return { type }
  if (type === 'tc:webhero-tweak-pod-clear') return { type }
  if (type === 'tc:webhero-tweak-track-update') {
    return { type, targets: readTrackedTargets(record.targets) }
  }
  if (type === 'tc:webhero-tweak-pod-stroke') {
    const points = readStrokePoints(record.points)
    return { type, points }
  }
  if (type === 'tc:webhero-tweak-hover' || type === 'tc:webhero-tweak-select') {
    const target = readTarget(record.target)
    if (!target) return null
    return { type, target }
  }
  return null
}

const BRIDGE_STYLE = `<style data-tc-webhero-tweak-bridge>
html {
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.28) transparent;
}

html::-webkit-scrollbar,
body::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

html::-webkit-scrollbar-track,
body::-webkit-scrollbar-track {
  background: transparent;
}

html::-webkit-scrollbar-thumb,
body::-webkit-scrollbar-thumb {
  min-height: 40px;
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.28);
  background-clip: content-box;
}

html::-webkit-scrollbar-thumb:hover,
body::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.42);
  background-clip: content-box;
}

html[data-tc-webhero-tweak-mode] body * { cursor: crosshair !important; }
html[data-tc-webhero-tweak-mode][data-tc-webhero-tweak-mode-kind="pod"] body * { cursor: cell !important; }
</style>`

const BRIDGE_SCRIPT = `<script>
(function () {
  var enabled = false;
  var mode = 'picker';
  var hoveredId = '';
  var drawing = false;
  var stroke = [];
  var trackedTargets = [];
  var trackedUpdateRaf = 0;

  function post(type, payload) {
    var message = payload && typeof payload === 'object' ? payload : {};
    message.type = type;
    window.parent.postMessage(message, '*');
  }

  function cleanText(value, limit) {
    var text = String(value || '').replace(/\\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= limit) return text;
    return text.slice(0, Math.max(0, limit - 1)).trim() + '...';
  }

  function readString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function sanitizeSelectorPart(value) {
    return String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function selectorFor(el) {
    if (!el || !el.tagName) return '';
    var assetId = sanitizeSelectorPart(el.getAttribute('data-asset-id'));
    if (assetId) return '[data-asset-id="' + assetId + '"]';
    var id = sanitizeSelectorPart(el.id);
    if (id) return '#' + id;
    var className = typeof el.className === 'string' ? el.className : '';
    var classParts = className
      .split(/\\s+/)
      .map(sanitizeSelectorPart)
      .filter(Boolean)
      .slice(0, 3);
    var tag = String(el.tagName || 'div').toLowerCase();
    if (classParts.length) return tag + '.' + classParts.join('.');
    return tag;
  }

  function htmlHintFor(el) {
    if (!el || !el.tagName) return '';
    var tag = String(el.tagName || 'div').toLowerCase();
    var classes = typeof el.className === 'string' ? cleanText(el.className, 80) : '';
    var role = cleanText(el.getAttribute('role'), 40);
    var parts = ['<' + tag + '>'];
    if (classes) parts.push('class=' + classes);
    if (role) parts.push('role=' + role);
    return cleanText(parts.join(' '), 180);
  }

  function labelFor(el) {
    var assetId = cleanText(el.getAttribute('data-asset-id'), 60);
    if (assetId) return 'asset ' + assetId;
    var ariaLabel = cleanText(el.getAttribute('aria-label'), 80);
    if (ariaLabel) return ariaLabel;
    var alt = cleanText(el.getAttribute('alt'), 80);
    if (alt) return alt;
    var text = cleanText(el.innerText || el.textContent || '', 80);
    if (text) return text;
    var id = cleanText(el.id, 60);
    if (id) return id;
    var className = typeof el.className === 'string' ? cleanText(el.className, 60) : '';
    if (className) return className;
    return String(el.tagName || 'element').toLowerCase();
  }

  function boundsFor(el) {
    var rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    };
  }

  function sourceLocationFor(el) {
    var current = el;
    while (current && current !== document.documentElement) {
      var file = readString(current.getAttribute && current.getAttribute('data-tc-source-file'));
      if (file) {
        var line = Number(current.getAttribute('data-tc-source-line'));
        var column = Number(current.getAttribute('data-tc-source-column'));
        var componentName = readString(current.getAttribute('data-tc-component'));
        var source = { file: file };
        if (Number.isFinite(line) && line > 0) source.line = Math.round(line);
        if (Number.isFinite(column) && column > 0) source.column = Math.round(column);
        if (componentName) source.componentName = componentName;
        return source;
      }
      current = current.parentElement;
    }
    return null;
  }

  function elementIdFor(el, selector) {
    var assetId = sanitizeSelectorPart(el.getAttribute('data-asset-id'));
    if (assetId) return 'asset-' + assetId;
    var id = sanitizeSelectorPart(el.id);
    if (id) return 'id-' + id;
    var cleanedSelector = sanitizeSelectorPart(selector);
    if (cleanedSelector) return 'selector-' + cleanedSelector;
    return 'element-' + Date.now().toString(36);
  }

  function targetFromElement(el) {
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    if (!rect || rect.width < 8 || rect.height < 8) return null;
    var selector = selectorFor(el);
    return {
      elementId: elementIdFor(el, selector),
      selector: selector || String(el.tagName || 'div').toLowerCase(),
      label: labelFor(el),
      text: cleanText(el.innerText || el.textContent || '', 160),
      htmlHint: htmlHintFor(el),
      position: boundsFor(el),
      selectionKind: 'element',
      sourceLocation: sourceLocationFor(el)
    };
  }

  function targetFromTrackedElement(base, el) {
    var live = targetFromElement(el);
    if (!live) return null;
    return {
      elementId: readString(base.elementId) || live.elementId,
      selector: readString(base.selector) || live.selector,
      label: readString(base.label) || live.label,
      text: live.text,
      htmlHint: live.htmlHint,
      position: live.position,
      selectionKind: 'element',
      sourceLocation: live.sourceLocation || base.sourceLocation || null
    };
  }

  function isSelectableElement(el) {
    if (!(el instanceof HTMLElement)) return false;
    var tag = String(el.tagName || '').toLowerCase();
    if (!tag || tag === 'html' || tag === 'body' || tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link' || tag === 'head') return false;
    if (el.closest('[data-tc-webhero-tweak-ignore="true"]')) return false;
    var rect = el.getBoundingClientRect();
    if (!rect || rect.width < 8 || rect.height < 8) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    return true;
  }

  function closestTarget(event) {
    var el = event.target && event.target.nodeType === 3 ? event.target.parentElement : event.target;
    while (el && el !== document.documentElement) {
      if (isSelectableElement(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function rectContains(a, b) {
    return a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
  }

  function isOversizedViewportTarget(target) {
    if (!target || !target.position) return false;
    var viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 0);
    var viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 0);
    var viewportArea = Math.max(1, viewportWidth * viewportHeight);
    var targetArea = Math.max(1, target.position.width * target.position.height);
    var widthRatio = target.position.width / viewportWidth;
    var heightRatio = target.position.height / viewportHeight;
    var areaRatio = targetArea / viewportArea;
    return (
      areaRatio >= 0.82 ||
      (widthRatio >= 0.94 && heightRatio >= 0.74) ||
      (widthRatio >= 0.86 && heightRatio >= 0.9)
    );
  }

  function pruneContainerTargets(targets) {
    if (targets.length < 2) return targets;
    return targets.filter(function (candidate) {
      var contained = targets.filter(function (other) {
        return other.elementId !== candidate.elementId && rectContains(candidate.position, other.position);
      });
      if (contained.length < 2) return true;
      if (isOversizedViewportTarget(candidate)) return false;
      var candidateArea = Math.max(1, candidate.position.width * candidate.position.height);
      var union = contained.reduce(function (acc, other) {
        return {
          left: Math.min(acc.left, other.position.x),
          top: Math.min(acc.top, other.position.y),
          right: Math.max(acc.right, other.position.x + other.position.width),
          bottom: Math.max(acc.bottom, other.position.y + other.position.height)
        };
      }, {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY
      });
      var unionArea = Math.max(1, (union.right - union.left) * (union.bottom - union.top));
      return unionArea < candidateArea * 0.72;
    });
  }

  function relativePoint(event) {
    return {
      x: Math.round(event.clientX),
      y: Math.round(event.clientY)
    };
  }

  function strokeBounds(points) {
    return points.reduce(function (acc, point) {
      return {
        left: Math.min(acc.left, point.x),
        top: Math.min(acc.top, point.y),
        right: Math.max(acc.right, point.x),
        bottom: Math.max(acc.bottom, point.y)
      };
    }, {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY
    });
  }

  function isClosedLoop(points) {
    if (!Array.isArray(points) || points.length < 3) return false;
    var first = points[0];
    var last = points[points.length - 1];
    return Math.hypot(first.x - last.x, first.y - last.y) < 24;
  }

  function pointInPolygon(point, polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i].x;
      var yi = polygon[i].y;
      var xj = polygon[j].x;
      var yj = polygon[j].y;
      var intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-6) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function targetSelectedByStroke(target, points, closedLoop) {
    if (!target || !Array.isArray(points) || points.length < 2) return false;
    var rect = target.position;
    var probePoints = [
      { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x, y: rect.y + rect.height },
      { x: rect.x + rect.width, y: rect.y + rect.height }
    ];
    if (closedLoop) {
      return probePoints.some(function (point) {
        return pointInPolygon(point, points);
      });
    }
    var bounds = strokeBounds(points);
    return !(
      rect.x + rect.width < bounds.left ||
      rect.x > bounds.right ||
      rect.y + rect.height < bounds.top ||
      rect.y > bounds.bottom
    );
  }

  function collectTargets() {
    return Array.prototype.slice.call(document.body.querySelectorAll('*'))
      .filter(isSelectableElement)
      .map(targetFromElement)
      .filter(Boolean);
  }

  function buildPodTarget(points) {
    var closedLoop = isClosedLoop(points);
    if (!closedLoop) return null;
    var intersected = collectTargets().filter(function (target) {
      return targetSelectedByStroke(target, points, closedLoop);
    });
    var refined = pruneContainerTargets(intersected);
    var selected = refined.length > 0 ? refined : intersected;
    if (!selected.length) return null;
    var bounds = selected.reduce(function (acc, target) {
      return {
        left: Math.min(acc.left, target.position.x),
        top: Math.min(acc.top, target.position.y),
        right: Math.max(acc.right, target.position.x + target.position.width),
        bottom: Math.max(acc.bottom, target.position.y + target.position.height)
      };
    }, {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY
    });
    var podMembers = selected.map(function (target) {
      return {
        elementId: target.elementId,
        selector: target.selector,
        label: target.label,
        text: target.text,
        htmlHint: target.htmlHint,
        position: target.position,
        sourceLocation: target.sourceLocation || null
      };
    });
    return {
      elementId: 'pod-' + Date.now().toString(36),
      selector: selected.slice(0, 8).map(function (target) { return target.selector; }).filter(Boolean).join(', ') || 'body *',
      label: selected.slice(0, 3).map(function (target) { return target.label; }).filter(Boolean).join(' · ') || ('Pod of ' + selected.length + ' items'),
      text: selected.slice(0, 4).map(function (target) { return target.text; }).filter(Boolean).join(' · '),
      htmlHint: cleanText(selected.slice(0, 4).map(function (target) { return target.htmlHint; }).filter(Boolean).join(' '), 180),
      position: {
        x: Math.round(bounds.left),
        y: Math.round(bounds.top),
        width: Math.max(1, Math.round(bounds.right - bounds.left)),
        height: Math.max(1, Math.round(bounds.bottom - bounds.top))
      },
      selectionKind: 'pod',
      memberCount: selected.length,
      podMembers: podMembers
    };
  }

  function resolveElementForSelector(selector) {
    var safeSelector = readString(selector);
    if (!safeSelector) return null;
    try {
      var matched = document.querySelector(safeSelector);
      return matched instanceof HTMLElement ? matched : null;
    } catch (error) {
      return null;
    }
  }

  function normalizeTrackedTargets(value) {
    if (!Array.isArray(value)) return [];
    return value.map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var trackId = readString(item.trackId);
      var target = item.target && typeof item.target === 'object' ? item.target : null;
      if (!trackId || !target) return null;
      return { trackId: trackId, target: target };
    }).filter(Boolean);
  }

  function resolveTrackedPodTarget(base) {
    var baseMembers = Array.isArray(base.podMembers) ? base.podMembers : [];
    var liveMembers = baseMembers.map(function (member) {
      var el = resolveElementForSelector(member && member.selector);
      if (!el) return null;
      var live = targetFromElement(el);
      if (!live) return null;
      return {
        elementId: readString(member.elementId) || live.elementId,
        selector: readString(member.selector) || live.selector,
        label: readString(member.label) || live.label,
        text: live.text,
        htmlHint: live.htmlHint,
        position: live.position,
        sourceLocation: live.sourceLocation || member.sourceLocation || null
      };
    }).filter(Boolean);
    if (!liveMembers.length) return null;
    var bounds = liveMembers.reduce(function (acc, member) {
      return {
        left: Math.min(acc.left, member.position.x),
        top: Math.min(acc.top, member.position.y),
        right: Math.max(acc.right, member.position.x + member.position.width),
        bottom: Math.max(acc.bottom, member.position.y + member.position.height)
      };
    }, {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY
    });
    return {
      elementId: readString(base.elementId) || 'pod',
      selector: readString(base.selector) || 'body *',
      label: readString(base.label) || liveMembers.slice(0, 3).map(function (member) { return member.label; }).join(' · '),
      text: cleanText(liveMembers.slice(0, 4).map(function (member) { return member.text; }).filter(Boolean).join(' · '), 160),
      htmlHint: cleanText(liveMembers.slice(0, 4).map(function (member) { return member.htmlHint; }).filter(Boolean).join(' '), 180),
      position: {
        x: Math.round(bounds.left),
        y: Math.round(bounds.top),
        width: Math.max(1, Math.round(bounds.right - bounds.left)),
        height: Math.max(1, Math.round(bounds.bottom - bounds.top))
      },
      selectionKind: 'pod',
      memberCount: liveMembers.length,
      sourceLocation: (liveMembers.find(function (member) { return member.sourceLocation; }) || {}).sourceLocation || null,
      podMembers: liveMembers
    };
  }

  function resolveTrackedTarget(entry) {
    if (!entry || !entry.target) return null;
    var base = entry.target;
    if (base.selectionKind === 'pod') {
      var podTarget = resolveTrackedPodTarget(base);
      return podTarget ? { trackId: entry.trackId, target: podTarget } : null;
    }
    var el = resolveElementForSelector(base.selector);
    if (!el) return null;
    var elementTarget = targetFromTrackedElement(base, el);
    return elementTarget ? { trackId: entry.trackId, target: elementTarget } : null;
  }

  function postTrackedTargetUpdates() {
    trackedUpdateRaf = 0;
    if (!trackedTargets.length) {
      post('tc:webhero-tweak-track-update', { targets: [] });
      return;
    }
    var nextTargets = trackedTargets
      .map(resolveTrackedTarget)
      .filter(Boolean);
    post('tc:webhero-tweak-track-update', { targets: nextTargets });
  }

  function scheduleTrackedTargetUpdates() {
    if (trackedUpdateRaf) return;
    trackedUpdateRaf = window.requestAnimationFrame(postTrackedTargetUpdates);
  }

  window.addEventListener('message', function (event) {
    if (!event.data) return;
    if (event.data.type === 'tc:webhero-tweak-track') {
      trackedTargets = normalizeTrackedTargets(event.data.targets);
      scheduleTrackedTargetUpdates();
      return;
    }
    if (event.data.type !== 'tc:webhero-tweak-mode') return;
    enabled = !!event.data.enabled;
    mode = event.data.mode === 'pod' ? 'pod' : 'picker';
    document.documentElement.toggleAttribute('data-tc-webhero-tweak-mode', enabled);
    document.documentElement.setAttribute('data-tc-webhero-tweak-mode-kind', mode);
    if (!enabled || mode !== 'pod') {
      drawing = false;
      stroke = [];
      post('tc:webhero-tweak-pod-clear');
    }
    if (!enabled) {
      hoveredId = '';
      post('tc:webhero-tweak-leave');
    }
  });

  document.addEventListener('mouseover', function (event) {
    if (!enabled || mode !== 'picker') return;
    var el = closestTarget(event);
    if (!el) return;
    var target = targetFromElement(el);
    if (!target || target.elementId === hoveredId) return;
    hoveredId = target.elementId;
    post('tc:webhero-tweak-hover', { target: target });
  }, true);

  document.addEventListener('mouseout', function (event) {
    if (!enabled || mode !== 'picker') return;
    var el = closestTarget(event);
    if (!el) return;
    var next = event.relatedTarget;
    while (next && next !== document.documentElement) {
      if (next === el) return;
      next = next.parentElement;
    }
    hoveredId = '';
    post('tc:webhero-tweak-leave');
  }, true);

  document.addEventListener('click', function (event) {
    if (!enabled || mode !== 'picker') return;
    var el = closestTarget(event);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    var target = targetFromElement(el);
    if (target) post('tc:webhero-tweak-select', { target: target });
  }, true);

  document.addEventListener('pointerdown', function (event) {
    if (!enabled || mode !== 'pod' || event.button !== 0) return;
    drawing = true;
    stroke = [relativePoint(event)];
    event.preventDefault();
    event.stopPropagation();
    post('tc:webhero-tweak-pod-stroke', { points: stroke.slice() });
  }, true);

  document.addEventListener('pointermove', function (event) {
    if (!drawing || mode !== 'pod') return;
    var point = relativePoint(event);
    var last = stroke[stroke.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 4) return;
    stroke.push(point);
    event.preventDefault();
    event.stopPropagation();
    post('tc:webhero-tweak-pod-stroke', { points: stroke.slice() });
  }, true);

  function finishStroke(event) {
    if (!drawing || mode !== 'pod') return;
    drawing = false;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var points = stroke.slice();
    post('tc:webhero-tweak-pod-stroke', { points: points });
    var target = buildPodTarget(points);
    stroke = [];
    post('tc:webhero-tweak-pod-clear');
    if (target) post('tc:webhero-tweak-select', { target: target });
  }

  document.addEventListener('pointerup', finishStroke, true);
  document.addEventListener('pointercancel', finishStroke, true);
  document.addEventListener('scroll', scheduleTrackedTargetUpdates, true);
  window.addEventListener('scroll', scheduleTrackedTargetUpdates, true);
  window.addEventListener('resize', scheduleTrackedTargetUpdates, true);
})();
</script>`

export function decorateWebHeroPreviewDocument(documentHtml: string): string {
  const doc = String(documentHtml || '')
  if (!doc.trim()) return ''
  const withStyle = /<\/head>/i.test(doc)
    ? doc.replace(/<\/head>/i, `${BRIDGE_STYLE}</head>`)
    : /<head[^>]*>/i.test(doc)
      ? doc.replace(/<head[^>]*>/i, (match) => `${match}${BRIDGE_STYLE}`)
      : `${BRIDGE_STYLE}${doc}`
  if (/<\/body>/i.test(withStyle)) {
    return withStyle.replace(/<\/body>/i, `${BRIDGE_SCRIPT}</body>`)
  }
  return `${withStyle}${BRIDGE_SCRIPT}`
}

/* global mermaid, DOMPurify */

const DEFAULT_BACKGROUND = { r: 255, g: 250, b: 240, a: 1 };
const DARK_TEXT = { r: 17, g: 24, b: 39, a: 1 };
const LIGHT_TEXT = { r: 255, g: 246, b: 223, a: 1 };
const MIN_TEXT_CONTRAST = 4.5;

function parseColor(value) {
  if (!value || value === 'none' || value === 'transparent') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => part.trim());
    const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
    const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
    if ([r, g, b, a].every(Number.isFinite)) {
      return { r, g, b, a };
    }
  }

  const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }

  return null;
}

function colorToCss({ r, g, b }) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function luminanceChannel(value) {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color) {
  return (
    0.2126 * luminanceChannel(color.r) +
    0.7152 * luminanceChannel(color.g) +
    0.0722 * luminanceChannel(color.b)
  );
}

function contrastRatio(a, b) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function isTextLikeElement(el) {
  if (!(el instanceof Element)) {
    return false;
  }
  return el.tagName.toLowerCase() === 'text' || el.tagName.toLowerCase() === 'tspan';
}

function getReadableTextColor(background) {
  return contrastRatio(DARK_TEXT, background) >= contrastRatio(LIGHT_TEXT, background)
    ? DARK_TEXT
    : LIGHT_TEXT;
}

function hasClassInTree(el, classNames) {
  for (let current = el; current; current = current.parentElement) {
    if (classNames.some((className) => current.classList?.contains(className))) {
      return true;
    }
  }
  return false;
}

function setTextColor(textEl, color) {
  const colorCss = colorToCss(color);
  textEl.style.setProperty('fill', colorCss, 'important');
  textEl.style.setProperty('color', colorCss, 'important');
}

function getElementPaintColor(el) {
  const style = getComputedStyle(el);
  return (
    parseColor(style.fill) ||
    parseColor(style.backgroundColor) ||
    parseColor(style.color)
  );
}

function getBackgroundUnderText(textEl) {
  const rect = textEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return DEFAULT_BACKGROUND;
  }

  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const stacked = document.elementsFromPoint(x, y);

  for (const el of stacked) {
    if (el === textEl || textEl.contains(el) || isTextLikeElement(el)) {
      continue;
    }
    const color = getElementPaintColor(el);
    if (color && color.a !== 0) {
      return color;
    }
  }

  for (let current = textEl.parentElement; current; current = current.parentElement) {
    const color = getElementPaintColor(current);
    if (color && color.a !== 0) {
      return color;
    }
  }

  return DEFAULT_BACKGROUND;
}

function fixSvgTextContrast(svgEl) {
  svgEl.querySelectorAll('text, tspan').forEach((textEl) => {
    if (textEl.tagName.toLowerCase() === 'text' && textEl.querySelector('tspan')) {
      return;
    }

    const text = textEl.textContent?.trim();
    if (!text) {
      return;
    }

    if (hasClassInTree(textEl, ['labelText'])) {
      setTextColor(textEl, LIGHT_TEXT);
      return;
    }

    if (hasClassInTree(textEl, ['actor'])) {
      return;
    }

    if (hasClassInTree(textEl, ['loopText', 'sectionTitle', 'noteText', 'messageText'])) {
      setTextColor(textEl, DARK_TEXT);
      return;
    }

    const foreground = parseColor(getComputedStyle(textEl).fill) || parseColor(getComputedStyle(textEl).color);
    if (!foreground || foreground.a === 0) {
      return;
    }

    const background = getBackgroundUnderText(textEl);
    if (contrastRatio(foreground, background) >= MIN_TEXT_CONTRAST) {
      return;
    }

    const readable = getReadableTextColor(background);
    setTextColor(textEl, readable);
  });
}

export async function renderDiagram({
  srcValue,
  preview,
  state,
  IS_E2E,
  applyTransform,
  rebuildNavNodes,
  afterRender,
}) {
  try {
    const normalizedSource = srcValue
      .replace(/^\s*```\s*mermaid\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, '')
      .trimStart();
    const { svg } = await mermaid.render(IS_E2E ? 'm1' : 'm' + Date.now(), normalizedSource);

    const cleanSvg = DOMPurify.sanitize(svg, {
      ADD_TAGS: ['foreignObject'],
      ADD_ATTR: ['xmlns'],
    });

    const parsed = new DOMParser().parseFromString(cleanSvg, 'image/svg+xml');
    const svgEl = parsed.documentElement;

    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.background = '#fffaf0';

    svgEl.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    preview.replaceChildren(svgEl);
    state.iframeRef = null;
    state.svgRef = svgEl;

    setTimeout(() => {
      rebuildNavNodes();
    }, 0);

    requestAnimationFrame(() => {
      try {
        fixSvgTextContrast(svgEl);
      } catch (error) {
        console.warn('SVG text contrast adjustment skipped.', error);
      }
      svgEl.style.transformOrigin = '0 0';
      svgEl.style.display = 'block';
      applyTransform();
      afterRender?.();
    });

    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
      .node rect, .node polygon, .node path {
        transition: fill 120ms ease, filter 120ms ease;
      }

      .node:hover rect,
      .node:hover polygon,
      .node:hover path {
        fill: rgba(0, 170, 255, 0.25);
        filter: drop-shadow(0 0 11px rgba(0, 170, 255, 0.6));
      }

      g.node.selected-node rect,
      g.node.selected-node polygon,
      g.node.selected-node path {
        fill: rgba(0, 170, 255, 0.35) !important;
        stroke: #00aaff !important;
        stroke-width: 2px !important;
        filter: drop-shadow(0 0 16px rgba(0, 170, 255, 1)) !important;
      }

      g.node.selected-node text {
        fill: #ffffff !important;
        font-weight: bold !important;
      }

    `;
    svgEl.prepend(style);

    preview.onwheel = null;
    preview.onmousedown = null;
    window.onmouseup = null;
    window.onmousemove = null;

    let isPanningLocal = false;
    let startXLocal = 0;
    let startYLocal = 0;

    preview.onwheel = (e) => {
      e.preventDefault();
      const previewRect = preview.getBoundingClientRect();
      const pointerX = e.clientX - previewRect.left;
      const pointerY = e.clientY - previewRect.top;
      const oldScale = state.scale;
      const nextScale = oldScale * Math.exp(e.deltaY * -0.0012);
      const newScale = Math.min(Math.max(0.2, nextScale), 4);

      if (newScale === oldScale) {
        return;
      }

      const graphX = (pointerX - state.panX) / oldScale;
      const graphY = (pointerY - state.panY) / oldScale;

      state.scale = newScale;
      state.panX = pointerX - graphX * newScale;
      state.panY = pointerY - graphY * newScale;
      applyTransform();
    };

    preview.onmousedown = (e) => {
      if (preview.dataset.annotationMode === 'true') {
        return;
      }
      if (e.target.closest?.('#diagramScrollbar')) {
        return;
      }

      isPanningLocal = true;
      startXLocal = e.clientX - state.panX;
      startYLocal = e.clientY - state.panY;
      preview.style.cursor = 'grabbing';
    };

    window.onmouseup = () => {
      isPanningLocal = false;
      preview.style.cursor = 'default';
    };

    window.onmousemove = (e) => {
      if (!isPanningLocal) {
        return;
      }
      state.panX = e.clientX - startXLocal;
      state.panY = e.clientY - startYLocal;
      applyTransform();
    };
  } catch (e) {
    preview.replaceChildren();

    const pre = document.createElement('pre');
    pre.style.color = '#ff6b6b';
    pre.textContent = e.message;

    preview.appendChild(pre);
  }
}

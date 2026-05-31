const MIN_THUMB_HEIGHT = 72;
const TOP_OVERSCROLL = 24;
const BOTTOM_OVERSCROLL = 24;
const TRACK_EDGE_GAP = 18;
const TRACK_CONTENT_INSET = 8;
const TRACK_THUMB_INSET = 5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSvgContentHeight(svg, scale) {
  if (!svg) {
    return 0;
  }

  const renderedHeight = svg.clientHeight || 0;
  const rectHeight = scale > 0 ? (svg.getBoundingClientRect?.().height || 0) / scale : 0;
  const attrHeight = /^\d+(\.\d+)?$/.test(svg.getAttribute('height') || '')
    ? Number.parseFloat(svg.getAttribute('height') || '0')
    : 0;
  const viewBoxHeight = svg.viewBox?.baseVal?.height || 0;

  return Math.max(renderedHeight, rectHeight) || attrHeight || viewBoxHeight;
}

export function createVerticalScrollbar({ state, preview, getSvg, applyTransform }) {
  const track = document.createElement('div');
  const thumb = document.createElement('div');
  let dragging = false;
  let activeDragMetrics = null;

  track.id = 'diagramScrollbar';
  track.className = 'diagram-scrollbar';
  track.setAttribute('aria-label', '图表纵向滚动条');
  track.setAttribute('role', 'scrollbar');
  track.setAttribute('aria-orientation', 'vertical');
  thumb.className = 'diagram-scrollbar-thumb';
  track.appendChild(thumb);

  function ensureMounted() {
    if (!track.isConnected || track.parentElement !== preview) {
      preview.appendChild(track);
    }
  }

  function getMetrics() {
    const svg = getSvg();
    const previewRect = preview.getBoundingClientRect();
    const svgRect = svg?.getBoundingClientRect();
    const rawHeight = getSvgContentHeight(svg, state.scale);
    const contentHeight = rawHeight * state.scale + TOP_OVERSCROLL + BOTTOM_OVERSCROLL;
    const viewportHeight = previewRect.height;
    const maxPanY = TOP_OVERSCROLL;
    const minPanY = Math.min(maxPanY, viewportHeight - contentHeight - BOTTOM_OVERSCROLL);
    const range = Math.max(0, maxPanY - minPanY);
    const visibleTop = svgRect
      ? clamp(svgRect.top - previewRect.top + TRACK_CONTENT_INSET, TRACK_EDGE_GAP, viewportHeight - TRACK_EDGE_GAP)
      : TRACK_EDGE_GAP;
    const visibleBottom = svgRect
      ? clamp(svgRect.bottom - previewRect.top - TRACK_CONTENT_INSET, TRACK_EDGE_GAP, viewportHeight - TRACK_EDGE_GAP)
      : viewportHeight - TRACK_EDGE_GAP;
    const trackTop = Math.min(visibleTop, visibleBottom);
    const trackBottom = Math.max(visibleTop, visibleBottom);
    const trackHeight = Math.max(0, trackBottom - trackTop);
    const travelHeight = Math.max(0, trackHeight - TRACK_THUMB_INSET * 2);

    track.style.top = `${trackTop}px`;
    track.style.height = `${trackHeight}px`;
    track.style.bottom = 'auto';

    const thumbHeight = range > 1
      ? clamp((viewportHeight / Math.max(contentHeight, viewportHeight)) * travelHeight, MIN_THUMB_HEIGHT, travelHeight)
      : travelHeight;

    return {
      canScroll: Boolean(svg) && range > 1 && travelHeight > 0,
      maxPanY,
      minPanY,
      range,
      trackTop,
      trackHeight,
      travelHeight,
      thumbHeight,
    };
  }

  function clampPanY(value = state.panY) {
    ensureMounted();
    const metrics = getMetrics();
    if (!metrics.canScroll) {
      return 0;
    }
    return clamp(value, metrics.minPanY, metrics.maxPanY);
  }

  function sync() {
    ensureMounted();
    const metrics = dragging && activeDragMetrics ? activeDragMetrics : getMetrics();

    if (!metrics.canScroll) {
      track.classList.add('is-disabled');
      thumb.style.height = '100%';
      thumb.style.transform = 'translateY(0px)';
      track.setAttribute('aria-valuenow', '0');
      track.setAttribute('aria-valuemax', '0');
      return;
    }

    track.classList.remove('is-disabled');
    const scrollRatio = clamp((metrics.maxPanY - state.panY) / metrics.range, 0, 1);
    const available = Math.max(0, metrics.travelHeight - metrics.thumbHeight);
    const thumbTop = scrollRatio * available;

    thumb.style.height = `${metrics.thumbHeight}px`;
    thumb.style.transform = `translateY(${thumbTop}px)`;
    track.setAttribute('aria-valuenow', String(Math.round(scrollRatio * 100)));
    track.setAttribute('aria-valuemax', '100');
  }

  function moveToClientY(clientY, metrics = activeDragMetrics) {
    metrics = metrics || getMetrics();
    if (!metrics.canScroll) {
      return;
    }

    const available = Math.max(1, metrics.travelHeight - metrics.thumbHeight);
    const rawTop = clientY - preview.getBoundingClientRect().top - metrics.trackTop - TRACK_THUMB_INSET - metrics.thumbHeight / 2;
    const ratio = clamp(rawTop / available, 0, 1);

    state.panY = metrics.maxPanY - ratio * metrics.range;
    applyTransform();
  }

  track.addEventListener('pointerdown', (event) => {
    if (track.classList.contains('is-disabled')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    activeDragMetrics = getMetrics();
    if (!activeDragMetrics.canScroll) {
      activeDragMetrics = null;
      return;
    }
    dragging = true;
    track.setPointerCapture(event.pointerId);
    track.classList.add('is-dragging');
    moveToClientY(event.clientY, activeDragMetrics);
  });

  track.addEventListener('pointermove', (event) => {
    if (!dragging) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    moveToClientY(event.clientY, activeDragMetrics);
  });

  function stopDragging(event) {
    if (!dragging) {
      return;
    }

    dragging = false;
    activeDragMetrics = null;
    track.classList.remove('is-dragging');
    if (event?.pointerId !== undefined && track.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId);
    }
  }

  track.addEventListener('pointerup', stopDragging);
  track.addEventListener('pointercancel', stopDragging);

  window.addEventListener('resize', sync);

  return {
    clampPanY,
    sync,
  };
}

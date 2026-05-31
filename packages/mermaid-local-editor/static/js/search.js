const SEARCH_CLASS = 'search-match';
const ACTIVE_CLASS = 'search-active';

function normalizeText(value) {
  return (value || '').toLocaleLowerCase();
}

function findTextMatches(source, query) {
  const normalizedSource = normalizeText(source);
  const normalizedQuery = normalizeText(query);
  const matches = [];

  if (!normalizedQuery) {
    return matches;
  }

  let index = normalizedSource.indexOf(normalizedQuery);
  while (index !== -1) {
    matches.push({ index, length: query.length });
    index = normalizedSource.indexOf(normalizedQuery, index + Math.max(query.length, 1));
  }

  return matches;
}

function getLineStart(source, index) {
  let line = 0;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      line += 1;
    }
  }
  return line;
}

function isVisibleElement(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getGraphTextElements(svg) {
  if (!svg) {
    return [];
  }

  return [...svg.querySelectorAll('text, foreignObject *')]
    .filter((el) => {
      const text = el.textContent?.trim();
      if (!text || !isVisibleElement(el)) {
        return false;
      }

      // Parent text already covers grouped tspans; searching tspans too would
      // produce duplicated stops for the same visible label.
      if (el.tagName.toLowerCase() !== 'text' && el.closest('text')) {
        return false;
      }

      return true;
    });
}

export function createSearch({ state, preview, srcPanel, applyTransform }) {
  const searchInput = document.getElementById('searchInput');
  const searchCount = document.getElementById('searchCount');
  const main = document.getElementById('main');
  const sourceMarker = document.createElement('div');

  let query = '';
  let sourceMatches = [];
  let graphMatches = [];
  let activeIndex = 0;
  let activeSourceLine = null;

  sourceMarker.className = 'source-search-marker';
  sourceMarker.hidden = true;
  document.body.appendChild(sourceMarker);

  function getSvg() {
    return state.svgRef || state.iframeRef?.contentDocument?.querySelector('svg');
  }

  function isSourceOpen() {
    return !main.classList.contains('source-collapsed');
  }

  function clearGraphHighlights() {
    const svg = getSvg();
    if (!svg) {
      return;
    }

    svg
      .querySelectorAll(`.${SEARCH_CLASS}, .${ACTIVE_CLASS}`)
      .forEach((el) => el.classList.remove(SEARCH_CLASS, ACTIVE_CLASS));
  }

  function findGraphMatches() {
    const normalizedQuery = normalizeText(query);
    return getGraphTextElements(getSvg()).filter((el) =>
      normalizeText(el.textContent).includes(normalizedQuery),
    );
  }

  function activeTotal() {
    if (!query) {
      return 0;
    }

    if (!isSourceOpen()) {
      return graphMatches.length;
    }

    return Math.max(sourceMatches.length, graphMatches.length);
  }

  function updateCounter() {
    const total = activeTotal();
    searchCount.classList.toggle('is-empty', Boolean(query) && total === 0);
    searchCount.title = query
      ? `图中 ${graphMatches.length} 处，代码中 ${sourceMatches.length} 处`
      : '';
    searchCount.textContent = query ? `${total ? activeIndex + 1 : 0}/${total}` : '';
  }

  function hideSourceMarker() {
    activeSourceLine = null;
    sourceMarker.hidden = true;
  }

  function updateSourceMarker() {
    if (!isSourceOpen() || activeSourceLine === null) {
      sourceMarker.hidden = true;
      return;
    }

    const style = getComputedStyle(srcPanel);
    const lineHeight = Number.parseFloat(style.lineHeight) || 22;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const rect = srcPanel.getBoundingClientRect();
    const top = rect.top + paddingTop + activeSourceLine * lineHeight - srcPanel.scrollTop;
    const visibleTop = rect.top + paddingTop;
    const visibleBottom = rect.bottom;

    if (top + lineHeight < visibleTop || top > visibleBottom) {
      sourceMarker.hidden = true;
      return;
    }

    sourceMarker.hidden = false;
    sourceMarker.style.left = `${rect.left + paddingLeft}px`;
    sourceMarker.style.top = `${Math.max(top, visibleTop)}px`;
    sourceMarker.style.width = `${Math.max(0, rect.width - paddingLeft - paddingRight)}px`;
    sourceMarker.style.height = `${Math.min(lineHeight, visibleBottom - Math.max(top, visibleTop))}px`;
  }

  function selectSourceMatch() {
    if (!isSourceOpen() || !sourceMatches.length) {
      hideSourceMarker();
      return;
    }

    const match = sourceMatches[activeIndex % sourceMatches.length];
    const line = getLineStart(srcPanel.value, match.index);
    const lineHeight = Number.parseFloat(getComputedStyle(srcPanel).lineHeight) || 22;

    srcPanel.scrollTop = Math.max(0, (line - 4) * lineHeight);
    srcPanel.setSelectionRange(match.index, match.index + match.length);
    activeSourceLine = line;
    updateSourceMarker();
  }

  function centerGraphMatch() {
    if (!graphMatches.length) {
      return;
    }

    const match = graphMatches[activeIndex % graphMatches.length];
    const matchRect = match.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();

    const matchCenterX = matchRect.left + matchRect.width / 2;
    const matchCenterY = matchRect.top + matchRect.height / 2;
    const previewCenterX = previewRect.left + previewRect.width / 2;
    const previewCenterY = previewRect.top + previewRect.height / 2;

    state.panX += previewCenterX - matchCenterX;
    state.panY += previewCenterY - matchCenterY;
    applyTransform();
  }

  function applyGraphHighlights() {
    clearGraphHighlights();

    graphMatches.forEach((el) => el.classList.add(SEARCH_CLASS));

    if (graphMatches.length) {
      graphMatches[activeIndex % graphMatches.length].classList.add(ACTIVE_CLASS);
    }
  }

  function revealActiveMatch() {
    const total = activeTotal();
    if (!total) {
      hideSourceMarker();
      updateCounter();
      return;
    }

    activeIndex = ((activeIndex % total) + total) % total;
    applyGraphHighlights();
    centerGraphMatch();
    selectSourceMatch();
    updateCounter();
  }

  function rebuildMatches({ keepIndex = false } = {}) {
    query = searchInput.value.trim();
    clearGraphHighlights();

    if (!query) {
      sourceMatches = [];
      graphMatches = [];
      activeIndex = 0;
      hideSourceMarker();
      updateCounter();
      return;
    }

    sourceMatches = findTextMatches(srcPanel.value, query);
    graphMatches = findGraphMatches();

    if (!keepIndex) {
      activeIndex = 0;
    }

    revealActiveMatch();
  }

  function goNext() {
    const total = activeTotal();
    if (!total) {
      return;
    }

    activeIndex = (activeIndex + 1) % total;
    revealActiveMatch();
  }

  searchInput.addEventListener('input', () => rebuildMatches());
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goNext();
    }
    if (event.key === 'Escape') {
      searchInput.value = '';
      rebuildMatches();
    }
  });

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
  srcPanel.addEventListener('scroll', updateSourceMarker);
  window.addEventListener('resize', updateSourceMarker);

  return {
    refreshAfterRender() {
      rebuildMatches({ keepIndex: true });
    },
  };
}

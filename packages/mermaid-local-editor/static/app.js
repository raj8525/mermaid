import { initMermaid, state, IS_E2E } from './js/config.js';
import { createStorage } from './js/storage.js?v=viewer-password-1';
import { renderDiagram } from './js/renderer.js?v=cursor-zoom-1';
import { ensureViewerAccess, setupUI, refreshList } from './js/ui.js?v=viewer-password-1';
import { createNavigation } from './js/navigation.js';
import { createSearch } from './js/search.js?v=search-1';
import { createAnnotations } from './js/annotations.js?v=annotations-manual-save-1';
import { createVerticalScrollbar } from './js/vertical-scrollbar.js?v=scrollbar-6';

initMermaid();

const srcPanel = document.getElementById('srcPanel');
const preview = document.getElementById('preview');
const diagramsSelect = document.getElementById('diagrams');
const nameInput = document.getElementById('name');
const storage = await createStorage();
await ensureViewerAccess(storage);
const urlParams = new URLSearchParams(location.search);
const requestedDiagram = urlParams.get('diagram');
let annotations;
let verticalScrollbar;

const navigation = createNavigation({
  state,
  preview,
  srcPanel,
  applyTransform,
});
const search = createSearch({
  state,
  preview,
  srcPanel,
  applyTransform,
});

function render() {
  void renderDiagram({
    srcValue: srcPanel.value,
    preview,
    state,
    IS_E2E,
    applyTransform,
    rebuildNavNodes: navigation.rebuildNavNodes,
    afterRender: () => {
      annotations?.render();
      search.refreshAfterRender();
    },
  }).then(() => {
    requestAnimationFrame(() => {
      applyTransform();
      verticalScrollbar?.sync();
    });
    setTimeout(() => {
      applyTransform();
      verticalScrollbar?.sync();
    }, 250);
  });
}

function getCurrentSvg() {
  return state.svgRef || state.iframeRef?.contentDocument?.querySelector('svg');
}

function load(name) {
  void storage.setCurrent(name);
  const d = storage.diagrams[name];

  srcPanel.value = d.src;

  // restore the view
  state.scale = d.view?.scale ?? 1;
  state.panX = d.view?.panX ?? 0;
  state.panY = d.view?.panY ?? 0;

  refreshList({ diagramsSelect, nameInput, storage });
  render();
  requestAnimationFrame(applyTransform);
}

function applyTransform() {
  const svg = getCurrentSvg();
  if (!svg) {
    return;
  }

  state.panY = Math.max(-20000, Math.min(20000, state.panY));
  state.panX = Math.max(-20000, Math.min(20000, state.panX));
  state.panY = verticalScrollbar?.clampPanY(state.panY) ?? state.panY;

  svg.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  annotations?.applyTransform();
  verticalScrollbar?.sync();

  void storage.updateCurrent({
    view: { scale: state.scale, panX: state.panX, panY: state.panY },
  });
}

annotations = createAnnotations({
  state,
  preview,
  storage,
});

verticalScrollbar = createVerticalScrollbar({
  state,
  preview,
  getSvg: getCurrentSvg,
  applyTransform,
});

setupUI({
  src: srcPanel,
  diagramsSelect,
  nameInput,
  storage,
  state,
  render,
  load,
  applyTransform,
});

navigation.setupKeyboardNav();
const initialDiagram =
  requestedDiagram && storage.diagrams[requestedDiagram] && !storage.diagrams[requestedDiagram].hidden
    ? requestedDiagram
    : !storage.diagrams[storage.current]?.hidden
      ? storage.current
      : storage.firstVisibleName() || storage.current;

load(initialDiagram);

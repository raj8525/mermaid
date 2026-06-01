function findLabelForRect(rect, labels) {
  const rectBox = rect.getBBox();
  const rectCenterX = rectBox.x + rectBox.width / 2;
  const rectCenterY = rectBox.y + rectBox.height / 2;

  return labels
    .map((label) => {
      const x = Number.parseFloat(label.getAttribute('x') || '0');
      const y = Number.parseFloat(label.getAttribute('y') || '0');
      return {
        label,
        distance: Math.abs(x - rectCenterX) + Math.abs(y - rectCenterY),
      };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.label;
}

function collectTopActors(svg) {
  if (!svg) {
    return [];
  }

  const labels = [...svg.querySelectorAll('text.actor-box')];
  return [...svg.querySelectorAll('rect.actor-top')]
    .map((rect) => {
      const label = findLabelForRect(rect, labels);
      return {
        rect,
        text: label?.textContent?.trim().replace(/\s+/g, ' ') || rect.getAttribute('name') || '',
      };
    })
    .filter((actor) => actor.text)
    .sort((a, b) => a.rect.getBoundingClientRect().left - b.rect.getBoundingClientRect().left);
}

export function createStickySequenceActors({ preview, getSvg }) {
  const overlay = document.createElement('div');
  overlay.className = 'sticky-sequence-actors';
  overlay.setAttribute('aria-hidden', 'true');

  let actors = [];
  let renderedCount = 0;

  function ensureMounted() {
    if (!overlay.isConnected || overlay.parentElement !== preview) {
      preview.appendChild(overlay);
    }
  }

  function rebuild() {
    const svg = getSvg();
    actors = collectTopActors(svg);
    renderedCount = actors.length;
    overlay.replaceChildren(
      ...actors.map((actor) => {
        const box = document.createElement('div');
        box.className = 'sticky-sequence-actor';
        box.textContent = actor.text;
        return box;
      })
    );
    sync();
  }

  function sync() {
    ensureMounted();
    const svg = getSvg();
    if (!svg || !actors.length || renderedCount !== overlay.children.length) {
      overlay.hidden = true;
      return;
    }

    const previewRect = preview.getBoundingClientRect();
    const actorRects = actors.map((actor) => actor.rect.getBoundingClientRect());
    const firstTop = Math.min(...actorRects.map((rect) => rect.top - previewRect.top));
    const stickyTop = 12;
    const shouldStick = firstTop < stickyTop;

    overlay.hidden = !shouldStick;
    if (!shouldStick) {
      return;
    }

    actorRects.forEach((rect, index) => {
      const box = overlay.children[index];
      if (!(box instanceof HTMLElement)) {
        return;
      }

      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      box.style.transform = `translate(${rect.left - previewRect.left}px, ${stickyTop}px)`;
      box.style.fontSize = `${Math.max(11, Math.min(18, rect.height * 0.28))}px`;
    });
  }

  window.addEventListener('resize', sync);

  return {
    rebuild,
    sync,
  };
}

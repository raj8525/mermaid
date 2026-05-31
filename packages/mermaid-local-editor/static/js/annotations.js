const MIN_ANNOTATION_SIZE = 14;

function createId() {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRect(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  return { x, y, w, h };
}

export function createAnnotations({ state, preview, storage }) {
  const modeButton = document.getElementById('annotationMode');
  const deleteButton = document.getElementById('deleteAnnotation');
  const layer = document.createElement('div');

  let annotationMode = false;
  let selectedId = null;
  let draft = null;
  let isDragging = false;
  let dragStart = null;
  let editingId = null;
  let activeInteraction = null;

  layer.className = 'annotation-layer';

  function getAnnotations() {
    return storage.diagrams[storage.current]?.annotations || [];
  }

  function saveAnnotations(annotations) {
    storage.updateCurrent({ annotations });
  }

  function updateAnnotation(id, patch) {
    saveAnnotations(
      getAnnotations().map((annotation) =>
        annotation.id === id ? { ...annotation, ...patch } : annotation,
      ),
    );
  }

  function getDraftEditorValue() {
    const editor = layer.querySelector('.annotation-draft .annotation-editor');
    return editor?.value ?? draft?.text ?? '';
  }

  function getEditEditorValue(id) {
    const editor = layer.querySelector(
      `[data-annotation-id="${CSS.escape(id)}"] .annotation-editor`,
    );
    const current = getAnnotations().find((annotation) => annotation.id === id);
    return editor?.value ?? current?.text ?? '';
  }

  function saveDraft() {
    if (!draft?.editing) {
      return false;
    }

    const text = getDraftEditorValue().trim();
    if (!text) {
      draft = null;
      selectedId = null;
      render();
      return false;
    }

    const annotation = {
      id: draft.id || createId(),
      x: draft.rect.x,
      y: draft.rect.y,
      w: draft.rect.w,
      h: draft.rect.h,
      text,
    };

    saveAnnotations([...getAnnotations(), annotation]);
    selectedId = annotation.id;
    draft = null;
    editingId = null;
    render();
    return true;
  }

  function saveEdit(id) {
    const text = getEditEditorValue(id).trim();
    if (!text) {
      return false;
    }

    updateAnnotation(id, { text });
    editingId = null;
    selectedId = id;
    render();
    return true;
  }

  function cancelActiveEditor({ renderAfter = true } = {}) {
    if (!draft?.editing && !editingId) {
      return false;
    }

    draft = null;
    editingId = null;

    if (renderAfter) {
      render();
    }

    return true;
  }

  function saveActiveEditor() {
    if (draft?.editing) {
      return saveDraft();
    }

    if (editingId) {
      return saveEdit(editingId);
    }

    return false;
  }

  function toGraphPoint(event) {
    const rect = preview.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - state.panX) / state.scale,
      y: (event.clientY - rect.top - state.panY) / state.scale,
    };
  }

  function toScreenRect(rect) {
    return {
      left: state.panX + rect.x * state.scale,
      top: state.panY + rect.y * state.scale,
      width: rect.w * state.scale,
      height: rect.h * state.scale,
    };
  }

  function setRectStyle(el, rect) {
    const screenRect = toScreenRect(rect);
    el.style.left = `${screenRect.left}px`;
    el.style.top = `${screenRect.top}px`;
    el.style.width = `${screenRect.width}px`;
    el.style.height = `${screenRect.height}px`;
    el.style.minHeight = `${screenRect.height}px`;
  }

  function updateButtons() {
    modeButton.classList.toggle('is-active', annotationMode);
    modeButton.textContent = annotationMode ? '退出批注' : '批注模式';
    modeButton.title = annotationMode ? '关闭批注模式，恢复拖动图片' : '打开批注模式，拖拽区域添加批注';
    deleteButton.hidden = !annotationMode;
    deleteButton.disabled = !selectedId;
  }

  function markSelectedCard() {
    layer
      .querySelectorAll('.annotation-card.is-selected')
      .forEach((card) => card.classList.remove('is-selected'));

    if (selectedId) {
      layer
        .querySelector(`[data-annotation-id="${CSS.escape(selectedId)}"]`)
        ?.classList.add('is-selected');
    }
  }

  function attachLayer() {
    if (layer.parentElement !== preview) {
      preview.appendChild(layer);
    }
  }

  function appendEditorControls(card) {
    const controls = document.createElement('div');
    controls.className = 'annotation-editor-actions';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'annotation-editor-save';
    saveButton.textContent = '保存';
    saveButton.title = '保存批注，快捷键 Ctrl/Command + Enter';
    saveButton.addEventListener('mousedown', (event) => event.stopPropagation());
    saveButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      saveActiveEditor();
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'annotation-editor-cancel';
    cancelButton.textContent = '取消';
    cancelButton.title = '放弃本次修改，恢复到保存前内容';
    cancelButton.addEventListener('mousedown', (event) => event.stopPropagation());
    cancelButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelActiveEditor();
    });

    controls.append(saveButton, cancelButton);
    card.appendChild(controls);
  }

  function bindEditorKeyboard(textarea) {
    textarea.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        saveActiveEditor();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelActiveEditor();
      }
    });
  }

  function renderDraft() {
    if (!draft) {
      return;
    }

    const draftEl = document.createElement('div');
    draftEl.className = 'annotation-card annotation-draft';
    setRectStyle(draftEl, draft.rect);

    if (draft.editing) {
      const textarea = document.createElement('textarea');
      textarea.className = 'annotation-editor';
      textarea.placeholder = '输入批注，Enter 换行，点保存提交';
      textarea.value = draft.text || '';
      textarea.addEventListener('pointerdown', (event) => event.stopPropagation());
      textarea.addEventListener('mousedown', (event) => event.stopPropagation());
      textarea.addEventListener('input', () => {
        draft.text = textarea.value;
      });
      bindEditorKeyboard(textarea);

      draftEl.appendChild(textarea);
      appendEditorControls(draftEl);
      layer.appendChild(draftEl);
      requestAnimationFrame(() => textarea.focus());
      return;
    }

    layer.appendChild(draftEl);
  }

  function renderAnnotations() {
    getAnnotations().forEach((annotation) => {
      const card = document.createElement('div');
      card.className = 'annotation-card';
      card.dataset.annotationId = annotation.id;
      card.classList.toggle('is-selected', annotation.id === selectedId);
      setRectStyle(card, annotation);

      if (editingId === annotation.id) {
        const textarea = document.createElement('textarea');
        textarea.className = 'annotation-editor';
        textarea.placeholder = '输入批注，Enter 换行，点保存提交';
        textarea.value = annotation.text;
        textarea.addEventListener('pointerdown', (event) => event.stopPropagation());
        textarea.addEventListener('mousedown', (event) => event.stopPropagation());
        bindEditorKeyboard(textarea);
        card.appendChild(textarea);
        appendEditorControls(card);
        requestAnimationFrame(() => textarea.focus());
      } else {
        const text = document.createElement('div');
        text.className = 'annotation-text';
        text.textContent = annotation.text;
        card.appendChild(text);
      }

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'annotation-resize-handle';
      resizeHandle.title = '拖动调整批注大小';
      resizeHandle.addEventListener('mousedown', (event) => startAnnotationResize(event, annotation));
      card.appendChild(resizeHandle);

      card.addEventListener('contextmenu', (event) => {
        if (!annotationMode) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        selectedId = annotation.id;
        updateButtons();
        render();
      });

      card.addEventListener('dblclick', (event) => {
        if (!annotationMode) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        cancelActiveEditor({ renderAfter: false });
        selectedId = annotation.id;
        editingId = annotation.id;
        activeInteraction = null;
        render();
      });

      card.addEventListener('mousedown', (event) => {
        if (annotationMode) {
          event.stopPropagation();
        }
        startAnnotationMove(event, annotation);
      });

      layer.appendChild(card);
    });
  }

  function render() {
    attachLayer();
    preview.dataset.annotationMode = annotationMode ? 'true' : 'false';
    layer.classList.toggle('is-editing', annotationMode);
    layer.replaceChildren();

    if (!getAnnotations().some((annotation) => annotation.id === selectedId)) {
      selectedId = null;
    }

    renderAnnotations();
    renderDraft();
    updateButtons();
  }

  function startAnnotationMove(event, annotation) {
    if (
      !annotationMode ||
      event.button !== 0 ||
      editingId ||
      event.target.closest('.annotation-resize-handle')
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectedId = annotation.id;
    activeInteraction = {
      type: 'move',
      id: annotation.id,
      start: toGraphPoint(event),
      original: { ...annotation },
    };
    markSelectedCard();
    updateButtons();
  }

  function startAnnotationResize(event, annotation) {
    if (!annotationMode || event.button !== 0 || editingId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectedId = annotation.id;
    activeInteraction = {
      type: 'resize',
      id: annotation.id,
      start: toGraphPoint(event),
      original: { ...annotation },
    };
    markSelectedCard();
    updateButtons();
  }

  function updateAnnotationInteraction(event) {
    if (!activeInteraction) {
      return;
    }

    event.preventDefault();
    const current = toGraphPoint(event);
    const dx = current.x - activeInteraction.start.x;
    const dy = current.y - activeInteraction.start.y;
    const { original, id, type } = activeInteraction;

    if (type === 'move') {
      updateAnnotation(id, {
        x: original.x + dx,
        y: original.y + dy,
      });
    }

    if (type === 'resize') {
      updateAnnotation(id, {
        w: Math.max(MIN_ANNOTATION_SIZE, original.w + dx),
        h: Math.max(MIN_ANNOTATION_SIZE, original.h + dy),
      });
    }

    render();
  }

  function finishAnnotationInteraction(event) {
    if (!activeInteraction) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    activeInteraction = null;
  }

  function startSelection(event) {
    if (!annotationMode || event.button !== 0 || event.target.closest('.annotation-card')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    isDragging = true;
    dragStart = toGraphPoint(event);
    draft = { rect: { x: dragStart.x, y: dragStart.y, w: 0, h: 0 }, editing: false };
    selectedId = null;
    render();
  }

  function updateSelection(event) {
    if (!isDragging || !draft || !dragStart) {
      return;
    }

    event.preventDefault();
    const current = toGraphPoint(event);
    draft.rect = normalizeRect(dragStart, current);
    render();
  }

  function finishSelection(event) {
    if (!isDragging || !draft) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    isDragging = false;
    dragStart = null;

    if (draft.rect.w < MIN_ANNOTATION_SIZE || draft.rect.h < MIN_ANNOTATION_SIZE) {
      draft = null;
      render();
      return;
    }

    draft.id = createId();
    draft.text = '';
    draft.editing = true;
    render();
  }

  function handleOutsideEditingPointerDown(event) {
    if (!annotationMode || (!draft?.editing && !editingId)) {
      return;
    }

    if (event.target.closest('.annotation-card')) {
      return;
    }

    if (preview.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  modeButton.addEventListener('click', () => {
    cancelActiveEditor({ renderAfter: false });
    annotationMode = !annotationMode;
    draft = null;
    selectedId = null;
    editingId = null;
    activeInteraction = null;
    render();
  });

  deleteButton.addEventListener('click', () => {
    if (!selectedId) {
      return;
    }

    cancelActiveEditor({ renderAfter: false });
    saveAnnotations(getAnnotations().filter((annotation) => annotation.id !== selectedId));
    selectedId = null;
    editingId = null;
    activeInteraction = null;
    render();
  });

  layer.addEventListener('mousedown', startSelection);
  window.addEventListener('mousedown', handleOutsideEditingPointerDown, true);
  window.addEventListener('mousemove', (event) => {
    updateSelection(event);
    updateAnnotationInteraction(event);
  });
  window.addEventListener('mouseup', (event) => {
    finishSelection(event);
    finishAnnotationInteraction(event);
  });
  layer.addEventListener('contextmenu', (event) => {
    if (annotationMode) {
      event.preventDefault();
    }
  });

  render();

  return {
    applyTransform() {
      render();
    },
    render,
  };
}

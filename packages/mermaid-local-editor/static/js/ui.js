export function refreshList({ diagramsSelect, nameInput, storage, showHidden }) {
  const canShowHidden = showHidden ?? document.body.dataset.adminOpen === 'true';
  const names = Object.keys(storage.diagrams).filter((k) => canShowHidden || !storage.diagrams[k]?.hidden);

  diagramsSelect.innerHTML = '';
  names.forEach((k) => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = storage.diagrams[k]?.hidden ? `${k}（已隐藏）` : k;
    diagramsSelect.appendChild(opt);
  });
  diagramsSelect.disabled = names.length === 0;
  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '没有可显示的图表';
    diagramsSelect.appendChild(opt);
  } else {
    diagramsSelect.value = names.includes(storage.current) ? storage.current : names[0];
  }
  nameInput.value = storage.current;
}

const VIEWER_AUTH_PREFIX = 'mermaid-viewer-auth-v1:';

export async function ensureViewerAccess(storage) {
  const viewerDialog = document.getElementById('viewerPasswordDialog');
  const viewerPasswordInput = document.getElementById('viewerPasswordInput');
  const viewerPasswordError = document.getElementById('viewerPasswordError');
  const confirmViewerPasswordBtn = document.getElementById('confirmViewerPassword');
  const access = await storage.getAccessConfig();
  const authKey = `${VIEWER_AUTH_PREFIX}${access.passwordUpdatedAt || 'disabled'}`;

  document.body.classList.remove('viewer-pending');

  if (!access.passwordRequired || sessionStorage.getItem(authKey) === 'true') {
    return;
  }

  document.body.classList.add('viewer-locked');
  viewerDialog.hidden = false;
  viewerPasswordInput.value = '';
  viewerPasswordError.hidden = true;
  requestAnimationFrame(() => viewerPasswordInput.focus());

  await new Promise((resolve) => {
    async function verify() {
      confirmViewerPasswordBtn.disabled = true;
      try {
        const result = await storage.verifyViewerPassword(viewerPasswordInput.value);
        const verifiedKey = `${VIEWER_AUTH_PREFIX}${result.passwordUpdatedAt || access.passwordUpdatedAt || 'disabled'}`;
        sessionStorage.setItem(verifiedKey, 'true');
        viewerDialog.hidden = true;
        document.body.classList.remove('viewer-locked');
        viewerPasswordInput.value = '';
        viewerPasswordError.hidden = true;
        resolve();
      } catch {
        viewerPasswordError.hidden = false;
        viewerPasswordInput.select();
      } finally {
        confirmViewerPasswordBtn.disabled = false;
      }
    }

    confirmViewerPasswordBtn.onclick = () => void verify();
    viewerPasswordInput.onkeydown = (event) => {
      if (event.key === 'Enter') {
        void verify();
      }
    };
  });
}

export function setupUI({
  src,
  diagramsSelect,
  nameInput,
  storage,
  state,
  render,
  load,
  applyTransform,
}) {
  const ADMIN_PASSWORD = '123qwe123';
  const ADMIN_AUTH_KEY = 'mermaid-admin-auth-until-v2';
  const ADMIN_AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const adminMenu = document.getElementById('adminMenu');
  const toolbar = document.getElementById('srcPanel');
  const main = document.getElementById('main');
  const toggleToolbarBtn = document.getElementById('toggleToolbar');
  const passwordDialog = document.getElementById('passwordDialog');
  const passwordInput = document.getElementById('adminPasswordInput');
  const passwordError = document.getElementById('adminPasswordError');
  const confirmPasswordBtn = document.getElementById('confirmAdminPassword');
  const cancelPasswordBtn = document.getElementById('cancelAdminPassword');
  let adminOpen = false;

  function hasAdminAuth() {
    return Number(localStorage.getItem(ADMIN_AUTH_KEY) || 0) > Date.now();
  }

  function openPasswordDialog() {
    passwordInput.value = '';
    passwordError.hidden = true;
    passwordDialog.hidden = false;
    requestAnimationFrame(() => passwordInput.focus());
  }

  function closePasswordDialog() {
    passwordDialog.hidden = true;
    passwordInput.value = '';
    passwordError.hidden = true;
  }

  function openAdminPanel() {
    adminOpen = true;
    applyAdminState();
  }

  function confirmAdminPassword() {
    if (passwordInput.value !== ADMIN_PASSWORD) {
      passwordError.hidden = false;
      passwordInput.select();
      return;
    }

    localStorage.setItem(ADMIN_AUTH_KEY, String(Date.now() + ADMIN_AUTH_TTL_MS));
    closePasswordDialog();
    openAdminPanel();
  }

  const saveBtn = document.getElementById('save');
  const newBtn = document.getElementById('new');
  const deleteBtn = document.getElementById('del');
  const hideToggleBtn = document.getElementById('hideToggle');
  const viewerPasswordInput = document.getElementById('viewerPasswordSetting');
  const setViewerPasswordBtn = document.getElementById('setViewerPassword');
  const clearViewerPasswordBtn = document.getElementById('clearViewerPassword');
  const viewerPasswordStatus = document.getElementById('viewerPasswordStatus');

  function updateHideToggle() {
    const currentDiagram = storage.diagrams[storage.current];
    hideToggleBtn.textContent = currentDiagram?.hidden ? '恢复显示' : '隐藏';
    hideToggleBtn.title = currentDiagram?.hidden
      ? '恢复后非管理员可以在下拉列表中看到这张图'
      : '隐藏后非管理员不会在下拉列表中看到这张图';
    hideToggleBtn.disabled = !currentDiagram;
  }

  function refreshCurrentList() {
    refreshList({ diagramsSelect, nameInput, storage, showHidden: adminOpen });
    updateHideToggle();
  }

  function applyAdminState() {
    toolbar.classList.toggle('collapsed', !adminOpen);
    main.classList.toggle('source-collapsed', !adminOpen);
    adminMenu.hidden = !adminOpen;
    document.body.dataset.adminOpen = String(adminOpen);
    toggleToolbarBtn.textContent = adminOpen ? '✕' : '☰';
    toggleToolbarBtn.title = adminOpen ? '关闭编辑面板' : '打开编辑面板';

    if (!adminOpen && storage.diagrams[storage.current]?.hidden) {
      const visibleName = storage.firstVisibleName();
      if (visibleName) {
        load(visibleName);
        return;
      }
    }

    refreshCurrentList();
  }

  async function runPersistingAction(button, action) {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      alert(`保存失败：${error.message || error}`);
    } finally {
      button.disabled = false;
    }
  }

  saveBtn.onclick = () => void runPersistingAction(saveBtn, async () => {
    const name = nameInput.value.trim();
    if (!name) {
      return;
    }

    await storage.save(name, {
      src: src.value,
      view: { scale: state.scale, panX: state.panX, panY: state.panY },
    });
    refreshCurrentList();
  });

  newBtn.onclick = () => void runPersistingAction(newBtn, async () => {
    const typedName = nameInput.value.trim();
    const name =
      typedName && typedName !== storage.current && !storage.diagrams[typedName]
        ? typedName
        : prompt('请输入新图表名称');
    if (!name) {
      return;
    }

    const cleanName = name.trim();
    await storage.create(cleanName);
    load(cleanName);
    refreshCurrentList();
  });

  deleteBtn.onclick = () => void runPersistingAction(deleteBtn, async () => {
    if (!confirm(`Delete diagram "${storage.current}"?`)) {
      return;
    }

    await storage.deleteCurrent();
    load(storage.current);
    refreshCurrentList();
  });

  hideToggleBtn.onclick = () => void runPersistingAction(hideToggleBtn, async () => {
    const currentDiagram = storage.diagrams[storage.current];
    if (!currentDiagram) {
      return;
    }

    const nextHidden = !currentDiagram.hidden;
    if (nextHidden && storage.visibleNames().length <= 1) {
      alert('至少要保留一张非隐藏图，方便普通查看者打开页面。');
      return;
    }

    await storage.setHidden(storage.current, nextHidden);
    refreshCurrentList();
  });

  setViewerPasswordBtn.onclick = () => void runPersistingAction(setViewerPasswordBtn, async () => {
    const password = viewerPasswordInput.value;
    if (!password) {
      viewerPasswordStatus.textContent = '请输入要设置的普通查看密码。';
      return;
    }

    await storage.setViewerPassword(password, ADMIN_PASSWORD);
    viewerPasswordInput.value = '';
    viewerPasswordStatus.textContent = '普通查看密码已更新。新浏览器会话打开页面时需要输入。';
  });

  clearViewerPasswordBtn.onclick = () => void runPersistingAction(clearViewerPasswordBtn, async () => {
    await storage.setViewerPassword('', ADMIN_PASSWORD);
    viewerPasswordInput.value = '';
    viewerPasswordStatus.textContent = '普通查看密码已清空，打开页面不再要求输入。';
  });

  document.getElementById('resetView').onclick = () => {
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    applyTransform(); // this will save the reset to storage.diagrams[storage.current].view
  };

  diagramsSelect.onchange = () => {
    if (diagramsSelect.value) {
      load(diagramsSelect.value);
      refreshCurrentList();
    }
  };

  let saveTimer;
  src.addEventListener('input', () => {
    render();

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (storage.diagrams[storage.current]) {
        storage.updateCurrent({ src: src.value });
      }
    }, 300);
  });

  toggleToolbarBtn.onclick = () => {
    if (!adminOpen && !hasAdminAuth()) {
      openPasswordDialog();
      return;
    }

    adminOpen = !adminOpen;
    applyAdminState();
  };

  confirmPasswordBtn.onclick = confirmAdminPassword;
  cancelPasswordBtn.onclick = closePasswordDialog;
  passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      confirmAdminPassword();
    }
    if (event.key === 'Escape') {
      closePasswordDialog();
    }
  });
  passwordDialog.addEventListener('click', (event) => {
    if (event.target === passwordDialog) {
      closePasswordDialog();
    }
  });

  applyAdminState();
  refreshCurrentList();
}

(function () {
  const api = window.llamaAPI;
  const view = document.getElementById('logView');
  const pathEl = document.getElementById('logPath');
  const filterEl = document.getElementById('filter');
  const btnAuto = document.getElementById('btnAutoscroll');
  const btnClear = document.getElementById('btnClear');
  const btnOpen = document.getElementById('btnOpenFile');
  const btnReveal = document.getElementById('btnReveal');
  const levelButtons = document.querySelectorAll('[data-level]');

  let autoscroll = true;
  let levelFilter = 'all'; // all | warn | error
  let textFilter = '';
  const MAX_LINES = 5000;

  if (!api || !api.getInitialLogs) {
    view.innerHTML =
      '<div class="placeholder">Log bridge unavailable. Preload failed to load.</div>';
    return;
  }

  function classifyLine(line) {
    const upper = line.toUpperCase();
    if (/\[ERROR\]|\bERROR\b|\bFATAL\b|EXCEPTION/.test(upper)) return 'error';
    if (/\[WARN\]|\bWARN(ING)?\b/.test(upper)) return 'warn';
    return 'info';
  }

  function shouldShow(level) {
    if (levelFilter === 'all') return true;
    if (levelFilter === 'warn') return level === 'warn' || level === 'error';
    if (levelFilter === 'error') return level === 'error';
    return true;
  }

  function matchesText(text) {
    if (!textFilter) return true;
    return text.toLowerCase().indexOf(textFilter) !== -1;
  }

  function trimBuffer() {
    while (view.childElementCount > MAX_LINES) {
      view.removeChild(view.firstChild);
    }
  }

  function appendChunk(chunk) {
    if (!chunk) return;
    const lines = String(chunk).split(/\r?\n/);
    const frag = document.createDocumentFragment();
    for (const raw of lines) {
      if (!raw) continue;
      const level = classifyLine(raw);
      const div = document.createElement('div');
      div.className = 'line ' + level;
      div.dataset.level = level;
      div.textContent = raw;
      if (!shouldShow(level) || !matchesText(raw)) {
        div.classList.add('hidden');
      }
      frag.appendChild(div);
    }
    view.appendChild(frag);
    trimBuffer();
    if (autoscroll) view.scrollTop = view.scrollHeight;
  }

  function applyFilters() {
    const children = view.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (
        el.classList.contains('placeholder') ||
        el.classList.contains('truncated-banner')
      ) {
        continue;
      }
      const visible = shouldShow(el.dataset.level) && matchesText(el.textContent);
      el.classList.toggle('hidden', !visible);
    }
    if (autoscroll) view.scrollTop = view.scrollHeight;
  }

  filterEl.addEventListener('input', () => {
    textFilter = filterEl.value.trim().toLowerCase();
    applyFilters();
  });

  levelButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      levelButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      levelFilter = btn.dataset.level;
      applyFilters();
    });
  });

  btnAuto.addEventListener('click', () => {
    autoscroll = !autoscroll;
    btnAuto.classList.toggle('active', autoscroll);
    if (autoscroll) view.scrollTop = view.scrollHeight;
  });

  view.addEventListener('scroll', () => {
    const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 24;
    if (!atBottom && autoscroll) {
      autoscroll = false;
      btnAuto.classList.remove('active');
    } else if (atBottom && !autoscroll) {
      autoscroll = true;
      btnAuto.classList.add('active');
    }
  });

  btnClear.addEventListener('click', () => {
    view.innerHTML = '';
  });

  btnOpen.addEventListener('click', () => {
    if (api.openLogFile) api.openLogFile();
  });
  btnReveal.addEventListener('click', () => {
    if (api.revealLogInFolder) api.revealLogInFolder();
  });

  api.getInitialLogs().then((result) => {
    if (!result) return;
    pathEl.textContent = result.path || '';
    pathEl.title = result.path || '';
    if (result.error) {
      view.innerHTML =
        '<div class="placeholder">Could not read log file: ' + result.error + '</div>';
      return;
    }
    if (result.truncated) {
      const banner = document.createElement('div');
      banner.className = 'truncated-banner';
      banner.textContent =
        'Showing the last 256 KB of the log file. Open the file or reveal it in your file manager to see earlier entries.';
      view.appendChild(banner);
    }
    appendChunk(result.content || '');
    if (!result.content) {
      const p = document.createElement('div');
      p.className = 'placeholder';
      p.textContent = 'Waiting for service output…';
      view.appendChild(p);
    }
  });

  const handler = (chunk) => appendChunk(chunk);
  if (api.onLogAppend) api.onLogAppend(handler);
  window.addEventListener('beforeunload', () => {
    if (api.offLogAppend) api.offLogAppend(handler);
  });
})();

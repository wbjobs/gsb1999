/*
 * app.js — 主线程应用：编辑器、Worker 调度、同步滚动、导出、异常提示。
 */
(function () {
  'use strict';

  var EDITOR_LINE_HEIGHT = 21; // 必须与 CSS 中 textarea 的 line-height 一致
  var DEBOUNCE_MS = 150;

  var editor = document.getElementById('editor');
  var previewScroll = document.getElementById('preview-scroll');
  var canvas = document.getElementById('preview-canvas');
  var spacer = document.getElementById('preview-spacer');
  var statusBar = document.getElementById('status');
  var toast = document.getElementById('toast');
  var syncToggle = document.getElementById('sync-toggle');

  var renderer = new CanvasRenderer(canvas);
  var latestHTML = '';
  var toastTimer = null;

  /* ---------------- 异常提示 ---------------- */
  function showError(message) {
    toast.textContent = '⚠ ' + message;
    toast.classList.add('show', 'error');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show', 'error'); }, 5000);
  }
  function showInfo(message) {
    toast.textContent = message;
    toast.classList.add('show');
    toast.classList.remove('error');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2000);
  }
  function setStatus(text) { statusBar.textContent = text; }

  /* ---------------- Worker 调度 ---------------- */
  var worker = null;
  var requestId = 0;
  var pendingText = null;
  var workerBusy = false;

  try {
    worker = new Worker('js/worker.js');
  } catch (err) {
    showError('Web Worker 创建失败，已切换为主线程解析：' + err.message);
  }

  if (worker) {
    worker.onmessage = function (e) {
      var msg = e.data || {};
      workerBusy = false;
      if (pendingText !== null) {
        var t = pendingText; pendingText = null;
        scheduleParse(t, 0);
        return;
      }
      if (!msg.ok) {
        showError('解析失败：' + (msg.error || '未知错误'));
        setStatus('解析出错');
        return;
      }
      try {
        latestHTML = msg.html;
        renderer.setBlocks(msg.blocks);
        spacer.style.height = renderer.totalHeight + 'px';
        requestRender();
        syncFromEditor();
        setStatus('解析完成 · ' + msg.blocks.length + ' 个块 · 耗时 ' + msg.duration + ' ms');
      } catch (err) {
        showError('渲染失败：' + err.message);
      }
    };
    worker.onerror = function (err) {
      workerBusy = false;
      showError('Worker 运行异常：' + (err.message || '未知错误'));
      setStatus('Worker 异常');
    };
  }

  var debounceTimer = null;
  function scheduleParse(text, delay) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { doParse(text); }, delay == null ? DEBOUNCE_MS : delay);
  }

  function doParse(text) {
    if (worker) {
      if (workerBusy) { pendingText = text; return; }
      workerBusy = true;
      try {
        worker.postMessage({ id: ++requestId, text: text });
      } catch (err) {
        workerBusy = false;
        showError('发送解析任务失败：' + err.message);
      }
    } else {
      // 降级：主线程解析（Worker 不可用时）
      try {
        var t0 = performance.now();
        var result = MDParser.parse(text);
        var duration = Math.round((performance.now() - t0) * 100) / 100;
        latestHTML = result.html;
        renderer.setBlocks(result.blocks);
        spacer.style.height = renderer.totalHeight + 'px';
        requestRender();
        setStatus('解析完成（主线程）· 耗时 ' + duration + ' ms');
      } catch (err) {
        showError('解析失败：' + err.message);
      }
    }
  }

  /* ---------------- Canvas 渲染调度 ---------------- */
  var renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      try {
        renderer.resizeBackingStore();
        renderer.renderViewport(previewScroll.scrollTop, previewScroll.clientHeight);
      } catch (err) {
        showError('绘制失败：' + err.message);
      }
    });
  }

  /* ---------------- 同步滚动 ---------------- */
  var syncSource = null; // 'editor' | 'preview'，防止回环
  var syncResetTimer = null;

  function beginSync(source) {
    if (syncSource && syncSource !== source) return false;
    syncSource = source;
    clearTimeout(syncResetTimer);
    syncResetTimer = setTimeout(function () { syncSource = null; }, 120);
    return true;
  }

  function syncFromEditor() {
    if (!syncToggle.checked) return;
    if (!beginSync('editor')) return;
    var topLine = editor.scrollTop / EDITOR_LINE_HEIGHT;
    var y = renderer.lineToY(topLine);
    previewScroll.scrollTop = Math.max(0, y);
  }

  function syncFromPreview() {
    if (!syncToggle.checked) return;
    if (!beginSync('preview')) return;
    var line = renderer.yToLine(previewScroll.scrollTop);
    editor.scrollTop = Math.max(0, line * EDITOR_LINE_HEIGHT);
  }

  editor.addEventListener('scroll', syncFromEditor, { passive: true });
  previewScroll.addEventListener('scroll', function () {
    requestRender();
    syncFromPreview();
  }, { passive: true });

  editor.addEventListener('input', function () {
    scheduleParse(editor.value);
  });

  window.addEventListener('resize', function () {
    renderer.relayout();
    spacer.style.height = renderer.totalHeight + 'px';
    requestRender();
  });

  /* ---------------- 导出 ---------------- */
  document.getElementById('export-html').addEventListener('click', function () {
    try {
      Exporter.exportHTML(latestHTML, 'Markdown 导出');
      showInfo('已导出 HTML');
    } catch (err) { showError(err.message); }
  });
  document.getElementById('export-md').addEventListener('click', function () {
    try {
      Exporter.exportMarkdown(editor.value);
      showInfo('已导出 Markdown');
    } catch (err) { showError(err.message); }
  });
  document.getElementById('export-png').addEventListener('click', function () {
    try {
      var full = renderer.renderFullPage();
      Exporter.exportPNG(full)
        .then(function () { showInfo('已导出 PNG'); })
        .catch(function (err) { showError(err.message); });
    } catch (err) { showError(err.message); }
  });

  /* ---------------- 初始化 ---------------- */
  var SAMPLE = [
    '# Markdown 编辑器',
    '',
    '支持 **加粗**、*斜体*、~~删除线~~、`行内代码` 与 [链接](https://example.com)。',
    '',
    '## 功能列表',
    '',
    '- 自定义解析器（无第三方依赖）',
    '- Web Worker 后台解析，不阻塞输入',
    '- Canvas 渲染预览，支持虚拟化绘制',
    '- 编辑器与预览双向同步滚动',
    '- 导出 HTML / Markdown / PNG',
    '',
    '> 异常会在这里以提示条形式告知，不会静默失败。',
    '',
    '```js',
    'function hello() {',
    '  console.log("Hello, Markdown!");',
    '}',
    '```',
    '',
    '| 特性 | 状态 |',
    '| --- | --- |',
    '| 解析 | ✅ |',
    '| 同步滚动 | ✅ |',
    '| 导出 | ✅ |',
    '',
    '---',
    '',
    '试着在左侧编辑，右侧预览会实时更新。'
  ].join('\n');

  editor.value = SAMPLE;
  scheduleParse(SAMPLE, 0);
})();

/*
 * Main thread: editor <-> preview wiring, debounced worker parsing,
 * bidirectional line-anchored scroll sync, HTML/PNG export, error toasts.
 */
/* global MarkdownParser */
(function () {
  'use strict';

  var editor = document.getElementById('editor');
  var preview = document.getElementById('preview');
  var statusEl = document.getElementById('status');
  var syncToggle = document.getElementById('sync-toggle');
  var toastsEl = document.getElementById('toasts');

  var DEBOUNCE_MS = 150;
  var WORKER_TIMEOUT_MS = 2000;
  var MAX_CANVAS_DIM = 8000;

  // ---------- Toasts (exception surfacing) ----------
  function toast(message, type) {
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = message;
    toastsEl.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 300);
    }, 3600);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  // ---------- Parser backend: Web Worker with main-thread fallback ----------
  var worker = null;
  var workerFailed = false;
  var requestId = 0;
  var pendingTimer = null;

  function createWorker() {
    if (workerFailed) return null;
    try {
      worker = new Worker('worker.js');
    } catch (err) {
      workerFailed = true;
      toast('Web Worker 不可用，已切换为主线程解析（性能略降）', 'warn');
      return null;
    }
    worker.onerror = function () {
      workerFailed = true;
      worker = null;
      toast('Worker 异常，已切换为主线程解析', 'warn');
      scheduleRender();
    };
    worker.onmessage = function (e) {
      var msg = e.data || {};
      if (msg.fatal) {
        workerFailed = true;
        worker = null;
        toast('Worker 加载失败，已切换为主线程解析', 'warn');
        scheduleRender();
        return;
      }
      if (msg.id !== requestId) return; // stale response
      clearTimeout(pendingTimer);
      pendingTimer = null;
      if (msg.ok) {
        applyRender(msg.html, msg.blocks, msg.time, 'Worker');
      } else {
        toast('解析失败：' + msg.error, 'error');
        setStatus('解析失败');
      }
    };
    return worker;
  }

  function parseWithWorker(source, id) {
    if (!worker && !createWorker()) return false;
    pendingTimer = setTimeout(function () {
      // Worker hung (e.g. file:// restrictions) -> fall back to main thread
      workerFailed = true;
      if (worker) { worker.terminate(); worker = null; }
      toast('Worker 响应超时，已切换为主线程解析', 'warn');
      parseOnMainThread(source, id);
    }, WORKER_TIMEOUT_MS);
    worker.postMessage({ id: id, source: source });
    return true;
  }

  function parseOnMainThread(source, id) {
    var t0 = performance.now();
    try {
      var result = MarkdownParser.parse(source);
      if (id !== requestId) return;
      applyRender(result.html, result.blocks, performance.now() - t0, '主线程');
    } catch (err) {
      toast('解析失败：' + err.message, 'error');
      setStatus('解析失败');
    }
  }

  // ---------- Render ----------
  var blockLines = [];

  function applyRender(html, blocks, timeMs, mode) {
    preview.innerHTML = html;
    blockLines = blocks.map(function (b) { return b.line; });
    var lines = editor.value.split('\n').length;
    setStatus('解析 ' + timeMs.toFixed(1) + 'ms · ' + blocks.length + ' 块 · ' +
      lines + ' 行 · ' + mode + ' 模式');
    if (syncToggle.checked) syncPreviewToEditor();
  }

  var debounceTimer = null;
  function scheduleRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderNow, DEBOUNCE_MS);
  }

  function renderNow() {
    var source = editor.value;
    requestId++;
    if (workerFailed || !parseWithWorker(source, requestId)) {
      parseOnMainThread(source, requestId);
    }
  }

  // ---------- Scroll sync (line-anchored, bidirectional) ----------
  function editorLineHeight() {
    var lh = parseFloat(getComputedStyle(editor).lineHeight);
    if (isNaN(lh)) lh = parseFloat(getComputedStyle(editor).fontSize) * 1.5;
    return lh || 21;
  }

  function previewBlocks() {
    return preview.querySelectorAll('[data-line]');
  }

  // binary search: last index with line <= target
  function findBlockIndex(lines, target) {
    var lo = 0, hi = lines.length - 1, ans = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid] <= target) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  var lastScrollSource = null;
  var lastScrollTime = 0;

  function markScroll(source) {
    lastScrollSource = source;
    lastScrollTime = Date.now();
  }

  function shouldIgnore(source) {
    return lastScrollSource !== source && Date.now() - lastScrollTime < 80;
  }

  function syncPreviewToEditor() {
    if (!blockLines.length) return;
    var topLine = editor.scrollTop / editorLineHeight();
    var idx = findBlockIndex(blockLines, topLine);
    var els = previewBlocks();
    if (!els.length || idx >= els.length) return;
    var el = els[idx];
    var frac = 0;
    if (idx + 1 < els.length) {
      var span = blockLines[idx + 1] - blockLines[idx];
      if (span > 0) frac = Math.min(Math.max((topLine - blockLines[idx]) / span, 0), 1);
    }
    markScroll('editor');
    preview.scrollTop = Math.max(0, el.offsetTop + frac * el.offsetHeight - 8);
  }

  function syncEditorToPreview() {
    var els = previewBlocks();
    if (!els.length) return;
    var st = preview.scrollTop + 8;
    var idx = 0;
    for (var k = 0; k < els.length; k++) {
      if (els[k].offsetTop <= st) idx = k; else break;
    }
    var el = els[idx];
    var line = Number(el.dataset.line);
    var frac = el.offsetHeight > 0 ? (st - el.offsetTop) / el.offsetHeight : 0;
    frac = Math.min(Math.max(frac, 0), 1);
    var nextLine = (idx + 1 < els.length) ? Number(els[idx + 1].dataset.line) : line + 1;
    markScroll('preview');
    editor.scrollTop = (line + frac * (nextLine - line)) * editorLineHeight();
  }

  editor.addEventListener('scroll', function () {
    if (!syncToggle.checked || shouldIgnore('editor')) return;
    markScroll('editor');
    syncPreviewToEditor();
  });

  preview.addEventListener('scroll', function () {
    if (!syncToggle.checked || shouldIgnore('preview')) return;
    markScroll('preview');
    syncEditorToPreview();
  });

  // ---------- Export ----------
  var EXPORT_CSS = [
    'body,.export-root{font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
    'line-height:1.6;color:#24292f;background:#ffffff;}',
    'body{max-width:860px;margin:0 auto;padding:24px;}',
    '.export-root{padding:24px;}',
    'h1,h2{border-bottom:1px solid #eaecef;padding-bottom:.3em;}',
    'code{background:#f6f8fa;padding:2px 6px;border-radius:4px;font-family:monospace;}',
    'pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto;}',
    'pre code{background:none;padding:0;}',
    'blockquote{border-left:4px solid #dfe2e5;margin:0;padding:0 16px;color:#6a737d;}',
    'table{border-collapse:collapse;}th,td{border:1px solid #dfe2e5;padding:6px 12px;}',
    'img{max-width:100%;}hr{border:none;border-top:1px solid #eaecef;}'
  ].join('');

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportHtml() {
    try {
      var doc = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '<title>Markdown 导出</title>\n<style>' + EXPORT_CSS + '</style>\n</head>\n<body>\n' +
        preview.innerHTML + '\n</body>\n</html>';
      download(new Blob([doc], { type: 'text/html;charset=utf-8' }), 'document.html');
      toast('HTML 导出成功', 'info');
    } catch (err) {
      toast('HTML 导出失败：' + err.message, 'error');
    }
  }

  function exportPng() {
    try {
      var width = Math.max(preview.scrollWidth, 320);
      var height = preview.scrollHeight;
      if (width > MAX_CANVAS_DIM || height > MAX_CANVAS_DIM) {
        toast('内容过大（' + width + 'x' + height + '），超出 Canvas ' + MAX_CANVAS_DIM + 'px 限制', 'error');
        return;
      }
      // Serialize preview DOM as XHTML so it is valid inside foreignObject
      var clone = preview.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      var serialized = '<div xmlns="http://www.w3.org/1999/xhtml" class="export-root">' +
        new XMLSerializer().serializeToString(clone) + '</div>';
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
        '<foreignObject width="100%" height="100%">' +
        '<style>' + EXPORT_CSS + '</style>' + serialized +
        '</foreignObject></svg>';
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(function (blob) {
            if (!blob) { toast('PNG 导出失败：Canvas 序列化异常', 'error'); return; }
            download(blob, 'document.png');
            toast('PNG 导出成功（Canvas ' + width + 'x' + height + '）', 'info');
          }, 'image/png');
        } catch (err) {
          toast('PNG 导出失败：' + err.message, 'error');
        }
      };
      img.onerror = function () {
        toast('PNG 导出失败：预览内容无法栅格化', 'error');
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch (err) {
      toast('PNG 导出失败：' + err.message, 'error');
    }
  }

  document.getElementById('btn-export-html').addEventListener('click', exportHtml);
  document.getElementById('btn-export-png').addEventListener('click', exportPng);

  // ---------- Sample document ----------
  editor.value = [
    '# Markdown 编辑器',
    '',
    '支持 **粗体**、*斜体*、~~删除线~~、`行内代码` 与 [链接](https://example.com)。',
    '',
    '## 列表示例',
    '',
    '- 自定义解析器',
    '- Web Worker 解析',
    '- Canvas 导出',
    '',
    '1. 解析',
    '2. 预览',
    '3. 同步滚动',
    '',
    '## 代码块',
    '',
    '```js',
    'function hello() {',
    '  console.log("hi");',
    '}',
    '```',
    '',
    '## 表格',
    '',
    '| 功能 | 状态 |',
    '| :--- | ---: |',
    '| 解析 | 完成 |',
    '| 导出 | 完成 |',
    '',
    '> 引用块：异常会通过右下角 Toast 提示。',
    '',
    '---',
    '',
    '滚动任一侧，另一侧会按行锚点同步。'
  ].join('\n');

  editor.addEventListener('input', scheduleRender);
  renderNow();
})();

/*
 * exporter.js — 导出模块：HTML / Markdown / PNG。
 * 所有导出均带异常处理，失败时抛出带中文说明的 Error，由调用方统一提示。
 */
(function (global) {
  'use strict';

  var HTML_TEMPLATE = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>{{title}}</title>',
    '<style>',
    'body{max-width:760px;margin:2rem auto;padding:0 1rem;font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7;color:#24292f}',
    'code{background:#f6f8fa;padding:.15em .4em;border-radius:4px;color:#d63384}',
    'pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}',
    'pre code{background:none;padding:0;color:inherit}',
    'blockquote{border-left:4px solid #d0d7de;margin:0;padding-left:1em;color:#57606a}',
    'table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:6px 12px}',
    'th{background:#f6f8fa}hr{border:none;border-top:2px solid #d0d7de}',
    'a{color:#0969da}',
    '</style>',
    '</head>',
    '<body>',
    '{{body}}',
    '</body>',
    '</html>'
  ].join('\n');

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function timestamp() {
    var d = new Date();
    function pad(x) { return String(x).padStart(2, '0'); }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  var Exporter = {
    exportHTML: function (htmlBody, title) {
      try {
        if (typeof htmlBody !== 'string') throw new Error('导出内容为空或格式非法');
        var doc = HTML_TEMPLATE
          .replace('{{title}}', title || 'Markdown 导出')
          .replace('{{body}}', htmlBody);
        download(new Blob([doc], { type: 'text/html;charset=utf-8' }),
          'markdown-' + timestamp() + '.html');
        return true;
      } catch (err) {
        throw new Error('导出 HTML 失败：' + err.message);
      }
    },

    exportMarkdown: function (source) {
      try {
        if (typeof source !== 'string') throw new Error('源内容为空或格式非法');
        download(new Blob([source], { type: 'text/markdown;charset=utf-8' }),
          'markdown-' + timestamp() + '.md');
        return true;
      } catch (err) {
        throw new Error('导出 Markdown 失败：' + err.message);
      }
    },

    exportPNG: function (canvas) {
      return new Promise(function (resolve, reject) {
        try {
          if (!canvas || typeof canvas.toBlob !== 'function') {
            throw new Error('画布不可用');
          }
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('导出 PNG 失败：画布编码为空')); return; }
            try {
              download(blob, 'markdown-' + timestamp() + '.png');
              resolve(true);
            } catch (err) {
              reject(new Error('导出 PNG 失败：' + err.message));
            }
          }, 'image/png');
        } catch (err) {
          reject(new Error('导出 PNG 失败：' + err.message));
        }
      });
    }
  };

  global.Exporter = Exporter;
})(typeof self !== 'undefined' ? self : this);

/*
 * Web Worker: runs the custom parser off the main thread.
 * In:  { id, source }
 * Out: { id, ok, html, blocks, time } or { id, ok:false, error }
 */
/* global importScripts, MarkdownParser */
'use strict';

try {
  importScripts('parser.js');
} catch (err) {
  self.postMessage({ id: -1, ok: false, fatal: true, error: 'Worker failed to load parser.js: ' + err.message });
}

self.onmessage = function (e) {
  var msg = e.data || {};
  var id = msg.id;
  if (typeof MarkdownParser === 'undefined') {
    self.postMessage({ id: id, ok: false, error: 'Parser not available inside worker' });
    return;
  }
  var t0 = performance.now();
  try {
    var result = MarkdownParser.parse(msg.source);
    self.postMessage({
      id: id,
      ok: true,
      html: result.html,
      blocks: result.blocks,
      time: performance.now() - t0
    });
  } catch (err) {
    self.postMessage({
      id: id,
      ok: false,
      error: (err && err.message) ? err.message : String(err)
    });
  }
};

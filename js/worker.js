/*
 * worker.js — 在 Web Worker 中执行 Markdown 解析，避免阻塞主线程。
 * 协议：接收 { id, text }，回发 { id, ok, blocks, html, duration } 或 { id, ok:false, error }。
 */
importScripts('parser.js');

self.onmessage = function (e) {
  var msg = e.data || {};
  var id = msg.id;
  try {
    if (typeof msg.text !== 'string') {
      throw new TypeError('Worker 收到非法输入：text 必须是字符串');
    }
    var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var result = self.MDParser.parse(msg.text);
    var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    self.postMessage({
      id: id,
      ok: true,
      blocks: result.blocks,
      html: result.html,
      duration: Math.round((t1 - t0) * 100) / 100
    });
  } catch (err) {
    self.postMessage({
      id: id,
      ok: false,
      error: (err && err.message) ? err.message : String(err)
    });
  }
};

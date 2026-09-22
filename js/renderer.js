/*
 * renderer.js — Canvas 预览渲染器。
 * 职责：把块级 AST 布局为绘制指令，记录 源行号 -> 画布 Y 坐标 锚点（供同步滚动），
 * 仅绘制可视区域（虚拟化），支持 devicePixelRatio 高清渲染与整页离屏导出。
 */
(function (global) {
  'use strict';

  var STYLE = {
    fontFamily: '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    monoFamily: 'ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace',
    baseSize: 15,
    lineHeight: 1.7,
    padding: 24,
    colors: {
      text: '#24292f', heading: '#1f2328', code: '#d63384', codeBg: '#f6f8fa',
      link: '#0969da', quote: '#57606a', quoteBar: '#d0d7de', hr: '#d0d7de',
      tableBorder: '#d0d7de', tableHeadBg: '#f6f8fa', strike: '#57606a'
    },
    headingScale: { 1: 2.0, 2: 1.6, 3: 1.35, 4: 1.15, 5: 1.05, 6: 0.95 }
  };

  function CanvasRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.blocks = [];
    this.layout = [];      // 每块的绘制指令 { y, height, draw(ctx, x, y) }
    this.anchors = [];     // [{ line, y }] 按 line 升序
    this.totalHeight = 0;
    this.width = 0;
    this.dpr = (global.devicePixelRatio || 1);
  }

  CanvasRenderer.prototype.setBlocks = function (blocks) {
    this.blocks = blocks || [];
    this.relayout();
  };

  CanvasRenderer.prototype.font = function (size, opts) {
    opts = opts || {};
    return (opts.italic ? 'italic ' : '') + (opts.bold ? 'bold ' : '') +
      size + 'px ' + (opts.mono ? STYLE.monoFamily : STYLE.fontFamily);
  };

  // 把行内 token 拍平为带样式的片段 [{ text, bold, italic, code, link, strike }]
  CanvasRenderer.prototype.flatten = function (tokens, inherited) {
    var out = [];
    inherited = inherited || {};
    var self = this;
    (tokens || []).forEach(function (tok) {
      if (tok.t === 'text') {
        out.push(Object.assign({ text: tok.text }, inherited));
      } else if (tok.t === 'code') {
        out.push(Object.assign({ text: tok.text, code: true }, inherited));
      } else if (tok.t === 'image') {
        out.push(Object.assign({ text: '[图片: ' + (tok.text || tok.href || '') + ']', link: true }, inherited));
      } else {
        var st = Object.assign({}, inherited);
        if (tok.t === 'bold') st.bold = true;
        if (tok.t === 'italic') st.italic = true;
        if (tok.t === 'link') st.link = true;
        if (tok.t === 'strike') st.strike = true;
        out = out.concat(self.flatten(tok.children || [], st));
      }
    });
    return out;
  };

  // 将片段按宽度换行，返回行数组，每行是 [{ seg, width }]
  CanvasRenderer.prototype.wrapSegments = function (segs, size, maxWidth) {
    var ctx = this.ctx, lines = [], current = [], currentW = 0;
    var self = this;
    function segFont(seg) {
      return self.font(seg.code ? size - 1 : size, seg);
    }
    segs.forEach(function (seg) {
      ctx.font = segFont(seg);
      var words = seg.text.split(/(\s+)/);
      words.forEach(function (word) {
        if (!word) return;
        var w = ctx.measureText(word).width;
        if (currentW + w > maxWidth && current.length > 0 && !/^\s+$/.test(word)) {
          lines.push(current); current = []; currentW = 0;
          if (/^\s+$/.test(word)) return;
        }
        current.push({ seg: Object.assign({}, seg, { text: word }), width: w });
        currentW += w;
      });
    });
    if (current.length) lines.push(current);
    return lines.length ? lines : [[]];
  };

  CanvasRenderer.prototype.drawSegmentLine = function (ctx, line, x, y, size, colorOverride) {
    var cursor = x, self = this;
    line.forEach(function (item) {
      var seg = item.seg;
      ctx.font = self.font(seg.code ? size - 1 : size, seg);
      ctx.fillStyle = colorOverride || (seg.code ? STYLE.colors.code :
        seg.link ? STYLE.colors.link : STYLE.colors.text);
      ctx.fillText(seg.text, cursor, y);
      if (seg.link || seg.strike) {
        var ly = seg.strike ? y - size * 0.28 : y + 2;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cursor, ly); ctx.lineTo(cursor + item.width, ly); ctx.stroke();
      }
      cursor += item.width;
    });
  };

  CanvasRenderer.prototype.relayout = function () {
    var cssWidth = this.canvas.clientWidth || this.canvas.width / this.dpr;
    this.width = cssWidth;
    var maxWidth = cssWidth - STYLE.padding * 2;
    var y = STYLE.padding;
    var self = this;
    this.layout = [];
    this.anchors = [];

    this.blocks.forEach(function (block) {
      var startY = y;
      var entry = { y: startY, height: 0, draw: null };
      var size = STYLE.baseSize;
      var lineH = Math.round(size * STYLE.lineHeight);

      switch (block.type) {
        case 'heading': {
          size = Math.round(STYLE.baseSize * (STYLE.headingScale[block.level] || 1));
          lineH = Math.round(size * 1.5);
          var hsegs = self.flatten(block.inline, { bold: true });
          var hlines = self.wrapSegments(hsegs, size, maxWidth);
          entry.draw = function (ctx, ox, oy) {
            ctx.fillStyle = STYLE.colors.heading;
            hlines.forEach(function (line, idx) {
              self.drawSegmentLine(ctx, line, ox, oy + idx * lineH + size, size);
            });
            if (block.level <= 2) {
              ctx.strokeStyle = STYLE.colors.hr; ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(ox, oy + hlines.length * lineH + 6);
              ctx.lineTo(ox + maxWidth, oy + hlines.length * lineH + 6);
              ctx.stroke();
            }
          };
          y += hlines.length * lineH + (block.level <= 2 ? 16 : 8) + 8;
          break;
        }
        case 'paragraph': {
          var psegs = self.flatten(block.inline);
          var plines = self.wrapSegments(psegs, size, maxWidth);
          entry.draw = function (ctx, ox, oy) {
            plines.forEach(function (line, idx) {
              self.drawSegmentLine(ctx, line, ox, oy + idx * lineH + size, size);
            });
          };
          y += plines.length * lineH + 12;
          break;
        }
        case 'quote': {
          var qsegs = self.flatten(block.inline, { italic: false });
          var qlines = self.wrapSegments(qsegs, size, maxWidth - 16);
          entry.draw = function (ctx, ox, oy) {
            ctx.fillStyle = STYLE.colors.quoteBar;
            ctx.fillRect(ox, oy, 4, qlines.length * lineH);
            qlines.forEach(function (line, idx) {
              self.drawSegmentLine(ctx, line, ox + 16, oy + idx * lineH + size, size, STYLE.colors.quote);
            });
          };
          y += qlines.length * lineH + 12;
          break;
        }
        case 'code': {
          var codeLines = block.text.split('\n');
          var cLineH = Math.round((size - 1) * 1.5);
          var boxH = codeLines.length * cLineH + 16;
          entry.draw = function (ctx, ox, oy) {
            ctx.fillStyle = STYLE.colors.codeBg;
            ctx.fillRect(ox, oy, maxWidth, boxH);
            ctx.font = self.font(size - 1, { mono: true });
            ctx.fillStyle = STYLE.colors.text;
            codeLines.forEach(function (cl, idx) {
              ctx.fillText(cl, ox + 10, oy + 10 + idx * cLineH + size - 4);
            });
            if (block.unclosed) {
              ctx.fillStyle = '#cf222e';
              ctx.font = self.font(11, {});
              ctx.fillText('⚠ 代码块未闭合', ox + 10, oy + boxH - 4);
            }
          };
          y += boxH + 12;
          break;
        }
        case 'hr': {
          entry.draw = function (ctx, ox, oy) {
            ctx.strokeStyle = STYLE.colors.hr; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(ox, oy + 6); ctx.lineTo(ox + maxWidth, oy + 6); ctx.stroke();
          };
          y += 20;
          break;
        }
        case 'list': {
          var itemsDraw = [];
          var listY = 0;
          block.items.forEach(function (item, idx) {
            var isegs = self.flatten(item.inline);
            var ilines = self.wrapSegments(isegs, size, maxWidth - 28);
            itemsDraw.push({ lines: ilines, y: listY, marker: block.ordered ? (idx + 1) + '.' : '•' });
            listY += ilines.length * lineH + 4;
          });
          entry.draw = function (ctx, ox, oy) {
            itemsDraw.forEach(function (item) {
              ctx.font = self.font(size, {});
              ctx.fillStyle = STYLE.colors.text;
              ctx.fillText(item.marker, ox + 4, oy + item.y + size);
              item.lines.forEach(function (line, li) {
                self.drawSegmentLine(ctx, line, ox + 28, oy + item.y + li * lineH + size, size);
              });
            });
          };
          y += listY + 12;
          break;
        }
        case 'table': {
          var cols = block.header.length;
          var colW = maxWidth / Math.max(cols, 1);
          var rowH = lineH + 10;
          var tableH = rowH * (1 + block.rows.length);
          entry.draw = function (ctx, ox, oy) {
            ctx.strokeStyle = STYLE.colors.tableBorder; ctx.lineWidth = 1;
            ctx.fillStyle = STYLE.colors.tableHeadBg;
            ctx.fillRect(ox, oy, maxWidth, rowH);
            for (var r = 0; r <= block.rows.length + 1; r++) {
              ctx.beginPath(); ctx.moveTo(ox, oy + r * rowH); ctx.lineTo(ox + maxWidth, oy + r * rowH); ctx.stroke();
            }
            for (var c = 0; c <= cols; c++) {
              ctx.beginPath(); ctx.moveTo(ox + c * colW, oy); ctx.lineTo(ox + c * colW, oy + tableH); ctx.stroke();
            }
            function cellText(cell, cx, cy, bold) {
              var segs = self.flatten(cell.inline, bold ? { bold: true } : {});
              var txt = segs.map(function (s) { return s.text; }).join('');
              ctx.font = self.font(size - 1, { bold: !!bold });
              ctx.fillStyle = STYLE.colors.text;
              ctx.fillText(txt, cx + 8, cy + rowH / 2 + (size - 1) / 2 - 2, colW - 16);
            }
            block.header.forEach(function (cell, ci) { cellText(cell, ox + ci * colW, oy, true); });
            block.rows.forEach(function (row, ri) {
              row.forEach(function (cell, ci) { cellText(cell, ox + ci * colW, oy + (ri + 1) * rowH, false); });
            });
          };
          y += tableH + 12;
          break;
        }
        default: {
          y += lineH;
          entry.draw = function () {};
        }
      }

      entry.height = y - startY;
      self.layout.push(entry);
      self.anchors.push({ line: block.line, y: startY });
    });

    this.totalHeight = y + STYLE.padding;
    this.resizeBackingStore();
  };

  CanvasRenderer.prototype.resizeBackingStore = function () {
    var cssWidth = this.canvas.clientWidth || 600;
    var cssHeight = Math.max(this.canvas.clientHeight || 400, 1);
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
  };

  // 视口渲染：只绘制与 [scrollTop, scrollTop+viewHeight] 相交的块
  CanvasRenderer.prototype.renderViewport = function (scrollTop, viewHeight) {
    var ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, viewHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.width, viewHeight);
    ctx.textBaseline = 'alphabetic';
    for (var k = 0; k < this.layout.length; k++) {
      var entry = this.layout[k];
      if (entry.y + entry.height < scrollTop || entry.y > scrollTop + viewHeight) continue;
      ctx.save();
      ctx.translate(0, -scrollTop);
      entry.draw(ctx, STYLE.padding, entry.y);
      ctx.restore();
    }
  };

  // 整页离屏渲染（导出 PNG 用），返回离屏 canvas
  CanvasRenderer.prototype.renderFullPage = function () {
    var off = document.createElement('canvas');
    var scale = 2;
    off.width = Math.round(this.width * scale);
    off.height = Math.round(this.totalHeight * scale);
    var ctx = off.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.width, this.totalHeight);
    ctx.textBaseline = 'alphabetic';
    for (var k = 0; k < this.layout.length; k++) {
      var entry = this.layout[k];
      entry.draw(ctx, STYLE.padding, entry.y);
    }
    return off;
  };

  /* -------- 同步滚动坐标换算 -------- */
  // 源行号 -> 画布 Y（锚点间线性插值）
  CanvasRenderer.prototype.lineToY = function (line) {
    var a = this.anchors;
    if (!a.length) return 0;
    if (line <= a[0].line) return a[0].y;
    for (var k = 1; k < a.length; k++) {
      if (line <= a[k].line) {
        var prev = a[k - 1], next = a[k];
        var span = next.line - prev.line;
        var ratio = span > 0 ? (line - prev.line) / span : 0;
        return prev.y + ratio * (next.y - prev.y);
      }
    }
    return a[a.length - 1].y;
  };

  // 画布 Y -> 源行号
  CanvasRenderer.prototype.yToLine = function (y) {
    var a = this.anchors;
    if (!a.length) return 0;
    if (y <= a[0].y) return a[0].line;
    for (var k = 1; k < a.length; k++) {
      if (y <= a[k].y) {
        var prev = a[k - 1], next = a[k];
        var span = next.y - prev.y;
        var ratio = span > 0 ? (y - prev.y) / span : 0;
        return prev.line + ratio * (next.line - prev.line);
      }
    }
    return a[a.length - 1].line;
  };

  global.CanvasRenderer = CanvasRenderer;
  global.CANVAS_STYLE = STYLE;
})(typeof self !== 'undefined' ? self : this);

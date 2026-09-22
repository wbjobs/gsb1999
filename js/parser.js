/*
 * parser.js — 自定义 Markdown 解析器（无第三方依赖）
 * 环境无关：可运行于 Web Worker、浏览器主线程与 Node（用于测试）。
 * 输出：块级 AST（含源行号，用于同步滚动）+ 行内 token + HTML 字符串。
 */
(function (global) {
  'use strict';

  var escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, function (ch) { return escapeMap[ch]; });
  }

  /* ---------------- 行内解析 ---------------- */
  // 返回 token 数组：{ t: 'text'|'bold'|'italic'|'code'|'link'|'strike'|'image', text, href, children }
  function parseInline(text) {
    var tokens = [];
    var buf = '';
    var i = 0;
    var n = text.length;

    function flush() {
      if (buf) { tokens.push({ t: 'text', text: buf }); buf = ''; }
    }
    // 从 pos 起查找未转义的 marker，找不到返回 -1
    function findClose(marker, pos) {
      var idx = text.indexOf(marker, pos);
      while (idx !== -1 && idx > 0 && text[idx - 1] === '\\') {
        idx = text.indexOf(marker, idx + marker.length);
      }
      return idx;
    }

    while (i < n) {
      var ch = text[i];
      var two = text.substr(i, 2);

      if (ch === '\\' && i + 1 < n) { buf += text[i + 1]; i += 2; continue; }

      if (ch === '`') {
        var end = findClose('`', i + 1);
        if (end !== -1) { flush(); tokens.push({ t: 'code', text: text.slice(i + 1, end) }); i = end + 1; continue; }
      }
      if (two === '**' || two === '__') {
        var endB = findClose(two, i + 2);
        if (endB !== -1 && endB > i + 2) {
          flush();
          tokens.push({ t: 'bold', children: parseInline(text.slice(i + 2, endB)) });
          i = endB + 2; continue;
        }
      }
      if (two === '~~') {
        var endS = findClose('~~', i + 2);
        if (endS !== -1 && endS > i + 2) {
          flush();
          tokens.push({ t: 'strike', children: parseInline(text.slice(i + 2, endS)) });
          i = endS + 2; continue;
        }
      }
      if (ch === '*' || ch === '_') {
        var endI = findClose(ch, i + 1);
        if (endI !== -1 && endI > i + 1) {
          flush();
          tokens.push({ t: 'italic', children: parseInline(text.slice(i + 1, endI)) });
          i = endI + 1; continue;
        }
      }
      if (two === '![') {
        var altEnd = text.indexOf('](', i + 2);
        if (altEnd !== -1) {
          var srcEnd = text.indexOf(')', altEnd + 2);
          if (srcEnd !== -1) {
            flush();
            tokens.push({ t: 'image', text: text.slice(i + 2, altEnd), href: text.slice(altEnd + 2, srcEnd) });
            i = srcEnd + 1; continue;
          }
        }
      }
      if (ch === '[') {
        var labelEnd = text.indexOf('](', i + 1);
        if (labelEnd !== -1) {
          var hrefEnd = text.indexOf(')', labelEnd + 2);
          if (hrefEnd !== -1) {
            flush();
            tokens.push({ t: 'link', children: parseInline(text.slice(i + 1, labelEnd)), href: text.slice(labelEnd + 2, hrefEnd) });
            i = hrefEnd + 1; continue;
          }
        }
      }
      buf += ch; i += 1;
    }
    flush();
    return tokens;
  }

  function inlineToHTML(tokens) {
    var out = '';
    for (var k = 0; k < tokens.length; k++) {
      var tok = tokens[k];
      switch (tok.t) {
        case 'text': out += escapeHTML(tok.text); break;
        case 'code': out += '<code>' + escapeHTML(tok.text) + '</code>'; break;
        case 'bold': out += '<strong>' + inlineToHTML(tok.children) + '</strong>'; break;
        case 'italic': out += '<em>' + inlineToHTML(tok.children) + '</em>'; break;
        case 'strike': out += '<del>' + inlineToHTML(tok.children) + '</del>'; break;
        case 'link': out += '<a href="' + escapeHTML(tok.href) + '">' + inlineToHTML(tok.children) + '</a>'; break;
        case 'image': out += '<img alt="' + escapeHTML(tok.text) + '" src="' + escapeHTML(tok.href) + '">'; break;
      }
    }
    return out;
  }

  /* ---------------- 块级解析 ---------------- */
  var RE = {
    heading: /^(#{1,6})\s+(.*)$/,
    hr: /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/,
    fence: /^\s{0,3}(```|~~~)(.*)$/,
    quote: /^\s{0,3}>\s?(.*)$/,
    ulist: /^(\s{0,3})[-*+]\s+(.*)$/,
    olist: /^(\s{0,3})\d+[.)]\s+(.*)$/,
    tableRow: /^\s*\|.*\|\s*$/,
    tableSep: /^\s*\|?[\s:|-]+\|[\s:|-]*$/
  };

  function parseBlocks(src) {
    if (typeof src !== 'string') {
      throw new TypeError('解析输入必须是字符串，收到：' + typeof src);
    }
    var lines = src.replace(/\r\n?/g, '\n').split('\n');
    var blocks = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { i++; continue; }

      // 代码块
      var fence = line.match(RE.fence);
      if (fence) {
        var startLine = i, marker = fence[1], lang = fence[2].trim();
        var codeLines = [];
        i++;
        var closed = false;
        while (i < lines.length) {
          if (lines[i].indexOf(marker) === 0 || /^\s{0,3}(```|~~~)\s*$/.test(lines[i])) { closed = true; i++; break; }
          codeLines.push(lines[i]); i++;
        }
        blocks.push({ type: 'code', line: startLine, lang: lang, text: codeLines.join('\n'), unclosed: !closed });
        continue;
      }

      // 标题
      var h = line.match(RE.heading);
      if (h) {
        blocks.push({ type: 'heading', line: i, level: h[1].length, inline: parseInline(h[2].trim()) });
        i++; continue;
      }

      // 分割线
      if (RE.hr.test(line)) { blocks.push({ type: 'hr', line: i }); i++; continue; }

      // 引用块（可跨行）
      if (RE.quote.test(line)) {
        var qStart = i, qLines = [];
        while (i < lines.length && RE.quote.test(lines[i])) {
          qLines.push(lines[i].match(RE.quote)[1]); i++;
        }
        blocks.push({ type: 'quote', line: qStart, inline: parseInline(qLines.join(' ')) });
        continue;
      }

      // 表格：表头行 + 分隔行
      if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        var tStart = i;
        var header = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && RE.tableRow.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        blocks.push({ type: 'table', line: tStart, header: header, rows: rows });
        continue;
      }

      // 列表（无序/有序，连续行合并）
      var ul = line.match(RE.ulist), ol = line.match(RE.olist);
      if (ul || ol) {
        var lStart = i, ordered = !!ol, items = [];
        var itemRe = ordered ? RE.olist : RE.ulist;
        while (i < lines.length) {
          var m = lines[i].match(itemRe);
          if (!m) break;
          items.push({ inline: parseInline(m[2].trim()) });
          i++;
        }
        blocks.push({ type: 'list', line: lStart, ordered: ordered, items: items });
        continue;
      }

      // 段落：合并连续非空行，直到遇到其他块起始
      var pStart = i, pLines = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !RE.heading.test(lines[i]) && !RE.fence.test(lines[i]) &&
             !RE.quote.test(lines[i]) && !RE.hr.test(lines[i]) &&
             !RE.ulist.test(lines[i]) && !RE.olist.test(lines[i])) {
        pLines.push(lines[i]); i++;
      }
      blocks.push({ type: 'paragraph', line: pStart, inline: parseInline(pLines.join(' ')) });
    }
    return blocks;
  }

  function splitRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(function (cell) {
      return { inline: parseInline(cell.trim()) };
    });
  }

  /* ---------------- HTML 输出 ---------------- */
  function blocksToHTML(blocks) {
    var out = [];
    for (var k = 0; k < blocks.length; k++) {
      var b = blocks[k];
      switch (b.type) {
        case 'heading': out.push('<h' + b.level + '>' + inlineToHTML(b.inline) + '</h' + b.level + '>'); break;
        case 'paragraph': out.push('<p>' + inlineToHTML(b.inline) + '</p>'); break;
        case 'code':
          out.push('<pre><code' + (b.lang ? ' class="language-' + escapeHTML(b.lang) + '"' : '') + '>' +
            escapeHTML(b.text) + '</code></pre>' +
            (b.unclosed ? '<!-- 警告：代码块未闭合 -->' : ''));
          break;
        case 'quote': out.push('<blockquote>' + inlineToHTML(b.inline) + '</blockquote>'); break;
        case 'hr': out.push('<hr>'); break;
        case 'list':
          var tag = b.ordered ? 'ol' : 'ul';
          out.push('<' + tag + '>' + b.items.map(function (it) {
            return '<li>' + inlineToHTML(it.inline) + '</li>';
          }).join('') + '</' + tag + '>');
          break;
        case 'table':
          out.push('<table><thead><tr>' + b.header.map(function (c) {
            return '<th>' + inlineToHTML(c.inline) + '</th>';
          }).join('') + '</tr></thead><tbody>' + b.rows.map(function (row) {
            return '<tr>' + row.map(function (c) { return '<td>' + inlineToHTML(c.inline) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table>');
          break;
      }
    }
    return out.join('\n');
  }

  function parse(src) {
    var blocks = parseBlocks(src);
    return { blocks: blocks, html: blocksToHTML(blocks) };
  }

  var api = { parse: parse, parseBlocks: parseBlocks, parseInline: parseInline, toHTML: blocksToHTML, escapeHTML: escapeHTML };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  global.MDParser = api;
})(typeof self !== 'undefined' ? self : this);

/*
 * Custom Markdown parser (no third-party deps).
 * Works in browser (window.MarkdownParser), Web Worker (importScripts) and Node (module.exports).
 * parse(source) -> { html, blocks: [{ line }] }; every block element carries data-line for scroll sync.
 */
(function (root, factory) {
  var parser = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = parser;
  } else {
    root.MarkdownParser = parser;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_INPUT_BYTES = 5 * 1024 * 1024; // 5MB input guard

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeUrl(url) {
    var trimmed = String(url || '').trim();
    if (/^\s*(javascript|vbscript|data)\s*:/i.test(trimmed)) {
      return '#';
    }
    return trimmed;
  }

  // Inline: code spans -> escape -> images/links -> bold/italic/strikethrough
  function parseInline(text) {
    var codeSpans = [];
    var out = String(text).replace(/(`+)([\s\S]*?)\1/g, function (match, ticks, code) {
      codeSpans.push('<code>' + escapeHtml(code.replace(/^ | $/g, '')) + '</code>');
      return '@@CSPAN' + (codeSpans.length - 1) + '@@';
    });

    out = escapeHtml(out);

    out = out.replace(/!\[([^\]]*)\]\((\S+?)(?:\s+&quot;(.*?)&quot;)?\)/g,
      function (match, alt, src, title) {
        var t = title ? ' title="' + title + '"' : '';
        return '<img src="' + sanitizeUrl(src) + '" alt="' + alt + '"' + t + '>';
      });

    out = out.replace(/\[([^\]]+)\]\((\S+?)(?:\s+&quot;(.*?)&quot;)?\)/g,
      function (match, label, href, title) {
        var t = title ? ' title="' + title + '"' : '';
        return '<a href="' + sanitizeUrl(href) + '"' + t + ' target="_blank" rel="noopener">' + label + '</a>';
      });

    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    out = out.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');

    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    out = out.replace(/@@CSPAN(\d+)@@/g, function (match, idx) {
      return codeSpans[Number(idx)] || '';
    });

    return out;
  }

  function isBlank(line) {
    return /^\s*$/.test(line);
  }

  function matchFence(line) {
    return line.match(/^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
  }

  function matchHeading(line) {
    return line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
  }

  function matchHr(line) {
    return /^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/.test(line);
  }

  function matchListItem(line) {
    return line.match(/^( {0,3})([-*+]|\d{1,9}[.)])[ \t]+(.*)$/);
  }

  function matchTableDivider(line) {
    return /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)+\|?[ \t]*$/.test(line);
  }

  function splitTableRow(line) {
    var trimmed = line.trim();
    if (trimmed.charAt(0) === '|') trimmed = trimmed.slice(1);
    if (trimmed.charAt(trimmed.length - 1) === '|') trimmed = trimmed.slice(0, -1);
    return trimmed.split('|').map(function (cell) { return cell.trim(); });
  }

  function parseAlignments(dividerLine) {
    return splitTableRow(dividerLine).map(function (cell) {
      var left = cell.charAt(0) === ':';
      var right = cell.charAt(cell.length - 1) === ':';
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return '';
    });
  }

  // Whether a line opens a new block (used to terminate paragraphs/quotes)
  function matchBlockStart(line, lines, index) {
    if (matchFence(line) || matchHeading(line) || matchHr(line)) return true;
    if (/^ {0,3}>/.test(line)) return true;
    if (matchListItem(line)) return true;
    if (lines && typeof index === 'number' &&
        line.indexOf('|') !== -1 && index + 1 < lines.length && matchTableDivider(lines[index + 1])) return true;
    return false;
  }

  function parse(source) {
    if (typeof source !== 'string') {
      throw new TypeError('Parse failed: input must be a string');
    }
    if (source.length > MAX_INPUT_BYTES) {
      throw new RangeError('Parse failed: document exceeds the 5MB limit');
    }

    var lines = source.replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var blocks = [];
    var i = 0;

    function push(tag, line, inner) {
      html.push('<' + tag + ' data-line="' + line + '">' + inner + '</' + tag + '>');
      blocks.push({ line: line });
    }

    while (i < lines.length) {
      var line = lines[i];

      if (isBlank(line)) { i++; continue; }

      // Fenced code block
      var fence = matchFence(line);
      if (fence) {
        var startLine = i;
        var marker = fence[1].charAt(0);
        var minLen = fence[1].length;
        var lang = fence[2];
        var closeRe = new RegExp('^ {0,3}' + (marker === '`' ? '`' : '~') + '{' + minLen + ',}\s*$');
        var buf = [];
        i++;
        while (i < lines.length && !closeRe.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing fence; tolerate unclosed fence to EOF
        var cls = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
        html.push('<pre data-line="' + startLine + '"><code' + cls + '>' +
          escapeHtml(buf.join('\n')) + '</code></pre>');
        blocks.push({ line: startLine });
        continue;
      }

      // ATX heading
      var heading = matchHeading(line);
      if (heading) {
        push('h' + heading[1].length, i, parseInline(heading[2]));
        i++;
        continue;
      }

      // Horizontal rule
      if (matchHr(line)) {
        html.push('<hr data-line="' + i + '">');
        blocks.push({ line: i });
        i++;
        continue;
      }

      // Blockquote (consecutive > lines, parsed recursively)
      if (/^ {0,3}>/.test(line)) {
        var quoteStart = i;
        var quoteLines = [];
        while (i < lines.length && (/^ {0,3}>/.test(lines[i]) ||
               (!isBlank(lines[i]) && quoteLines.length && !matchBlockStart(lines[i], lines, i)))) {
          quoteLines.push(lines[i].replace(/^ {0,3}> ?/, ''));
          i++;
        }
        // Nested blocks keep relative line numbers; strip them so the outer
        // data-line sequence stays monotonic for scroll-sync binary search.
        var inner = parse(quoteLines.join('\n')).html.replace(/ data-line="\d+"/g, '');
        html.push('<blockquote data-line="' + quoteStart + '">' + inner + '</blockquote>');
        blocks.push({ line: quoteStart });
        continue;
      }

      // List (consecutive items of the same kind)
      var item = matchListItem(line);
      if (item) {
        var listStart = i;
        var ordered = /^\d/.test(item[2]);
        var tag = ordered ? 'ol' : 'ul';
        var startNum = ordered ? parseInt(item[2], 10) : 1;
        var items = [];
        while (i < lines.length) {
          var li = matchListItem(lines[i]);
          if (!li) break;
          if ((/^\d/.test(li[2])) !== ordered) break;
          items.push('<li>' + parseInline(li[3]) + '</li>');
          i++;
        }
        var startAttr = (ordered && startNum !== 1) ? ' start="' + startNum + '"' : '';
        html.push('<' + tag + ' data-line="' + listStart + '"' + startAttr + '>' +
          items.join('') + '</' + tag + '>');
        blocks.push({ line: listStart });
        continue;
      }

      // Table: current line contains | and next line is a divider
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && matchTableDivider(lines[i + 1])) {
        var tableStart = i;
        var headers = splitTableRow(line);
        var aligns = parseAlignments(lines[i + 1]);
        i += 2;
        var rows = [];
        while (i < lines.length && !isBlank(lines[i]) && lines[i].indexOf('|') !== -1) {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        var alignAttr = function (idx) {
          return aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : '';
        };
        var thead = '<thead><tr>' + headers.map(function (h, idx) {
          return '<th' + alignAttr(idx) + '>' + parseInline(h) + '</th>';
        }).join('') + '</tr></thead>';
        var tbody = '<tbody>' + rows.map(function (row) {
          return '<tr>' + row.map(function (cell, idx) {
            return '<td' + alignAttr(idx) + '>' + parseInline(cell) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody>';
        html.push('<table data-line="' + tableStart + '">' + thead + tbody + '</table>');
        blocks.push({ line: tableStart });
        continue;
      }

      // Paragraph: gather until blank line or next block opener
      var paraStart = i;
      var paraLines = [];
      while (i < lines.length && !isBlank(lines[i]) && !matchBlockStart(lines[i], lines, i)) {
        paraLines.push(lines[i].trim());
        i++;
      }
      push('p', paraStart, parseInline(paraLines.join(' ')));
    }

    return { html: html.join('\n'), blocks: blocks };
  }

  return {
    parse: parse,
    parseInline: parseInline,
    escapeHtml: escapeHtml,
    MAX_INPUT_BYTES: MAX_INPUT_BYTES
  };
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const parser = require('../parser.js');

test('headings render with data-line', () => {
  const { html, blocks } = parser.parse('# Title\n\n## Sub');
  assert.match(html, /<h1 data-line="0">Title<\/h1>/);
  assert.match(html, /<h2 data-line="2">Sub<\/h2>/);
  assert.deepStrictEqual(blocks.map(b => b.line), [0, 2]);
});

test('inline formats', () => {
  const { html } = parser.parse('**bold** *italic* ~~del~~ `code`');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<del>del<\/del>/);
  assert.match(html, /<code>code<\/code>/);
});

test('raw HTML is escaped (XSS safe)', () => {
  const { html } = parser.parse('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('dangerous link protocols are neutralized', () => {
  const { html } = parser.parse('[x](javascript:alert(1))');
  assert.ok(!html.includes('javascript:'));
});

test('code inside spans is not formatted', () => {
  const { html } = parser.parse('`**not bold**`');
  assert.match(html, /<code>\*\*not bold\*\*<\/code>/);
});

test('fenced code block with language', () => {
  const { html } = parser.parse('```js\nlet a = 1 < 2;\n```');
  assert.match(html, /<pre data-line="0"><code class="language-js">let a = 1 &lt; 2;/);
});

test('unclosed fence tolerated to EOF', () => {
  const { html } = parser.parse('```\ncode');
  assert.match(html, /<pre data-line="0"><code>code<\/code><\/pre>/);
});

test('unordered and ordered lists', () => {
  const { html } = parser.parse('- a\n- b\n\n3. c\n4. d');
  assert.match(html, /<ul data-line="0"><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol data-line="3" start="3"><li>c<\/li><li>d<\/li><\/ol>/);
});

test('blockquote', () => {
  const { html } = parser.parse('> hello **world**');
  assert.match(html, /<blockquote data-line="0"><p>hello <strong>world<\/strong><\/p><\/blockquote>/);
});

test('data-line sequence is monotonic (scroll-sync precondition)', () => {
  const src = '# t\n\npara\n\n> quoted\n> lines\n\n- a\n- b\n\nend';
  const { html, blocks } = parser.parse(src);
  const linesInHtml = [...html.matchAll(/data-line="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepStrictEqual(linesInHtml, blocks.map(b => b.line));
  const sorted = [...linesInHtml].sort((a, b) => a - b);
  assert.deepStrictEqual(linesInHtml, sorted);
});

test('table with alignment', () => {
  const src = '| a | b |\n| :- | -: |\n| 1 | 2 |';
  const { html } = parser.parse(src);
  assert.match(html, /<th style="text-align:left">a<\/th>/);
  assert.match(html, /<th style="text-align:right">b<\/th>/);
  assert.match(html, /<td style="text-align:left">1<\/td>/);
});

test('horizontal rule', () => {
  const { html } = parser.parse('a\n\n---');
  assert.match(html, /<hr data-line="2">/);
});

test('links and images', () => {
  const { html } = parser.parse('[t](https://a.b "T") ![alt](https://a.b/i.png)');
  assert.match(html, /<a href="https:\/\/a.b" title="T" target="_blank" rel="noopener">t<\/a>/);
  assert.match(html, /<img src="https:\/\/a.b\/i.png" alt="alt">/);
});

test('non-string input throws', () => {
  assert.throws(() => parser.parse(null), TypeError);
});

test('oversized input throws', () => {
  assert.throws(() => parser.parse('x'.repeat(6 * 1024 * 1024)), RangeError);
});

test('empty input', () => {
  const { html, blocks } = parser.parse('');
  assert.strictEqual(html, '');
  assert.deepStrictEqual(blocks, []);
});

test('performance: 10k lines parse well under 1s', () => {
  const doc = Array.from({ length: 10000 }, (_, i) =>
    i % 5 === 0 ? '## Heading ' + i : 'Paragraph **text** with `code` and [link](https://x.y) ' + i
  ).join('\n\n');
  const t0 = performance.now();
  const { blocks } = parser.parse(doc);
  const elapsed = performance.now() - t0;
  assert.ok(blocks.length > 3000);
  assert.ok(elapsed < 1000, 'parse took ' + elapsed.toFixed(0) + 'ms');
  console.log('  10k-line parse: ' + elapsed.toFixed(1) + 'ms, ' + blocks.length + ' blocks');
});

/* 解析器单元测试：node test/parser.test.js */
'use strict';
const assert = require('assert');
const path = require('path');
const MDParser = require(path.join(__dirname, '..', 'js', 'parser.js'));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (err) { console.error('  ✗ ' + name + '\n    ' + err.message); process.exitCode = 1; }
}

console.log('块级解析');
test('标题级别与行号', () => {
  const { blocks } = MDParser.parse('# A\n\n## B\n');
  assert.strictEqual(blocks[0].type, 'heading');
  assert.strictEqual(blocks[0].level, 1);
  assert.strictEqual(blocks[1].level, 2);
  assert.strictEqual(blocks[1].line, 2, '第二个块应记录源行号');
});
test('段落合并连续行', () => {
  const { blocks } = MDParser.parse('line one\nline two\n\nnext');
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].type, 'paragraph');
});
test('代码块与语言标记', () => {
  const { blocks } = MDParser.parse('```js\nlet a = 1;\n```');
  assert.strictEqual(blocks[0].type, 'code');
  assert.strictEqual(blocks[0].lang, 'js');
  assert.strictEqual(blocks[0].unclosed, false);
});
test('未闭合代码块被标记而非抛错', () => {
  const { blocks } = MDParser.parse('```\ncode without end');
  assert.strictEqual(blocks[0].unclosed, true);
});
test('有序/无序列表', () => {
  const { blocks } = MDParser.parse('- a\n- b\n\n1. x\n2. y');
  assert.strictEqual(blocks[0].ordered, false);
  assert.strictEqual(blocks[0].items.length, 2);
  assert.strictEqual(blocks[1].ordered, true);
});
test('引用块跨行合并', () => {
  const { blocks } = MDParser.parse('> hello\n> world');
  assert.strictEqual(blocks[0].type, 'quote');
});
test('表格解析', () => {
  const { blocks } = MDParser.parse('| A | B |\n|---|---|\n| 1 | 2 |');
  assert.strictEqual(blocks[0].type, 'table');
  assert.strictEqual(blocks[0].header.length, 2);
  assert.strictEqual(blocks[0].rows.length, 1);
});
test('分割线', () => {
  const { blocks } = MDParser.parse('a\n\n---');
  assert.strictEqual(blocks[1].type, 'hr');
});

console.log('行内解析');
test('加粗/斜体/行内代码/删除线', () => {
  const t = MDParser.parseInline('**b** *i* `c` ~~s~~');
  assert.deepStrictEqual(t.map(x => x.t), ['bold', 'text', 'italic', 'text', 'code', 'text', 'strike']);
});
test('链接与图片', () => {
  const t = MDParser.parseInline('[txt](http://a) ![alt](img.png)');
  assert.strictEqual(t[0].t, 'link');
  assert.strictEqual(t[0].href, 'http://a');
  assert.strictEqual(t[2].t, 'image');
});
test('嵌套加粗内斜体', () => {
  const t = MDParser.parseInline('**a *b* c**');
  assert.strictEqual(t[0].t, 'bold');
  assert.strictEqual(t[0].children.some(c => c.t === 'italic'), true);
});
test('未闭合标记按纯文本处理', () => {
  const t = MDParser.parseInline('a **b');
  assert.strictEqual(t.map(x => x.text).join(''), 'a **b');
});

console.log('HTML 输出与安全性');
test('HTML 转义防注入', () => {
  const { html } = MDParser.parse('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), '原始脚本标签必须被转义');
  assert.ok(html.includes('&lt;script&gt;'));
});
test('导出 HTML 结构正确', () => {
  const { html } = MDParser.parse('# T\n\npara\n\n- i1\n- i2');
  assert.ok(html.includes('<h1>T</h1>'));
  assert.ok(html.includes('<p>para</p>'));
  assert.ok(html.includes('<ul><li>i1</li><li>i2</li></ul>'));
});

console.log('异常处理');
test('非字符串输入抛出 TypeError', () => {
  assert.throws(() => MDParser.parse(null), TypeError);
  assert.throws(() => MDParser.parse(42), TypeError);
});
test('空字符串返回空块', () => {
  const { blocks, html } = MDParser.parse('');
  assert.strictEqual(blocks.length, 0);
  assert.strictEqual(html, '');
});
test('CRLF 换行归一化', () => {
  const { blocks } = MDParser.parse('# A\r\n\r\nB');
  assert.strictEqual(blocks.length, 2);
});

console.log('性能');
test('10 万字符文档解析 < 500ms', () => {
  const doc = Array.from({ length: 4000 }, (_, i) =>
    '## 标题 ' + i + '\n\n这是一段 **加粗** 文本，包含 `代码` 和 [链接](http://x)。\n\n- 项目一\n- 项目二\n').join('\n');
  assert.ok(doc.length > 100000, '测试文档应超过 10 万字符，实际 ' + doc.length);
  const t0 = process.hrtime.bigint();
  const { blocks } = MDParser.parse(doc);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('    解析 ' + doc.length + ' 字符 -> ' + blocks.length + ' 块，耗时 ' + ms.toFixed(1) + 'ms');
  assert.ok(ms < 500, '解析耗时 ' + ms.toFixed(1) + 'ms 超过 500ms 阈值');
});

console.log('\n' + passed + ' 项测试' + (process.exitCode ? '存在失败' : '全部通过'));

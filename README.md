# Markdown 编辑器

自定义解析器 + Web Worker + Canvas 实现的 Markdown 编辑器，支持实时预览、双向同步滚动与多格式导出。

## 运行

Web Worker 需要通过 HTTP 访问，不能直接双击打开 `index.html`：

```bash
cd 本目录
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 测试

```bash
node test/parser.test.js
```

## 架构

| 模块 | 职责 |
| --- | --- |
| `js/parser.js` | 自定义 Markdown 解析器（零依赖），输出带源行号的块级 AST + HTML；环境无关（Worker / 浏览器 / Node） |
| `js/worker.js` | Web Worker 中执行解析，主线程不阻塞；异常捕获后回传错误消息 |
| `js/renderer.js` | Canvas 渲染器：布局、虚拟化视口绘制、DPR 高清适配、源行号 ↔ Y 坐标锚点换算、整页离屏渲染 |
| `js/exporter.js` | 导出 HTML（独立样式文档）/ Markdown / PNG（2x 离屏画布） |
| `js/app.js` | 主线程调度：防抖解析、双向同步滚动（防回环）、导出、Toast 异常提示 |

## 验收标准对照

- **同步滚动准确**：解析器为每个块记录源行号，渲染器建立 行号↔Y 锚点表并线性插值；编辑器按行高换算，双向同步且用 `syncSource` 锁防止滚动回环。
- **导出正确**：HTML 导出为带内联样式的独立文档；PNG 由离屏 Canvas 整页 2x 渲染；Markdown 导出原始文本。
- **预览准确**：Canvas 按 AST 逐块绘制，行内样式（加粗/斜体/代码/链接/删除线）经 `measureText` 精确换行。
- **性能可接受**：输入 150ms 防抖；解析在 Worker 中执行（26 万字符实测约 41ms）；渲染仅绘制可视区域的块；滚动经 `requestAnimationFrame` 合帧。
- **异常有提示**：解析失败、Worker 异常、渲染失败、导出失败均通过顶部 Toast 提示；Worker 不可用时自动降级为主线程解析；未闭合代码块在预览中标注警告。

## 支持的语法

标题（1-6 级）、段落、加粗、斜体、删除线、行内代码、代码块（含语言标记）、链接、图片（占位渲染）、有序/无序列表、引用块、分割线、表格。

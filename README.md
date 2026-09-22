# Markdown 编辑器（解析 / 预览 / 同步滚动 / 导出）

零依赖的 Markdown 编辑器：**自定义解析器 + Web Worker + Canvas**。

## 运行

```bash
# Web Worker 在 file:// 协议下会被浏览器拦截，请通过 HTTP 访问
python3 -m http.server 8000
# 打开 http://localhost:8000
```

若 Worker 不可用（如直接双击 file:// 打开），会自动降级为主线程解析并弹出提示。

## 测试

```bash
node --test test/parser.test.js
```

## 架构

| 文件 | 职责 |
| --- | --- |
| `parser.js` | 自定义 Markdown 解析器（浏览器 / Worker / Node 三端通用），输出带 `data-line` 的 HTML 与块行号表 |
| `worker.js` | Web Worker，在后台线程执行解析，返回耗时与结果 |
| `app.js` | 主线程：防抖调度、双向同步滚动、HTML/PNG 导出、异常 Toast |
| `index.html` / `styles.css` | 页面结构与样式 |
| `test/parser.test.js` | 解析器单元测试（含 1 万行性能用例） |

## 验收标准对照

- **同步滚动准确**：每个块级元素携带 `data-line`，滚动时按行号在块间线性插值，双向同步（编辑器 ↔ 预览），带 80ms 回环保护，可用复选框关闭。
- **导出正确**：HTML 导出为内联样式的独立文档；PNG 导出经 `XMLSerializer` → SVG `foreignObject` → Canvas 栅格化，超过 8000px 限制时明确报错。
- **预览准确**：支持标题、段落、粗体/斜体/删除线、行内代码、代码块（含语言标记）、有序/无序列表、引用、表格（含对齐）、分割线、链接与图片；原始 HTML 一律转义，危险协议（`javascript:` 等）被拦截。
- **性能可接受**：输入 150ms 防抖；解析在 Worker 中执行不阻塞 UI；1 万行文档解析约 35ms（见性能测试）；状态栏实时显示解析耗时；输入超过 5MB 拒绝并提示。
- **异常有提示**：解析异常、Worker 加载失败/超时（自动降级）、导出失败、内容超限等均通过右下角 Toast 提示。

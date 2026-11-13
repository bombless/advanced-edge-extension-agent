# Advanced Edge Agent for Huawei Cloud CodeArts

面向 **华为云码道 CodeArts** 的 Edge 网页自动化 Agent，使用本地 Runner 执行受工作区沙箱约束的工具。

## 功能

- 在 CodeArts 聊天页注入工具协议，并扫描 AI 回复中的 `@actions[...]`。
- 通过本地 Runner（默认 `127.0.0.1:8765`）执行文件和工作区工具。
- 自动把 `@tool_results[...]` 回传到 CodeArts 对话。
- 页面右下角提供 Auto Loop、Auto Init 和 Runner 连接状态控制面板。
- 保留原有 Runner 工具协议与路径沙箱。

## 启动 Runner

在项目根目录运行：

```powershell
npm start
```

默认工作区为项目根目录。也可指定工作区：

```powershell
$env:AGENT_WORKSPACE = "D:/my-project"
npm start
```

Runner 监听 `http://127.0.0.1:8765`。

## 加载 Edge 扩展

1. 打开 `edge://extensions/` 并启用开发人员模式。
2. 选择“加载解压缩的扩展”。
3. 选择本项目的 `extension` 文件夹。
4. 打开华为云码道：`https://devcloud.cn-north-4.huaweicloud.com/chat/home`。

扩展当前匹配 `devcloud.cn-north-4.huaweicloud.com/chat/*`。如果 CodeArts 更换区域域名，需要同步调整 `extension/manifest.json` 的 host_permissions 和 matches。

## 说明

- Gemini 专用 DOM 适配已替换为 `extension/codearts.js`。
- 工具协议和 Runner 不依赖 Gemini，保持兼容。
- CodeArts 的发送输入框和发送按钮使用当前页面实测选择器；AI 回复容器的内部结构可能随前端版本变化，适配器采用多组候选选择器。
- 未确认 CodeArts 的稳定“重新生成”按钮，因此迁移版不会盲目触发错误重试；工具循环、手动 Inject 和 Auto Init 不受影响。
- Runner 仍严格限制在配置的工作区目录内。

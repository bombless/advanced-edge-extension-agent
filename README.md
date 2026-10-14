# Advanced Edge Extension Agent

专为 **Microsoft Edge** 深度定制的独立 Gemini Web 自动化 Agent。

**完全独立，无需安装或运行 Windows TSF 输入法！**

---

## 解决的核心痛点

1. **零快捷键依赖**：
   - 彻底废除任何 `Ctrl+Shift+...` 快捷键，再也不会与 Edge 的原生功能（如“发送反馈”、“朗读此页内容”等）冲突。
   - 网页右下角常驻微型控制面板：
     - **⚡ 实时状态监测**：自动检测本地 Runner 连接状态（在线/离线）。
     - **🤖 Auto Tool Loop 开关**：开启后，自动捕获模型输出的 `@actions[...]` 并闭环执行。
     - **一键注入系统提示词**：支持手动点按注入，也支持在开启 Auto Loop 时首次发送指令自动静默附加系统协议。
2. **纯净单体架构**：
   - 浏览器插件与本地轻量 Runner 独立运行，不侵入系统输入法、不注册 COM 组件。
3. **安全沙箱机制**：
   - 本地 Runner 严格限制在指定的工作区目录下（防止 `../` 越权目录遍历）。

---

## 快速使用步骤

### 1. 启动本地 Runner

在本项目根目录下运行：

```bash
# 默认使用当前目录作为 Agent 工作区
npm start

# 或指定自定义的工作区目录：
# $env:AGENT_WORKSPACE = "D:/my-project"; npm start
```

启动后会看到控制台提示：
```text
[Advanced Edge Agent Runner] Listening on http://127.0.0.1:8765
[Workspace Sandbox] D:\mcp-agent-workspace\advanced-edge-extension-agent
```

### 2. 在 Microsoft Edge 中加载扩展

1. 打开 Edge 浏览器，访问：`edge://extensions/`。
2. 开启左下角或右上角的 **“开发人员模式”**。
3. 点击 **“加载解压缩的扩展”**。
4. 选择本项目中的 `extension` 文件夹。

### 3. 打开 Gemini 开始使用

1. 访问 [Gemini Web 网页](https://gemini.google.com/app)。
2. 你会看到右下角的 **🤖 Edge Agent 面板** 显示 `Connected to Runner`。
3. 直接输入你的需求，如：“*请查看当前目录下的文件，并为我创建一个 test.py 脚本*”。
4. Agent 将全自动进行工具调用与结果反馈，实现无缝的自动化研发体验！

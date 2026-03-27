# VoxFlow

macOS 实时语音转文字工具。按住全局快捷键，说话，文字自动出现在当前应用中。

## 功能特性

- **全局快捷键** — `Cmd + Shift + \` 在任意应用中可用
- **实时转写** — 通过 ElevenLabs Scribe v2，说话时文字实时流式输出
- **智能文本注入** — 使用 macOS 辅助功能 API 检测焦点，通过 CGEvent 按键模拟注入文字
- **模型自我纠正** — "Ice cream" 会在模型修正后自动变为 "I scream"
- **剪切板降级** — 当焦点不在文本框时，转写结果自动复制到剪切板并弹出系统通知
- **上下文感知** — 自动读取光标前文本发送给模型，提升专业术语和代码的识别准确率
- **菜单栏应用** — 常驻菜单栏，不显示 Dock 图标
- **多语言支持** — 英语、中文、日语、韩语、西班牙语、法语、德语

## 系统要求

- macOS 13+
- Rust 工具链（最新稳定版）
- Node.js 18+
- Yarn
- ElevenLabs API Key（[前往获取](https://elevenlabs.io)）

## 安装与运行

```bash
# 安装前端依赖
yarn install

# 开发模式运行
yarn tauri dev

# 构建生产版本
yarn tauri build
```

## 首次启动

首次启动时，macOS 会提示授予两项权限：

1. **辅助功能** — 用于检测当前焦点文本框和模拟按键输入
   - 系统设置 → 隐私与安全性 → 辅助功能 → 开启 VoxFlow
2. **麦克风** — 首次录音时由系统自动弹窗请求

## 使用方法

### 基本操作

1. 点击菜单栏的 VoxFlow 图标 → 选择 **偏好设置...**
2. 输入你的 ElevenLabs API Key
3. 点击设置窗口外部关闭窗口
4. 切换到任意带文本框的应用（备忘录、VS Code、Slack、Safari 等）
5. **按住** `Cmd + Shift + \` 并开始说话
6. **松开** 快捷键 — 最终文本提交完成

### 剪切板降级

如果当前焦点不在文本框上（例如在桌面），VoxFlow 仍然会正常转写语音，并将结果复制到剪切板，同时弹出系统通知确认。

### 设置

- **偏好设置...** — 左键点击菜单栏图标，或右键菜单中选择
- **语言** — 选择转写语言
- **状态** — 当前状态显示在设置窗口和菜单栏中

## 技术栈

- **桌面框架：** [Tauri v2](https://tauri.app/)（Rust + WebView）
- **音频采集：** [cpal](https://github.com/RustAudio/cpal) — 16kHz 单声道 PCM
- **语音转写：** [ElevenLabs Scribe v2](https://elevenlabs.io/docs/speech-to-text) WebSocket API
- **焦点检测：** macOS Accessibility API（`AXUIElement`）
- **文本注入：** macOS CoreGraphics（`CGEvent`）按键模拟
- **前端：** React 18 + TypeScript + Tailwind CSS + shadcn/ui + Zustand

## 开发

```bash
# 仅前端（无 Rust 后端）
yarn dev

# 完整应用（热重载）
yarn tauri dev

# 构建生产包
yarn tauri build
```

推荐使用 [VS Code](https://code.visualstudio.com/) + [Tauri 扩展](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)。

## 项目结构

```
vox-flow/
├── src/                          # TypeScript 前端
│   ├── App.tsx                   # 设置界面 + 快捷键监听
│   ├── scribe-client.ts          # ElevenLabs WebSocket 客户端
│   ├── diff-engine.ts            # LCP 文本差异算法
│   ├── audio-capture.ts          # 音频采集 IPC 封装
│   ├── focus-check.ts            # 焦点检测 IPC 封装
│   ├── clipboard-fallback.ts     # 剪切板 + 通知降级
│   ├── types.ts                  # 共享 TypeScript 类型
│   ├── stores/
│   │   ├── config-store.ts       # API Key 和语言配置
│   │   └── transcription-store.ts # 转写状态机
│   └── components/
│       ├── TranscriptionIndicator.tsx
│       └── ui/                   # shadcn/ui 组件
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── audio.rs              # 麦克风采集 + 重采样
│   │   ├── focus.rs              # AXUIElement 焦点检测
│   │   ├── keys.rs               # CGEvent 按键模拟
│   │   ├── tray.rs               # 菜单栏图标 + 状态更新
│   │   ├── shortcut.rs           # 全局快捷键注册
│   │   ├── permissions.rs        # macOS 权限检查
│   │   ├── commands.rs           # Tauri IPC 命令
│   │   ├── state.rs              # 应用状态管理
│   │   └── error.rs              # 错误类型
│   └── capabilities/
│       └── default.json          # Tauri 权限配置
└── specs/                        # 设计文档
```

## 许可证

Private

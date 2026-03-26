# Institution

## 项目初始化

```
cargo generate tyrchen/rust-tauri-template

vox-flow(voice flow)
```

## 探索

帮我分析 ElevenLabs Scribe v2 实时语音转写 API 的 TypeScript 示例。

并帮我设计一个类似 Wispr Flow 的桌面应用，要求如下：

- 使用 Tauri v2 开发
- 应用启动后常驻 system tray（macOS menu bar）
- 支持全局快捷键 Cmd+Shift+\ 来开启/停止转写

功能要求：

- 开始转写后：
  - 采集麦克风音频并流式发送到 ElevenLabs Scribe v2 API
  - 实时返回的文本插入到当前 active application 的 caret position

- 如果当前应用不支持文本输入：
  - 在停止转写时，将完整文本复制到剪切板，供用户手动粘贴

请同时给出：

- 系统架构设计
- 关键技术难点（如全局快捷键、跨应用文本插入、音频流处理）
- macOS 平台的实现建议（库/方案）

重点关注：

- 低延迟实时转写（low latency streaming）
- partial transcript vs final transcript 处理
- 跨应用插入文本的可靠性
- 剪切板 fallback 机制

## 根据探索文档构建设计文档

@specs/0001-spec.md 这是vox-flow(voice flow)语音实时转文本的项目探索文档，仔细阅读文档内容，如果有模糊的地方，进行系统 web search 以确保信息的准确性，尤其是使用最新版本的 dependencies。根据你了解的知识，构建一个详细的设计文档，放在 ./specs/0002-design.md 文件中，输出为中文，使用 mermaid chart 绘制架构、设计、组件、流程等图表并详细说明。

## 根据设计文档生成实现计划

根据设计文档 @specs/0002-design.md 生成 implementation plan，文档保存在 ./specs/0003-implementation-plan.md 中

## 一些问题

1.mac设备输入的频率是 48k 赫兹，而elevenlabs要求是16k赫兹的数据
2.录制的内容是环绕声的，而elevenlabs要求是单声道
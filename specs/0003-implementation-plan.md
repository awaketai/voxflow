# VoxFlow 实现计划

> **基于：** [0002-design.md](./0002-design.md)
> **日期：** 2026-03-27
> **状态：** Draft

---

## 目录

1. [前置准备：项目重命名与清理](#1-前置准备项目重命名与清理)
2. [Phase 1：基础骨架 — 菜单栏常驻 + 全局快捷键 + 权限](#phase-1基础骨架--菜单栏常驻--全局快捷键--权限)
3. [Phase 2：音频管道 — 采集 → 编码 → IPC](#phase-2音频管道--采集--编码--ipc)
4. [Phase 3：转写集成 — ElevenLabs WebSocket + 状态机](#phase-3转写集成--elevenlabs-websocket--状态机)
5. [Phase 4：文本注入 — 焦点探测 + 按键模拟 + 差异算法](#phase-4文本注入--焦点探测--按键模拟--差异算法)
6. [Phase 5：降级与打磨 — 剪切板降级 + 通知 + 上下文注入](#phase-5降级与打磨--剪切板降级--通知--上下文注入)
7. [验收标准](#7-验收标准)

---

## 1. 前置准备：项目重命名与清理

当前项目从模板生成，存在大量 `prompt-vault` / `example` 命名残留。在进入 Phase 1 之前必须完成清理。

### 1.1 重命名清单

| 文件 | 当前值 | 目标值 |
|---|---|---|
| `package.json` → `name` | `prompt-vault` | `vox-flow` |
| `src-tauri/tauri.conf.json` → `productName` | `prompt-vault` | `VoxFlow` |
| `src-tauri/tauri.conf.json` → `identifier` | `prompt-vault` | `com.voxflow.app` |
| `src-tauri/tauri.conf.json` → `windows[0].title` | `prompt-vault` | `VoxFlow` |
| `src-tauri/Cargo.toml` → `package.name` | `example` | `vox-flow` |
| `src-tauri/Cargo.toml` → `package.description` | `An example Tauri app` | `Real-time voice-to-text macOS app` |
| `src-tauri/Cargo.toml` → `[lib].name` | `example_lib` | `vox_flow_lib` |
| `src-tauri/src/main.rs` | `example_lib::run()` | `vox_flow_lib::run()` |
| `src-tauri/src/lib.rs` → `APP_PATH` | `example-app` | `vox-flow` |

### 1.2 删除模板残留

- 删除 `src-tauri/src/commands.rs` 中的 `greet()` 函数（整个文件待重写）
- 清理 `src/App.tsx` 中的 Hello World 内容

### 1.3 macOS 配置文件

- 确认 `src-tauri/Info.plist` 存在且包含 `LSUIElement = true`（隐藏 Dock 图标）
- 创建 `src-tauri/VoxFlow.entitlements`，声明 `com.apple.security.device.audio-input`

---

## Phase 1：基础骨架 — 菜单栏常驻 + 全局快捷键 + 权限

> **目标：** 应用启动后常驻菜单栏，无 Dock 图标，支持全局快捷键按下/松开检测，权限引导流程完整。

### 1.1 Rust 依赖安装

在 `Cargo.toml` (workspace) 中添加：

```toml
[workspace.dependencies]
# 新增
cpal = "0.15"
ringbuf = "0.4"
base64 = "0.22"
arc-swap = "1"
```

在 `src-tauri/Cargo.toml` 中添加：

```toml
[dependencies]
# 新增 Tauri 插件
tauri-plugin-global-shortcut = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-notification = "2"

# 新增 macOS 系统库
cpal = { workspace = true }
ringbuf = { workspace = true }
base64 = { workspace = true }
core-graphics = "0.25"
accessibility = "0.1"
accessibility-sys = "0.1"
core-foundation = "0.10"
cocoa = "0.26"
```

> **注意：** `accessibility` crate 的版本和可用性需在实际编码时验证。备选方案是直接使用 `accessibility-sys` FFI 绑定。

### 1.2 菜单栏模块 (`tray.rs`)

**实现内容：**

- `TrayIconBuilder` 初始化，使用 Template 图标（`iconAsTemplate: true`）
- 右键菜单：状态显示（就绪/录音中）、分隔线、偏好设置、退出
- 左键点击：打开设置窗口（无边框透明标题栏）
- 在 `lib.rs` 的 `setup` 闭包中初始化 tray

**关键 API：**
```rust
use tauri::tray::TrayIconBuilder;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
```

**验证点：**
- [ ] `cargo tauri dev` 启动后菜单栏显示 VoxFlow 图标
- [ ] 无 Dock 图标
- [ ] 右键弹出菜单
- [ ] 左键打开设置窗口

### 1.3 全局快捷键模块 (`shortcut.rs`)

**实现内容：**

- 注册 `Cmd+Shift+\`，监听 `Pressed` 和 `Released` 两种状态
- 通过 `app_handle.emit()` 向前端发送 `shortcut-pressed` / `shortcut-released` 事件
- 插件注册：`tauri_plugin_global_shortcut::Builder::new().build()`

**关键代码结构：**
```rust
pub fn register(app: &tauri::App) -> anyhow::Result<()> {
    let shortcut = Shortcut::new(
        Some(Modifiers::SUPER | Modifiers::SHIFT),
        Code::Backslash,
    );
    app.global_shortcut().on_shortcuts(
        ["Command+Shift+Backslash"],
        |app_handle, _shortcut, event| {
            match event.state() {
                ShortcutState::Pressed => { app_handle.emit("shortcut-pressed", ()).ok(); }
                ShortcutState::Released => { app_handle.emit("shortcut-released", ()).ok(); }
            }
        }
    )?;
    Ok(())
}
```

**验证点：**
- [ ] 按下 `Cmd+Shift+\` 时 Rust 日志输出 `shortcut-pressed`
- [ ] 松开时输出 `shortcut-released`
- [ ] 在任意第三方应用中均可触发

### 1.4 权限管理模块 (`permissions.rs`)

**实现内容：**

- 检查 Accessibility 权限（`AXIsProcessTrusted`）
- 若未授权，调用 `AXIsProcessTrustedWithOptions` 引导用户到系统设置
- 检查麦克风权限（通过 `AVCaptureDevice` 或 cpal 首次使用时的系统弹窗）
- 启动时在 `setup` 闭包中执行权限检查

**Tauri Capabilities 更新：**

`src-tauri/capabilities/main-capability.json`：
```json
{
  "identifier": "main-capability",
  "windows": ["main"],
  "permissions": [
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text",
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "notification:allow-notify"
  ]
}
```

**验证点：**
- [ ] 首次启动时提示 Accessibility 权限
- [ ] 授权后不再提示
- [ ] 麦克风权限在首次录音时由系统弹窗请求

### 1.5 设置窗口 UI (TypeScript)

**实现内容：**

- 修改 `tauri.conf.json` 中的窗口配置为无边框透明标题栏
- 使用 React + shadcn/ui + Tailwind CSS 构建设置界面
- 设置界面包含：API Key 输入框、快捷键显示、语言选择（下拉框）
- API Key 使用 `tauri-plugin-store` 持久化存储

**`tauri.conf.json` 窗口配置更新：**
```json
{
  "app": {
    "windows": [
      {
        "title": "VoxFlow Settings",
        "width": 400,
        "height": 500,
        "decorations": false,
        "transparent": true,
        "resizable": false,
        "visible": false
      }
    ]
  }
}
```

**验证点：**
- [ ] 设置窗口通过菜单栏左键打开/关闭
- [ ] API Key 可输入并持久化
- [ ] 窗口外观为无边框自定义样式

### 1.6 Phase 1 文件变更总结

| 文件 | 操作 |
|---|---|
| `Cargo.toml` (workspace) | 新增依赖 |
| `src-tauri/Cargo.toml` | 新增依赖 |
| `src-tauri/src/lib.rs` | 重写 setup，集成 tray/shortcut/permissions |
| `src-tauri/src/tray.rs` | **新建** |
| `src-tauri/src/shortcut.rs` | **新建** |
| `src-tauri/src/permissions.rs` | **新建** |
| `src-tauri/src/state.rs` | 扩展 AppState |
| `src-tauri/src/commands.rs` | 重写，添加配置相关命令 |
| `src-tauri/capabilities/main-capability.json` | **新建** |
| `src-tauri/Info.plist` | 确认 LSUIElement |
| `src-tauri/VoxFlow.entitlements` | **新建** |
| `src-tauri/tauri.conf.json` | 更新窗口配置 |
| `src/components/Settings.tsx` | **新建** |
| `src/stores/config-store.ts` | **新建** |
| `package.json` | 新增 Tauri 插件依赖 |

---

## Phase 2：音频管道 — 采集 → 编码 → IPC

> **目标：** 从麦克风采集 16kHz Mono S16LE PCM 音频，通过 RingBuffer 传递，Base64 编码后经 Tauri Channel 流式发送到 TypeScript 层。

### 2.1 音频采集模块 (`audio.rs`)

**实现内容：**

- 使用 cpal 获取默认输入设备
- 配置：`SampleRate(16000)`、`channels: 1`、`BufferSize::Fixed(1024)`
- cpal 回调线程将 i16 样本写入 `HeapRb::<i16>` (容量 8192)
- 处理间隔 100ms 的 Tokio 定时任务，从 RingBuffer 读取数据
- Base64 编码（Rust 端，使用 `base64::engine::general_purpose::STANDARD`）
- 通过 Tauri Channel 发送 `AudioChunk { base64: String, duration_ms: u32 }`

**关键数据结构：**
```rust
#[derive(Clone, Serialize)]
pub struct AudioChunk {
    pub base64: String,
    pub duration_ms: u32,
}

pub struct AudioCapture {
    _stream: cpal::Stream,
    producer: ringbuf::HeapRb<i16>,
}
```

**采样率处理策略：**

macOS 设备通常为 48kHz，cpal 请求 16kHz 时依赖 OS 软件重采样。如果遇到延迟问题：
1. 在 cpal 回调中获取设备原生采样率
2. 实现简单的降采样滤波器（48kHz → 16kHz：每 3 个样本取 1 个）
3. 立体声 → 单声道：取左声道或双声道平均

**验证点：**
- [ ] `cargo tauri dev` 启动后 `start_audio_capture` 命令不报错
- [ ] TypeScript 端通过 Channel 收到 base64 编码的音频数据
- [ ] 控制台日志显示每次 chunk 的大小约 3200 bytes (1600 samples * 2 bytes)
- [ ] `stop_audio_capture` 命令正确停止采集

### 2.2 Tauri Commands 扩展 (`commands.rs`)

新增命令：

```rust
#[command]
pub async fn start_audio_capture(
    app: tauri::AppHandle,
) -> Result<(), String> { ... }

#[command]
pub async fn stop_audio_capture(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> { ... }
```

`start_audio_capture` 需要返回 Channel 给前端用于流式接收：
```rust
use tauri::ipc::Channel;

#[command]
pub async fn start_audio_capture(
    app: tauri::AppHandle,
    on_audio_chunk: Channel<AudioChunk>,
) -> Result<(), String> { ... }
```

### 2.3 TypeScript 音频接收测试

**实现内容：**

- 在 `main.tsx` 中监听 `shortcut-pressed` / `shortcut-released` 事件
- 按下时调用 `invoke("start_audio_capture", { onAudioChunk: ... })`
- 收到音频 chunk 后在控制台输出长度验证
- 松开时调用 `invoke("stop_audio_capture")`

**验证点：**
- [ ] 按住快捷键时控制台持续输出音频 chunk 日志
- [ ] 松开后日志停止
- [ ] 重新按住可以再次采集

### 2.4 Phase 2 文件变更总结

| 文件 | 操作 |
|---|---|
| `src-tauri/src/audio.rs` | **新建** |
| `src-tauri/src/lib.rs` | 注册 audio 模块 |
| `src-tauri/src/commands.rs` | 新增 start/stop_audio_capture 命令 |
| `src-tauri/src/state.rs` | 新增 AudioCapture 持有 |
| `src/main.tsx` | 添加快捷键事件监听和音频采集测试代码 |

---

## Phase 3：转写集成 — ElevenLabs WebSocket + 状态机

> **目标：** 按住快捷键时建立 WebSocket 连接，流式发送音频，接收实时转写结果，构建完整的转写状态机。

### 3.1 ElevenLabs WebSocket 客户端 (`scribe-client.ts`)

**实现内容：**

- WebSocket 连接管理（连接、重连、断开）
- URL 构建：`wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=manual`
- 认证：通过 `xi-api-key` header 传递 API Key（开发阶段直接使用）
- 发送音频消息格式：
  ```json
  {
    "message_type": "input_audio_chunk",
    "audio_base_64": "<base64>",
    "commit": false,
    "sample_rate": 16000
  }
  ```
- 手动提交：发送 `{ "message_type": "input_audio_chunk", "audio_base_64": "", "commit": true }`
- 事件解析：`session_started`、`partial_transcript`、`committed_transcript`
- 错误事件解析（多种细分类型）：`scribe_error`、`scribe_auth_error`、`scribe_quota_exceeded_error`、`scribe_throttled_error`、`scribe_rate_limited_error`、`scribe_queue_overflow_error`、`scribe_resource_exhausted_error`、`scribe_session_time_limit_exceeded_error`、`scribe_input_error`、`scribe_chunk_size_exceeded_error`、`scribe_insufficient_audio_activity_error`、`scribe_transcriber_error`

**API 接口设计：**
```typescript
interface ScribeClientCallbacks {
  onSessionStarted: (sessionId: string) => void;
  onPartialTranscript: (text: string) => void;
  onCommittedTranscript: (text: string) => void;
  onError: (error: ScribeError) => void;
  onDisconnected: () => void;
}

type ScribeErrorType =
  | "scribe_error"
  | "scribe_auth_error"
  | "scribe_quota_exceeded_error"
  | "scribe_throttled_error"
  | "scribe_rate_limited_error"
  | "scribe_queue_overflow_error"
  | "scribe_resource_exhausted_error"
  | "scribe_session_time_limit_exceeded_error"
  | "scribe_input_error"
  | "scribe_chunk_size_exceeded_error"
  | "scribe_insufficient_audio_activity_error"
  | "scribe_transcriber_error";

interface ScribeError {
  message_type: ScribeErrorType;
  message?: string;
}

class ScribeClient {
  connect(apiKey: string, callbacks: ScribeClientCallbacks): void;
  sendAudio(base64Chunk: string): void;
  commit(): void;
  disconnect(): void;
  isConnected(): boolean;
}
```

**验证点：**
- [ ] 使用有效 API Key 成功建立 WebSocket 连接
- [ ] 收到 `session_started` 事件
- [ ] 发送音频后收到 `partial_transcript`
- [ ] 调用 `commit()` 后收到 `committed_transcript`
- [ ] API Key 无效时收到 `scribe_auth_error` 事件
- [ ] 配额超限时收到 `scribe_quota_exceeded_error` 事件

### 3.2 转写状态机 (`state.ts`)

**实现内容：**

使用 Zustand store 管理状态：

```typescript
type TranscriptionState =
  | "idle"
  | "initializing"
  | "waiting_session"
  | "recording"
  | "finalizing";
```

**状态转换逻辑：**

| 当前状态 | 触发事件 | 目标状态 | 动作 |
|---|---|---|---|
| idle | shortcut-pressed | initializing | 检查焦点、读取 API Key |
| initializing | WS 连接开始 | waiting_session | 建立 WebSocket |
| waiting_session | session_started | recording | 启动音频采集 |
| waiting_session | 连接失败/超时 | idle | 通知用户 |
| recording | partial_transcript | recording (保持) | 计算差异、注入文本 |
| recording | shortcut-released | finalizing | 停止采集、发送 commit |
| finalizing | committed_transcript | idle | 最终文本同步、关闭 WS |

**验证点：**
- [ ] 状态转换符合上述表
- [ ] 每个状态转换在 UI 上有对应指示（如录音中显示红色波形图标）
- [ ] 异常情况正确回到 idle

### 3.3 差异算法模块 (`diff-engine.ts`)

**实现内容：**

```typescript
interface DiffResult {
  backspaces: number;
  newText: string;
}

function computeDiff(currentText: string, newText: string): DiffResult {
  let lcpLength = 0;
  const minLen = Math.min(currentText.length, newText.length);
  while (lcpLength < minLen && currentText[lcpLength] === newText[lcpLength]) {
    lcpLength++;
  }
  return {
    backspaces: currentText.length - lcpLength,
    newText: newText.slice(lcpLength),
  };
}
```

**优化：**
- 50ms 节流（throttle）`partial_transcript` 事件
- 最小操作剪枝：`backspaces === 0 && newText === ""` 时跳过
- UTF-8 安全：使用 `Array.from()` 按字符而非字节迭代

**验证点：**
- [ ] 单元测试：`computeDiff("Ice cream", "I scream every")` → `{ backspaces: 8, newText: " scream every" }`
- [ ] 单元测试：`computeDiff("I", "Ice cream")` → `{ backspaces: 0, newText: "ce cream" }`
- [ ] 单元测试：`computeDiff("hello", "hello")` → `{ backspaces: 0, newText: "" }`
- [ ] 中文/Emoji 字符正确处理

### 3.4 Phase 3 端到端集成测试

**验证点：**
- [ ] 按住快捷键 → WebSocket 连接 → 音频流传输 → 收到 partial_transcript
- [ ] 松开快捷键 → commit → 收到 committed_transcript → 回到 idle
- [ ] 控制台输出每次 partial_transcript 的差异计算结果
- [ ] 连续多次按住/松开不出现状态泄漏

### 3.5 Phase 3 文件变更总结

| 文件 | 操作 |
|---|---|
| `src/scribe-client.ts` | **新建** |
| `src/diff-engine.ts` | **新建** |
| `src/stores/transcription-store.ts` | **新建** |
| `src/types.ts` | **新建** |
| `src/main.tsx` | 集成状态机和 ScribeClient |
| `src/components/TranscriptionIndicator.tsx` | **新建**（录音状态 UI） |

---

## Phase 4：文本注入 — 焦点探测 + 按键模拟 + 差异算法

> **目标：** 转写文本通过 CGEvent 按键模拟实时注入到当前活跃应用的文本输入区域。

### 4.1 焦点探测模块 (`focus.rs`)

**实现内容：**

- 使用 `AXUIElement::system_wide()` 获取系统级 AX 对象
- 查询 `kAXFocusedUIElementAttribute` 获取焦点元素
- 查询 `kAXRoleAttribute` 判断角色
- 可编辑角色白名单：`AXTextField`、`AXTextArea`、`AXComboBox`、`AXSearchField`、`AXWebArea`
- 调用 `AXUIElementIsAttributeSettable(kAXValueAttribute)` 进一步验证
- 读取 `kAXValueAttribute` 获取 `previous_text`（最后 50 字符）

**数据结构：**
```rust
#[derive(Clone, Serialize)]
pub enum FocusResult {
    Editable { previous_text: String },
    NotEditable,
    DetectionFailed(String),
}
```

**Tauri Command：**
```rust
#[command]
pub async fn check_focus() -> Result<FocusResult, String> { ... }
```

**验证点：**
- [ ] 在 Notes.app 的文本区域返回 `Editable`
- [ ] 在桌面/Finder 返回 `NotEditable`
- [ ] 在 VS Code 返回 `Editable`（AXWebArea 妥协放行）
- [ ] 在 Safari 地址栏返回 `Editable`（AXTextField）
- [ ] `previous_text` 正确返回光标前文本

### 4.2 按键模拟模块 (`keys.rs`)

**实现内容：**

- 使用 `core-graphics` crate 的 `CGEvent` API
- 退格键：`KeyCode(0x33)`，通过 `CGEvent::new_keyboard_event` 创建
- 文本输入：使用 `CGEventKeyboardSetUnicodeString`，每次最多 20 个 Unicode 字符
- CGEventTapLocation：`HID`（系统级注入）
- 退格间隔：20μs，字符输入间隔：50μs
- CGEventSource：`HIDEventState`

**Tauri Command：**
```rust
#[derive(Deserialize)]
pub struct InjectTextCommand {
    pub backspaces: u32,
    pub text: String,
}

#[command]
pub async fn inject_text(
    command: InjectTextCommand,
) -> Result<(), String> { ... }
```

**关键实现细节：**
```rust
use core_graphics::event::{CGEvent, CGEventTapLocation, KeyCode, CGEventSource};

fn execute_keystrokes(backspaces: u32, text: &str) -> Result<()> {
    let source = CGEventSource::new(CGEventSourceState::HIDEventState)
        .ok_or("Failed to create event source")?;

    // 退格阶段
    for _ in 0..backspaces {
        let key_down = CGEvent::new_keyboard_event(source.clone(), KeyCode(0x33), true);
        let key_up = CGEvent::new_keyboard_event(source.clone(), KeyCode(0x33), false);
        key_down.post(CGEventTapLocation::HID);
        key_up.post(CGEventTapLocation::HID);
        std::thread::sleep(std::time::Duration::from_micros(20));
    }

    // 文本输入阶段（每 chunk 最多 20 字符）
    let chars: Vec<char> = text.chars().collect();
    for chunk in chars.chunks(20) {
        let chunk_str: String = chunk.iter().collect();
        let key_down = CGEvent::new_keyboard_event(source.clone(), KeyCode(0), true);
        key_down.set_string(&chunk_str);
        let key_up = CGEvent::new_keyboard_event(source.clone(), KeyCode(0), false);
        key_up.set_string(&chunk_str);
        key_down.post(CGEventTapLocation::HID);
        key_up.post(CGEventTapLocation::HID);
        std::thread::sleep(std::time::Duration::from_micros(50));
    }

    Ok(())
}
```

> **注意：** `core-graphics` crate 的具体 API 需在实际编码时参考最新文档。`set_string` 方法名和 `KeyCode` 构造可能因版本而异。

**验证点：**
- [ ] 在 Notes.app 中正确输入文本
- [ ] 退格键正确删除已有字符
- [ ] 在 VS Code 中正确输入（含代码补全触发）
- [ ] 在 Slack 中正确输入
- [ ] 中文/特殊字符正确输入
- [ ] 快速连续输入不丢字

### 4.3 端到端集成

**实现内容：**

将 Phase 3 的差异算法输出与 Phase 4 的按键模拟连接：

```typescript
// 在 recording 状态中
scribeClient.onPartialTranscript((text) => {
  const diff = computeDiff(currentOutputText, text);
  if (diff.backspaces > 0 || diff.newText.length > 0) {
    currentOutputText = text;
    invoke("inject_text", { backspaces: diff.backspaces, text: diff.newText });
  }
});
```

**完整流程验证：**
- [ ] 按住快捷键 → 说话 → 松开 → 文本出现在当前输入框
- [ ] 模型纠错时（如 "Ice cream" → "I scream every"）文本正确更新
- [ ] 在 Notes、VS Code、Slack、Safari 中均可正常工作
- [ ] 端到端延迟感知 < 1 秒

### 4.4 Phase 4 文件变更总结

| 文件 | 操作 |
|---|---|
| `src-tauri/src/focus.rs` | **新建** |
| `src-tauri/src/keys.rs` | **新建** |
| `src-tauri/src/commands.rs` | 新增 check_focus、inject_text 命令 |
| `src-tauri/src/lib.rs` | 注册 focus、keys 模块 |
| `src/main.tsx` | 集成差异算法和文本注入 |
| `src/focus-check.ts` | **新建**（焦点检测 IPC 封装） |

---

## Phase 5：降级与打磨 — 剪切板降级 + 通知 + 上下文注入

> **目标：** 完善降级机制，实现 previous_text 上下文注入，添加系统通知，优化性能。

### 5.1 剪切板降级 (`clipboard-fallback.ts`)

**实现内容：**

- 当 `FocusResult::NotEditable` 或 `FocusResult::DetectionFailed` 时，标记为降级模式
- 降级模式下仍然正常录音和转写
- 转写结束后将 `committed_transcript` 写入系统剪切板
- 发送系统通知："转写完成：文本已复制到剪切板"

**TypeScript 实现：**
```typescript
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

async function clipboardFallback(text: string) {
  await writeText(text);
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }
  if (granted) {
    sendNotification({ title: "VoxFlow", body: "转写完成：文本已复制到剪切板" });
  }
}
```

**验证点：**
- [ ] 在桌面（无焦点输入框）按住说话后文本复制到剪切板
- [ ] 系统通知正确弹出
- [ ] `Cmd+V` 可粘贴完整转写文本

### 5.2 previous_text 上下文注入

**实现内容：**

- 在 `shortcut-pressed` 事件处理时调用 `check_focus`
- 若返回 `Editable { previous_text }`，将 `previous_text` 附加到首个音频块的 `previous_text` 字段
- `previous_text` 截断为 50 字符

**修改 `scribe-client.ts`：**
```typescript
sendFirstAudio(base64Chunk: string, previousText?: string) {
  const message: any = {
    message_type: "input_audio_chunk",
    audio_base_64: base64Chunk,
    commit: false,
    sample_rate: 16000,
  };
  if (previousText) {
    message.previous_text = previousText.slice(0, 50);
  }
  this.ws.send(JSON.stringify(message));
}
```

**验证点：**
- [ ] 在已有文本的输入框中触发转写，previous_text 正确传递
- [ ] 专业术语/代码上下文的识别准确率有可感知的提升

### 5.3 错误处理矩阵实现

| 错误场景 | 对应事件 | 处理策略 |
|---|---|---|
| WebSocket 连接失败 | — | 回到 idle，通知用户 |
| WebSocket 连接中断 | — | 尝试重连 1 次，失败则降级 |
| API Key 无效 | `scribe_auth_error` | 通知用户，打开设置窗口 |
| 配额超限 | `scribe_quota_exceeded_error` | 通知用户，回到 idle |
| 限流 | `scribe_rate_limited_error` / `scribe_throttled_error` | 通知用户，短暂等待后重试 |
| 音频块过大 | `scribe_chunk_size_exceeded_error` | 减小发送间隔，记录日志 |
| 音频活动不足 | `scribe_insufficient_audio_activity_error` | 提示用户靠近麦克风或调高音量 |
| 会话超时 | `scribe_session_time_limit_exceeded_error` | 自动重连，重新开始 |
| 通用转写错误 | `scribe_transcriber_error` | 降级到剪切板模式 |
| 音频设备不可用 | — | 通知用户，回到 idle |
| 按键注入超时 (> 5s) | — | 降级到剪切板模式 |
| API Key 未配置 | — | 打开设置窗口提示配置 |

### 5.4 性能优化

- 音频处理 Tokio 任务使用 `tokio::task::spawn_blocking` 避免阻塞异步运行时
- DiffEngine 节流间隔调优（初始 50ms，根据实际表现调整）
- 设置窗口惰性加载（仅在首次打开时初始化 Webview 内容）
- 音频采集停止时立即释放 cpal Stream

### 5.5 Phase 5 文件变更总结

| 文件 | 操作 |
|---|---|
| `src/clipboard-fallback.ts` | **新建** |
| `src/scribe-client.ts` | 添加 previous_text 支持 |
| `src/stores/transcription-store.ts` | 添加降级模式状态 |
| `src/main.tsx` | 集成降级流程和错误处理 |

---

## 7. 验收标准

### 核心功能验收

| # | 验收项 | 预期结果 |
|---|---|---|
| 1 | 菜单栏常驻 | 启动后仅显示菜单栏图标，无 Dock 图标 |
| 2 | 全局快捷键 | `Cmd+Shift+\` 在任意应用中可触发 |
| 3 | 按住说话 | 按住开始录音，松开停止 |
| 4 | 实时转写 | 说话时文本实时出现在当前输入框 |
| 5 | 模型纠错 | "Ice cream" → "I scream every" 文本正确更新 |
| 6 | 最终提交 | 松开快捷键后文本最终确定 |
| 7 | 剪切板降级 | 不可编辑区域时自动复制到剪切板 |
| 8 | 系统通知 | 降级时弹出通知 |
| 9 | 权限引导 | 首次启动正确引导 Accessibility 和麦克风权限 |
| 10 | 设置界面 | API Key 配置、语言选择可用且持久化 |

### 性能验收

| # | 指标 | 目标值 |
|---|---|---|
| 1 | 端到端延迟 | < 500ms (首字符到首字符) |
| 2 | 内存占用 | < 50MB |
| 3 | CPU 空闲 | < 1% |
| 4 | CPU 录音中 | < 5% |
| 5 | 启动时间 | < 2s |

### 兼容性验收

| # | 目标应用 | 测试项 |
|---|---|---|
| 1 | Apple Notes | 文本输入 + 退格修正 |
| 2 | VS Code | 代码输入 + 自动补全触发 |
| 3 | Slack | 消息输入 |
| 4 | Safari | 网页表单输入 |
| 5 | Terminal (iTerm) | 命令行输入 |
| 6 | WeChat | 消息输入 |

---

## 附录：技术风险与缓解

| 风险 | 影响 | 缓解策略 |
|---|---|---|
| macOS 48kHz → 16kHz 重采样引入延迟 | 音频延迟增加 | 优先使用 cpal 内置重采样；若不足则在 Rust 端手动降采样 |
| `accessibility` crate API 不稳定 | 焦点探测模块编译失败 | 降级到直接使用 `accessibility-sys` FFI |
| `core-graphics` 的 `set_string` 行为变化 | 文本注入失败 | 参考 enigo crate 实现作为备选 |
| Chromium/Electron AX 树不规范 | 焦点检测误判 | 对 AXWebArea 默认放行 |
| ElevenLabs API 变更 | WebSocket 协议不兼容 | 封装 API 层，便于快速适配 |

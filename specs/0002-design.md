# VoxFlow 详细设计文档

> **项目代号：** VoxFlow (Voice Flow)
> **版本：** v0.1.0-draft
> **日期：** 2026-03-26
> **基于：** [0001-spec.md](./0001-spec.md)

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构总览](#2-系统架构总览)
3. [技术选型与依赖矩阵](#3-技术选型与依赖矩阵)
4. [模块详细设计](#4-模块详细设计)
   - 4.1 [Rust 核心层 (src-tauri)](#41-rust-核心层-src-tauri)
   - 4.2 [TypeScript 应用层 (src)](#42-typescript-应用层-src)
   - 4.3 [ElevenLabs Scribe v2 集成层](#43-elevenlabs-scribe-v2-集成层)
5. [数据流与 IPC 通信设计](#5-数据流与-ipc-通信设计)
6. [核心算法设计](#6-核心算法设计)
7. [权限与安全设计](#7-权限与安全设计)
8. [项目目录结构](#8-项目目录结构)
9. [关键接口定义](#9-关键接口定义)
10. [降级与容错策略](#10-降级与容错策略)
11. [性能指标与约束](#11-性能指标与约束)
12. [开发里程碑](#12-开发里程碑)

---

## 1. 项目概述

VoxFlow 是一款基于 Tauri v2 + Rust 的高性能 macOS 桌面应用，实现系统级实时语音转文本功能。应用常驻菜单栏，通过全局快捷键 `Cmd+Shift+\` 触发"按住说话"模式，将麦克风音频流实时发送至 ElevenLabs Scribe v2 API，并将转写结果无缝注入当前活跃应用的文本输入焦点处。

### 1.1 核心功能清单

| 功能 | 描述 | 优先级 |
|---|---|---|
| 菜单栏常驻 | 无 Dock 图标，菜单栏图标 + 弹出设置窗口 | P0 |
| 全局快捷键 | `Cmd+Shift+\` 按住说话 / 松开停止 | P0 |
| 音频采集 | Rust cpal 16kHz Mono S16LE PCM 低延迟采集 | P0 |
| WebSocket 转写 | ElevenLabs Scribe v2 Realtime API 集成 | P0 |
| 差异化文本注入 | Backspace Difference Algorithm + CGEvent 模拟按键 | P0 |
| 焦点检测 | macOS Accessibility API 探测可编辑区域 | P0 |
| 剪切板降级 | 注入失败时自动复制到剪切板 + 通知 | P0 |
| 上下文注入 | previous_text 获取光标前文本提升识别精度 | P1 |
| 设置界面 | API Key 管理、快捷键自定义、语言选择 | P1 |
| 转写历史 | 本地存储历史转写记录 | P2 |

---

## 2. 系统架构总览

### 2.1 四层架构模型

```mermaid
graph TB
    subgraph "Target Application (目标应用)"
        APP[第三方应用<br/>VS Code / Slack / Safari / Notes]
    end

    subgraph "macOS System APIs"
        AX[Accessibility API<br/>AXUIElement]
        CG[Core Graphics<br/>CGEvent]
        CA[CoreAudio<br/>麦克风硬件]
        CB[Clipboard<br/>NSPasteboard]
        NT[Notification Center<br/>UNUserNotificationCenter]
    end

    subgraph "Rust Core Layer (Rust 核心层)"
        TRAY[TrayIcon Module<br/>菜单栏管理]
        GS[GlobalShortcut Module<br/>全局快捷键]
        AUDIO[AudioCapture Module<br/>cpal 音频采集]
        RBUF[RingBuffer<br/>无锁环形缓冲区]
        KEYS[KeySimulation Module<br/>CGEvent 按键模拟]
        FOCUS[FocusDetector Module<br/>焦点探测]
        CLIP[Clipboard Module<br/>剪切板读写]
        PERM[PermissionManager<br/>权限检查与引导]
    end

    subgraph "TypeScript App Layer (TypeScript 应用层)"
        STATE[StateManager<br/>应用状态机]
        WS[WebSocketClient<br/>ElevenLabs 连接管理]
        DIFF[DiffEngine<br/>退格差异比对]
        UI[UI Components<br/>设置窗口 / 状态指示]
    end

    subgraph "Cloud (云端)"
        EL[ElevenLabs Scribe v2<br/>Realtime STT API]
    end

    %% 音频数据流
    CA --> AUDIO
    AUDIO --> RBUF
    RBUF -- "base64 IPC Channel" --> WS

    %% 转写数据流
    WS -- "partial_transcript" --> DIFF
    DIFF -- "keystroke commands" --> KEYS
    KEYS --> CG
    CG --> APP

    %% 焦点检测流
    APP --> AX
    AX --> FOCUS
    FOCUS --> STATE

    %% 降级流
    STATE -- "fallback trigger" --> CLIP
    CLIP --> CB
    STATE -- "notify user" --> NT

    %% 快捷键流
    GS -- "shortcut_pressed" --> STATE
    STATE -- "start/stop capture" --> AUDIO
    STATE -- "connect/disconnect ws" --> WS

    %% WebSocket 流
    WS -- "audio_base64 chunks" --> EL
    EL -- "transcript events" --> WS

    %% 菜单栏
    TRAY --> UI

    style APP fill:#e1f5fe
    style EL fill:#fff3e0
    style CA fill:#fce4ec
    style CG fill:#fce4ec
    style AX fill:#fce4ec
```

### 2.2 进程模型

```mermaid
graph LR
    subgraph "Main Process (Rust)"
        subgraph "Audio Thread (实时优先级)"
            AT[cpal 回调线程<br/>写入 RingBuffer]
        end
        subgraph "Processing Task (Tokio async)"
            PT[读取 RingBuffer<br/>Base64 编码<br/>IPC Channel 发送]
        end
        subgraph "Tauri Runtime"
            TR[Tauri 事件循环<br/>快捷键 / 菜单栏 / 命令]
        end
    end

    subgraph "Webview Process (TypeScript)"
        WS[WebSocket 连接<br/>差异算法<br/>UI 渲染]
    end

    AT -- "无锁 SPSC" --> PT
    PT -- "IPC Channel<br/>~2-5ms 延迟" --> WS
    TR -- "IPC Events" --> WS
    WS -- "IPC Commands" --> TR
```

---

## 3. 技术选型与依赖矩阵

### 3.1 Rust 依赖 (src-tauri/Cargo.toml)

| Crate | 版本 | 用途 | 关键说明 |
|---|---|---|---|
| `tauri` | `2.10` | 应用框架 | features: `["tray-icon"]` |
| `tauri-build` | `2.5` | 构建时代码生成 | build-dependencies |
| `tauri-plugin-global-shortcut` | `2.2` | 全局快捷键 | `Shortcut::new(Some(Modifiers::SUPER \| Modifiers::SHIFT), Code::Backslash)` |
| `tauri-plugin-clipboard-manager` | `2.3` | 剪切板操作 | 降级时写入转写文本 |
| `tauri-plugin-notification` | `2.3` | 系统通知 | 降级提示用户粘贴 |
| `tauri-plugin-macos-permissions` | `2.3` | macOS 权限管理 | Accessibility + Microphone 权限检查 |
| `cpal` | `0.17` | 音频采集 | macOS CoreAudio 绑定，配置 16kHz Mono S16LE |
| `ringbuf` | `0.4` | 无锁环形缓冲区 | `HeapRb::<i16>::new(8192)` SPSC 模式 |
| `base64` | `0.22` | Base64 编码 | `engine::general_purpose::STANDARD.encode()` |
| `core-graphics` | `0.25` | CGEvent 按键模拟 | `CGEvent::new_keyboard_event` + `post(HID)` |
| `accessibility` | `0.2` | macOS AX API 高层封装 | `AXUIElement::system_wide()` |
| `accessibility-sys` | `0.2` | macOS AX API 底层 FFI | `kAXFocusedUIElementAttribute` 等常量 |
| `core-foundation` | `0.10` | CF 类型支持 | `CFString`, `CFDictionary` 等 |
| `cocoa` | `0.26` | NSApplication 控制 | `setActivationPolicy_(Accessory)` 隐藏 Dock |
| `serde` | `1` | 序列化 | features: `["derive"]` |
| `serde_json` | `1` | JSON 处理 | IPC 载荷序列化 |
| `tokio` | `1` | 异步运行时 | features: `["sync", "time"]`，用于音频处理任务 |
| `arcswap` | `1` | 无锁配置共享 | API Key 等低频更新配置 |
| `anyhow` | `1` | 错误处理 | 简化错误传播 |
| `thiserror` | `2` | 自定义错误类型 | 类型安全的错误定义 |
| `log` | `0.4` | 日志门面 | 跨层统一日志 |
| `env_logger` | `0.11` | 日志实现 | 开发环境使用 |

### 3.2 TypeScript 依赖 (package.json)

| Package | 版本 | 用途 |
|---|---|---|
| `@tauri-apps/api` | `2.10` | Tauri 前端 API |
| `@tauri-apps/plugin-global-shortcut` | `2.2` | 快捷键前端接口 |
| `@tauri-apps/plugin-clipboard-manager` | `2.3` | 剪切板前端接口 |
| `@tauri-apps/plugin-notification` | `2.3` | 通知前端接口 |
| `typescript` | `5.x` | TypeScript 编译器 |
| `vite` | `6.x` | 构建工具 |

### 3.3 Tauri Capabilities (permissions)

```json
// src-tauri/capabilities/main-capability.json
{
  "identifier": "main-capability",
  "description": "VoxFlow 核心权限",
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

---

## 4. 模块详细设计

### 4.1 Rust 核心层 (src-tauri)

#### 4.1.1 模块架构

```mermaid
graph TB
    subgraph "src-tauri/src"
        LIB[lib.rs<br/>Tauri Builder / Setup]
        TRAY_MOD[tray.rs<br/>TrayIcon 初始化与菜单]
        SHORTCUT_MOD[shortcut.rs<br/>全局快捷键注册与处理]
        AUDIO_MOD[audio.rs<br/>cpal 音频流 / RingBuffer]
        KEYS_MOD[keys.rs<br/>CGEvent 按键模拟]
        FOCUS_MOD[focus.rs<br/>AX 焦点探测]
        PERM_MOD[permissions.rs<br/>权限检查与引导]
        CMD_MOD[commands.rs<br/>Tauri Commands<br/>IPC 暴露]
        STATE_MOD[state.rs<br/>应用状态<br/>ArcSwap 配置]
        ERR_MOD[error.rs<br/>统一错误类型]
    end

    LIB --> TRAY_MOD
    LIB --> SHORTCUT_MOD
    LIB --> AUDIO_MOD
    LIB --> KEYS_MOD
    LIB --> FOCUS_MOD
    LIB --> PERM_MOD
    LIB --> CMD_MOD
    CMD_MOD --> AUDIO_MOD
    CMD_MOD --> KEYS_MOD
    CMD_MOD --> FOCUS_MOD
    CMD_MOD --> STATE_MOD
    AUDIO_MOD --> RBUF[RingBuffer<br/>ringbuf crate]
    KEYS_MOD --> CG[core-graphics]
    FOCUS_MOD --> AX[accessibility]
    PERM_MOD --> AXPERM[accessibility-sys<br/>AXIsProcessTrustedWithOptions]
    AUDIO_MOD --> CPAL[cpal]
    STATE_MOD --> ARC[ArcSwap]
```

#### 4.1.2 音频采集模块 (audio.rs)

**设计目标：** 以最低延迟从麦克风捕获 16kHz Mono S16LE PCM 音频，通过无锁缓冲区传递给处理任务。

```mermaid
sequenceDiagram
    participant TS as TypeScript 前端
    participant CMD as Tauri Command
    participant PROC as Tokio Processing Task
    participant RB as RingBuffer HeapRb-i16
    participant CB as cpal Audio Callback
    participant MIC as 麦克风硬件

    TS ->> CMD: invoke start_audio_capture
    CMD ->> CB: 构建 cpal StreamConfig 16kHz/1ch/Fixed-1024
    CMD ->> PROC: 启动 Tokio 定时任务 100ms 间隔
    CMD ->> TS: Ok(())

    loop 每 64ms (1024 frames @ 16kHz)
        MIC ->> CB: on_audio_data(buf i16 x1024)
        CB ->> RB: producer.push_slice(data)
    end

    loop 每 100ms
        PROC ->> RB: consumer.pop_slice(buf)
        PROC ->> PROC: base64::encode(pcm_bytes)
        PROC ->> TS: channel.send(AudioChunk base64)
    end
```

**关键设计决策：**

| 决策项 | 选择 | 原因 |
|---|---|---|
| 缓冲区大小 | `Fixed(1024)` | 1024 frames @ 16kHz = 64ms，极低延迟 |
| RingBuffer 容量 | `HeapRb::<i16>::new(8192)` | 约 512ms 缓冲，足够吸收处理延迟 |
| 处理间隔 | 100ms | 平衡延迟与 IPC 开销，对应 ~1600 bytes/chunk |
| 编码位置 | Rust 端 Base64 | 避免 IPC 传输原始二进制，利用 Rust 高性能 base64 |
| IPC 机制 | Tauri Channel | 比 emit 事件更高效的流式数据传输 |

**音频格式约束（来自 ElevenLabs API）：**

| 参数 | 值 | 说明 |
|---|---|---|
| 采样率 | 16000 Hz | `pcm_16000` 格式要求 |
| 位深度 | 16-bit | 有符号整数 (S16LE) |
| 声道数 | 1 (Mono) | 单声道 |
| 字节序 | Little-Endian | PCM 标准小端序 |

> **注意：** macOS 原生设备通常运行在 44100Hz 或 48000Hz。cpal 在请求 16kHz 时会依赖操作系统进行软件重采样。若发现延迟异常，可考虑在 Rust 端手动实现 48kHz→16kHz 的降采样滤波器。

#### 4.1.3 全局快捷键模块 (shortcut.rs)

```mermaid
stateDiagram-v2
    [*] --> Idle: 应用启动 / 注册快捷键

    Idle --> Recording: Cmd+Shift+\ Pressed
    Recording --> Idle: Cmd+Shift+\ Released

    state Recording {
        [*] --> CheckFocus: 快捷键按下
        CheckFocus --> StartCapture: 焦点可编辑
        CheckFocus --> FallbackMode: 焦点不可编辑

        StartCapture --> Streaming: 音频采集中
        Streaming --> Finalize: 快捷键松开

        Finalize --> CommitTranscript: 发送最终提交
        CommitTranscript --> [*]
    }

    state FallbackMode {
        [*] --> StartCaptureFB: 启动音频采集
        StartCaptureFB --> StreamingFB: 流式采集中
        StreamingFB --> FinalizeFB: 快捷键松开
        FinalizeFB --> CopyToClipboard: 复制到剪切板
        CopyToClipboard --> NotifyUser: 发送通知
        NotifyUser --> [*]
    }
```

**Tauri Global Shortcut 注册方式：**

```rust
// 使用 tauri-plugin-global-shortcut v2 API
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Code, Modifiers, Shortcut};

app.global_shortcut().on_shortcuts(
    ["Command+Shift+Backslash"],
    |app_handle, shortcut, event| {
        match event.state() {
            ShortcutState::Pressed => {
                app_handle.emit("shortcut-pressed", ()).ok();
            }
            ShortcutState::Released => {
                app_handle.emit("shortcut-released", ()).ok();
            }
        }
    }
)?;
```

#### 4.1.4 焦点探测模块 (focus.rs)

```mermaid
flowchart TD
    START[开始焦点检测] --> SYS[创建系统级 AXUIElement<br/>AXUIElement::system_wide]
    SYS --> FOCUS[查询 kAXFocusedUIElementAttribute<br/>获取当前焦点元素]
    FOCUS --> HAS_FOCAL{获取焦点元素?}
    HAS_FOCAL -->|否| REJECT[返回 NotEditable]
    HAS_FOCAL -->|是| ROLE[查询 kAXRoleAttribute<br/>获取元素角色]

    ROLE --> CHECK_ROLE{角色类型?}

    CHECK_ROLE -->|AXTextField| CHECK_SETTABLE
    CHECK_ROLE -->|AXTextArea| CHECK_SETTABLE
    CHECK_ROLE -->|AXComboBox| CHECK_SETTABLE
    CHECK_ROLE -->|AXSearchField| CHECK_SETTABLE
    CHECK_ROLE -->|AXWebArea| WEBAREA_STRATEGY
    CHECK_ROLE -->|其他| REJECT

    WEBAREA_STRATEGY[Chromium/Electron 策略] --> CHECK_SETTABLE
    CHECK_SETTABLE[查询 kAXValueAttribute<br/>是否可设置<br/>AXUIElementIsAttributeSettable]
    CHECK_SETTABLE --> SETTABLE{可编辑?}
    SETTABLE -->|是| ACCEPT[返回 Editable<br/>附带 previous_text]
    SETTABLE -->|否| REJECT

    ACCEPT --> GET_PREV[可选：读取 kAXValueAttribute<br/>获取最后 50 字符作为上下文]
    GET_PREV --> DONE[返回结果]
```

**AX API 调用链（Rust FFI）：**

```rust
// 关键 API 调用伪代码
fn detect_focus() -> FocusResult {
    let system = AXUIElement::system_wide();

    // 1. 获取焦点元素
    let focused_attr = AXAttribute::<CFType>::new(
        &CFString::from_static_string(kAXFocusedUIElementAttribute)
    );
    let focused_element = system.attribute(&focused_attr)?;

    // 2. 获取角色
    let role: CFString = focused_element.role()?;

    // 3. 判断是否可编辑
    let is_editable = match role.to_string().as_str() {
        "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField" => true,
        "AXWebArea" => true, // Chromium/Electron 妥协放行
        _ => false,
    };

    // 4. 进一步验证 AXUIElementIsAttributeSettable
    if is_editable {
        let settable = check_attribute_settable(&focused_element, kAXValueAttribute);
        // ...
    }

    // 5. 读取 previous_text（最后 50 字符）
    let value: CFString = focused_element.value()?;
    let previous_text = truncate(&value.to_string(), 50);
}
```

#### 4.1.5 按键模拟模块 (keys.rs)

```mermaid
sequenceDiagram
    participant TS as TypeScript DiffEngine
    participant CMD as Tauri Command
    participant KEYS as KeySimulation
    participant CG as Core Graphics CGEvent
    participant APP as 目标应用

    TS->>CMD: invoke("inject_text", { backspaces: 8, text: " scream every" })
    CMD->>KEYS: execute_keystrokes(8, " scream every")

    rect rgb(255, 240, 240)
        Note over KEYS,APP: 退格阶段 (8 次)
        loop i = 0..8
            KEYS->>CG: CGEvent::new_keyboard_event(DELETE, keydown=true)
            CG->>APP: Backspace 事件
            KEYS->>CG: CGEvent::new_keyboard_event(DELETE, keydown=false)
        end
    end

    rect rgb(240, 255, 240)
        Note over KEYS,APP: 文本输入阶段
        loop 每个字符 chunk (最多 20 字符/次)
            KEYS->>CG: CGEvent::new_keyboard_event + set_string(chunk)
            CG->>APP: KeyDown + Unicode 字符
            KEYS->>CG: CGEvent::new_keyboard_event + set_string(chunk)
            CG->>APP: KeyUp
            Note over KEYS: sleep 50μs
        end
    end
```

**按键模拟关键参数：**

| 参数 | 值 | 说明 |
|---|---|---|
| 退格键 KeyCode | `0x33` (51) | macOS DELETE = Backspace |
| CGEventTapLocation | `HID` | 系统级事件注入 |
| 单次 Unicode 长度上限 | 20 字符 | `CGEventKeyboardSetUnicodeString` 限制 |
| 退格间隔 | 20μs | 防止吞字 |
| 字符输入间隔 | 50μs | 平衡速度与兼容性 |
| CGEventSource | `HIDEventState` | 模拟真实硬件事件 |

#### 4.1.6 菜单栏模块 (tray.rs)

```mermaid
graph TB
    subgraph "macOS Menu Bar"
        ICON[VoxFlow 图标<br/>iconAsTemplate: true]
    end

    subgraph "左键点击"
        ICON --> |show_menu_on_left_click: false| WIN[设置窗口<br/>无边框 / 透明标题栏<br/>TitleBarStyle::Transparent]
        WIN --> SETTINGS[设置 UI<br/>Webview]
    end

    subgraph "右键点击 → 原生菜单"
        ICON --> MENU[NSMenu]
        MENU --> M_STATUS[当前状态: 就绪 / 录音中]
        MENU --> M_SEP1[---]
        MENU --> M_SETTINGS[偏好设置...]
        MENU --> M_HISTORY[转写历史...]
        MENU --> M_SEP2[---]
        MENU --> M_QUIT[退出 VoxFlow]
    end

    subgraph "运行时 Dock 隐藏"
        HIDE[setActivationPolicy<br/>NSApplicationActivationPolicyAccessory]
    end
```

---

### 4.2 TypeScript 应用层 (src)

#### 4.2.1 模块架构

```mermaid
graph TB
    subgraph "src (TypeScript)"
        MAIN[main.ts<br/>应用入口 / Tauri 事件监听]
        STATE[state.ts<br/>TranscriptionState 状态机]
        WSCLIENT[scribe-client.ts<br/>ElevenLabs WebSocket 客户端]
        DIFF[diff-engine.ts<br/>Backspace Difference Algorithm]
        FOCUS_CHECK[focus-check.ts<br/>焦点检测 IPC 调用]
        CLIPBOARD[clipboard-fallback.ts<br/>剪切板降级]
        CONFIG[config.ts<br/>配置管理 / API Key 存储]
        UI["ui/<br/>App.vue<br/>Settings.vue<br/>TrayPopup.vue"]
    end

    MAIN --> STATE
    MAIN --> WSCLIENT
    STATE --> DIFF
    STATE --> FOCUS_CHECK
    STATE --> CLIPBOARD
    WSCLIENT --> STATE
    DIFF --> MAIN
    FOCUS_CHECK --> STATE
    CLIPBOARD --> STATE
    CONFIG --> WSCLIENT
    MAIN --> UI
```

#### 4.2.2 转写状态机 (state.ts)

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Initializing: shortcut_pressed
    Initializing --> WaitingSession: WebSocket 连接中
    WaitingSession --> Recording: session_started 收到
    WaitingSession --> Idle: 连接失败 / 超时
    Recording --> Finalizing: shortcut_released
    Recording --> Finalizing: 连接断开

    state Finalizing {
        [*] --> SendCommit: 发送 commit 指令
        SendCommit --> WaitFinal: 等待 committed_transcript
        WaitFinal --> ApplyDiff: 收到最终结果
        ApplyDiff --> [*]
    }

    Finalizing --> Idle: 完成

    state Recording {
        [*] --> ReceiveAudio
        ReceiveAudio --> SendAudio: 收到 audio_chunk
        SendAudio --> ReceivePartial
        ReceivePartial --> ComputeDiff: 收到 partial_transcript
        ComputeDiff --> InjectKeystrokes: 计算差异
        InjectKeystrokes --> ReceiveAudio
    }

    note right of Idle: 等待用户触发
    note right of Recording: Push-to-Talk<br/>音频流传输中<br/>实时文本注入
    note right of Finalizing: 等待最终结果<br/>最后一次差异同步
```

#### 4.2.3 ElevenLabs WebSocket 客户端 (scribe-client.ts)

```mermaid
sequenceDiagram
    participant APP as TranscriptionState
    participant WS as ScribeClient
    participant RUST as Rust Audio Module
    participant EL as ElevenLabs API

    APP->>WS: connect(config)
    WS->>EL: WebSocket Handshake<br/>wss://api.elevenlabs.io/v1/speech-to-text/realtime<br/>?model_id=scribe_v2_realtime<br/>&audio_format=pcm_16000<br/>&commit_strategy=manual

    EL-->>WS: session_started<br/>{ session_id, config }
    WS-->>APP: onSessionStarted

    loop 音频流传输
        RUST-->>WS: onAudioChunk(base64_data)
        WS->>EL: { message_type: "input_audio_chunk",<br/>  audio_base_64: "...",<br/>  commit: false,<br/>  sample_rate: 16000 }
    end

    loop 实时转写
        EL-->>WS: { message_type: "partial_transcript",<br/>  text: "I scream every" }
        WS-->>APP: onPartialTranscript(text)
    end

    APP->>WS: commit()
    WS->>EL: { message_type: "input_audio_chunk",<br/>  audio_base_64: "",<br/>  commit: true }

    EL-->>WS: { message_type: "committed_transcript",<br/>  text: "I scream every time." }
    WS-->>APP: onCommittedTranscript(text)

    APP->>WS: disconnect()
    WS->>EL: WebSocket Close
```

**WebSocket 连接参数：**

| 参数 | 值 | 说明 |
|---|---|---|
| Endpoint | `wss://api.elevenlabs.io/v1/speech-to-text/realtime` | Scribe v2 Realtime |
| `model_id` | `scribe_v2_realtime` | 指定模型 |
| `audio_format` | `pcm_16000` | 与 Rust cpal 配置严格对应 |
| `commit_strategy` | `manual` | 由快捷键控制生命周期 |
| `include_timestamps` | `false` | 减小负载，不需要词级时间戳 |
| `language_code` | (可选) | 可由用户在设置中指定 |
| Auth | `token` query param | 单次令牌，15 分钟有效 |

**发送音频的消息格式：**

```json
{
  "message_type": "input_audio_chunk",
  "audio_base_64": "<base64 encoded PCM S16LE>",
  "commit": false,
  "sample_rate": 16000
}
```

**首个音频块附带上下文：**

```json
{
  "message_type": "input_audio_chunk",
  "audio_base_64": "<first chunk>",
  "commit": false,
  "sample_rate": 16000,
  "previous_text": "function calculateTauri("
}
```

**手动提交：**

```json
{
  "message_type": "input_audio_chunk",
  "audio_base_64": "",
  "commit": true
}
```

---

### 4.3 ElevenLabs Scribe v2 集成层

#### 4.3.1 事件类型映射

```mermaid
graph LR
    subgraph "ElevenLabs API → VoxFlow"
        S1[session_started] --> H1[记录 session_id<br/>切换状态到 Recording]
        P1[partial_transcript] --> H2[触发 DiffEngine<br/>计算文本差异]
        C1[committed_transcript] --> H3[最终结果<br/>更新 last_committed_text]
        C2[committed_transcript<br/>_with_timestamps] --> H4[仅 timestamps=true 时<br/>VoxFlow 不使用]
        E1[error] --> H5[错误处理<br/>触发降级]
    end
```

#### 4.3.2 认证流程

```mermaid
sequenceDiagram
    participant USER as 用户
    participant APP as VoxFlow 桌面端
    participant SERVER as 后端服务 (可选)
    participant EL as ElevenLabs

    USER->>APP: 输入 API Key (设置界面)
    APP->>APP: 安全存储 API Key<br/>tauri-plugin-store

    Note over APP,EL: 方案 A: 直接使用 API Key (开发/个人使用)
    APP->>EL: WebSocket 连接<br/>Header: xi-api-key: xxx

    Note over APP,EL: 方案 B: 单次令牌 (生产/分发使用)
    APP->>SERVER: POST /api/scribe-token<br/>Authorization: Bearer user_token
    SERVER->>EL: POST /v1/realtime-scribe-tokens<br/>xi-api-key: master_key
    EL-->>SERVER: { token: "single_use_xxx", expires: 900 }
    SERVER-->>APP: { token: "single_use_xxx" }
    APP->>EL: WebSocket 连接<br/>?token=single_use_xxx
```

---

## 5. 数据流与 IPC 通信设计

### 5.1 IPC 通道设计

```mermaid
graph TB
    subgraph "Rust → TypeScript (推送)"
        direction TB
        CH_AUDIO["Channel&lt;AudioChunk&gt;<br/>音频数据流<br/>~100ms 间隔"]
        EVT_SHORTCUT["Event: shortcut-pressed<br/>Event: shortcut-released<br/>快捷键信号"]
        EVT_PERMISSION["Event: permission-status<br/>权限状态变更"]
    end

    subgraph "TypeScript → Rust (命令)"
        direction TB
        CMD_START["invoke: start_audio_capture<br/>启动音频采集"]
        CMD_STOP["invoke: stop_audio_capture<br/>停止音频采集"]
        CMD_INJECT["invoke: inject_text<br/>{ backspaces, text }<br/>注入文本"]
        CMD_FOCUS["invoke: check_focus<br/>检测当前焦点"]
        CMD_CLIP["invoke: copy_to_clipboard<br/>剪切板降级"]
        CMD_NOTIFY["invoke: send_notification<br/>发送通知"]
    end

    subgraph "双向"
        CMD_CONFIG["invoke: get_config / set_config<br/>配置读写"]
    end

    CH_AUDIO -.->|高频 ~10Hz| TS[TypeScript]
    EVT_SHORTCUT -.->|低频| TS
    TS -.->|按需| CMD_START
    TS -.->|高频 ~10Hz| CMD_INJECT
    TS -.->|低频| CMD_FOCUS
```

### 5.2 完整数据流时序图

```mermaid
sequenceDiagram
    actor User
    participant MAC as macOS
    participant RUST as Rust Core
    participant TS as TypeScript
    participant EL as ElevenLabs
    participant APP as 目标应用

    Note over User,APP: === 触发阶段 ===
    User->>MAC: 按下 Cmd+Shift+\
    MAC->>RUST: global_shortcut handler (Pressed)
    RUST->>TS: emit("shortcut-pressed")
    TS->>TS: State: Idle → Initializing
    TS->>RUST: invoke("check_focus")
    RUST->>MAC: AXUIElement 查询
    MAC-->>RUST: { editable: true, previous_text: "Hello " }
    RUST-->>TS: FocusResult::Editable { previous_text: "Hello " }
    TS->>EL: WebSocket 连接 (含 token)

    Note over User,APP: === 会话建立阶段 ===
    EL-->>TS: session_started
    TS->>TS: State: Initializing → Recording
    TS->>RUST: invoke("start_audio_capture")

    Note over User,APP: === 录音阶段 ===
    loop 音频采集 → 转写 → 注入
        MAC->>RUST: 麦克风 PCM 数据 (64ms 块)
        RUST->>RUST: 写入 RingBuffer
        RUST->>TS: Channel::send(AudioChunk)
        TS->>EL: input_audio_chunk { audio_base_64 }
        EL-->>TS: partial_transcript { text: " world" }
        TS->>TS: DiffEngine 计算: " world" vs ""
        TS->>RUST: invoke("inject_text", { backspaces: 0, text: " world" })
        RUST->>MAC: CGEvent: 输入 " world"
        MAC->>APP: 接收键盘事件
    end

    Note over User,APP: === 停止阶段 ===
    User->>MAC: 松开 Cmd+Shift+\
    MAC->>RUST: global_shortcut handler (Released)
    RUST->>TS: emit("shortcut-released")
    TS->>TS: State: Recording → Finalizing
    TS->>EL: input_audio_chunk { commit: true }
    TS->>RUST: invoke("stop_audio_capture")
    EL-->>TS: committed_transcript { text: "Hello world." }
    TS->>TS: DiffEngine 最终同步
    TS->>RUST: invoke("inject_text", { backspaces: 5, text: " world." })
    RUST->>MAC: CGEvent: 5×Backspace + " world."
    TS->>EL: WebSocket Close
    TS->>TS: State: Finalizing → Idle
```

---

## 6. 核心算法设计

### 6.1 Backspace Difference Algorithm (退格差异比对算法)

这是 VoxFlow 实现实时文本"魔法"视觉效果的核心算法。由于无法直接操作第三方应用的 DOM，必须通过模拟退格键 + 字符输入来同步模型输出的变化。

#### 6.1.1 算法流程

```mermaid
flowchart TD
    START[收到新 transcript<br/>new_text] --> GET_OLD[获取当前已输出文本<br/>current_text]
    GET_OLD --> LCP[计算最长公共前缀<br/>Longest Common Prefix]

    LCP --> CALC_BS["退格数 = len(current_text) - LCP_length"]
    CALC_BS --> CALC_NEW["新增文本 = new_text[LCP_length..]"]

    CALC_NEW --> EMPTY{退格数 == 0<br/>AND 新增文本 == 空?}
    EMPTY -->|是| NOP[无操作]
    EMPTY -->|否| INJECT[发送按键模拟指令]

    INJECT --> UPDATE[更新 current_text = new_text]
    UPDATE --> DONE[完成]
    NOP --> DONE
```

#### 6.1.2 算法伪代码

```typescript
interface DiffResult {
  backspaces: number;
  newText: string;
}

function computeDiff(currentText: string, newText: string): DiffResult {
  // Step 1: 计算最长公共前缀 (LCP)
  let lcpLength = 0;
  const minLen = Math.min(currentText.length, newText.length);
  while (lcpLength < minLen && currentText[lcpLength] === newText[lcpLength]) {
    lcpLength++;
  }

  // Step 2: 需要删除的字符数 = 当前文本剩余长度
  const backspaces = currentText.length - lcpLength;

  // Step 3: 需要追加的新文本
  const newTextToAppend = newText.slice(lcpLength);

  return { backspaces, newText: newTextToAppend };
}
```

#### 6.1.3 算法执行示例

```mermaid
graph LR
    subgraph "时刻 T1"
        S1["current_text = 'I'"]
        R1["partial: 'Ice cream'"]
        D1["LCP='I'(1), BS=0, NEW='ce cream'"]
    end

    subgraph "时刻 T2"
        S2["current_text = 'Ice cream'"]
        R2["partial: 'I scream every'"]
        D2["LCP='I'(1), BS=8, NEW=' scream every'"]
    end

    subgraph "时刻 T3"
        S3["current_text = 'I scream every'"]
        R3["partial: 'I scream every time'"]
        D3["LCP='I scream every'(16), BS=0, NEW=' time'"]
    end

    S1 --> D1 --> S2
    S2 --> D2 --> S3
    S3 --> D3
```

**T2 时刻详细执行过程：**

```
current_text = "Ice cream"    (9 字符)
new_text     = "I scream every" (16 字符)

LCP: 逐字符比对
  I = I  ✓ (lcpLength = 1)
  c ≠ s  ✗

backspaces = 9 - 1 = 8    (删除 "ce cream")
newText    = " scream every"

执行: 8×Backspace → 输入 " scream every"
屏幕结果: "I" + [删除"ce cream"] + " scream every" = "I scream every"
```

#### 6.1.4 算法优化策略

| 优化项 | 描述 |
|---|---|
| 节流 (Throttle) | 对 partial_transcript 事件进行 50ms 节流，避免高频触发差异计算 |
| 批量注入 | 将退格和文本合并为单次 IPC 调用，减少跨进程通信次数 |
| 最小操作剪枝 | 当 `backspaces == 0 && newText == ""` 时跳过 IPC 调用 |
| UTF-8 安全 | 正确处理多字节 Unicode 字符（如中文、Emoji），LCP 按字符而非字节计算 |

---

## 7. 权限与安全设计

### 7.1 macOS 权限矩阵

```mermaid
graph TB
    subgraph "macOS 权限要求"
        subgraph "Info.plist"
            MIC_DESC["NSMicrophoneUsageDescription<br/>VoxFlow 需要使用麦克风进行语音转写"]
            LSUI["LSUIElement = true<br/>隐藏 Dock 图标"]
        end

        subgraph "Entitlements"
            AUDIO_ENT["com.apple.security.device.audio-input<br/>麦克风访问权限"]
        end

        subgraph "运行时权限 (TCC)"
            ACC_PERM["Accessibility 权限<br/>全局快捷键 + AX API + CGEvent"]
            MIC_PERM["Microphone 权限<br/>首次录音时系统弹窗"]
        end
    end

    MIC_DESC --> MIC_PERM
    AUDIO_ENT --> MIC_PERM
    ACC_PERM --> GS[全局快捷键]
    ACC_PERM --> AX_API[AX 焦点探测]
    ACC_PERM --> CG_EVT[CGEvent 按键注入]
```

### 7.2 权限检查流程

```mermaid
flowchart TD
    START[应用启动] --> CHECK_ACC[检查 Accessibility 权限<br/>AXIsProcessTrusted]
    CHECK_ACC --> ACC_OK{已授权?}
    ACC_OK -->|是| CHECK_MIC
    ACC_OK -->|否| PROMPT_ACC[弹出权限引导窗口<br/>AXIsProcessTrustedWithOptions<br/>引导用户到系统设置]
    PROMPT_ACC --> WAIT_ACC[等待用户授权]
    WAIT_ACC --> CHECK_ACC

    CHECK_MIC[检查麦克风权限<br/>AVCaptureDevice.authorizationStatus] --> MIC_OK{已授权?}
    MIC_OK -->|是| READY[应用就绪]
    MIC_OK -->|否| PROMPT_MIC[首次录音时<br/>系统自动弹窗请求]
    PROMPT_MIC --> READY
```

### 7.3 API Key 安全策略

| 策略 | 说明 |
|---|---|
| 存储 | 使用 `tauri-plugin-store` 加密存储在本地 |
| 传输 | WebSocket 连接使用 `wss://` 加密 |
| 令牌 | 生产环境使用单次令牌 (15 分钟有效) |
| 不打包 | 绝不将主 API Key 硬编码在客户端中 |

---

## 8. 项目目录结构

```
voxflow/
├── src-tauri/                      # Rust 核心层
│   ├── Cargo.toml                  # Rust 依赖配置
│   ├── build.rs                    # Tauri 构建脚本
│   ├── tauri.conf.json             # Tauri 应用配置
│   ├── capabilities/
│   │   └── main-capability.json    # IPC 权限声明
│   ├── icons/                      # 应用图标资源
│   │   ├── icon.icns               # macOS 图标
│   │   └── tray-icon.png           # 菜单栏图标 (Template)
│   ├── Info.plist                  # macOS Info.plist (含 LSUIElement)
│   ├── VoxFlow.entitlements        # macOS Entitlements
│   └── src/
│       ├── lib.rs                  # Tauri Builder / Setup / 入口
│       ├── tray.rs                 # 菜单栏管理
│       ├── shortcut.rs             # 全局快捷键
│       ├── audio.rs                # cpal 音频采集 + RingBuffer
│       ├── keys.rs                 # CGEvent 按键模拟
│       ├── focus.rs                # AX API 焦点探测
│       ├── permissions.rs          # 权限检查与引导
│       ├── commands.rs             # Tauri Commands (IPC 接口)
│       ├── state.rs                # 应用状态 (ArcSwap 配置)
│       └── error.rs                # 统一错误类型
│
├── src/                            # TypeScript 应用层
│   ├── main.ts                     # 应用入口
│   ├── state.ts                    # 转写状态机
│   ├── scribe-client.ts            # ElevenLabs WebSocket 客户端
│   ├── diff-engine.ts              # 退格差异比对算法
│   ├── focus-check.ts              # 焦点检测 IPC 调用
│   ├── clipboard-fallback.ts       # 剪切板降级逻辑
│   ├── config.ts                   # 配置管理
│   ├── types.ts                    # TypeScript 类型定义
│   ├── ui/                         # UI 组件
│   │   ├── App.vue                 # 根组件
│   │   ├── Settings.vue            # 设置页面
│   │   └── TrayPopup.vue           # 菜单栏弹出窗口
│   ├── styles/
│   │   └── main.css                # 全局样式
│   └── vite-env.d.ts               # Vite 类型声明
│
├── package.json                    # Node.js 依赖
├── tsconfig.json                   # TypeScript 配置
├── vite.config.ts                  # Vite 构建配置
├── index.html                      # HTML 入口
├── CLAUDE.md                       # 项目指令
├── .gitignore
└── specs/                          # 设计文档
    ├── 0001-spec.md                # 需求探索文档
    └── 0002-design.md              # 本设计文档
```

---

## 9. 关键接口定义

### 9.1 Rust Tauri Commands

```rust
/// 音频块数据结构 (通过 Channel 流式传输)
#[derive(Clone, Serialize)]
pub struct AudioChunk {
    /// Base64 编码的 PCM S16LE 音频数据
    pub base64: String,
    /// 音频时长（毫秒）
    pub duration_ms: u32,
}

/// 焦点检测结果
#[derive(Clone, Serialize)]
pub enum FocusResult {
    /// 当前焦点在可编辑文本区域
    Editable {
        /// 光标前文本（最多 50 字符），用于 previous_text
        previous_text: String,
    },
    /// 当前焦点不在可编辑区域
    NotEditable,
    /// 探测失败（如权限不足）
    DetectionFailed(String),
}

/// 文本注入指令
#[derive(Clone, Serialize, Deserialize)]
pub struct InjectTextCommand {
    /// 需要发送的退格键次数
    pub backspaces: u32,
    /// 需要输入的新文本
    pub text: String,
}

/// 应用配置
#[derive(Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// ElevenLabs API Key
    pub api_key: String,
    /// 全局快捷键 (默认 "Command+Shift+Backslash")
    pub shortcut: String,
    /// 语言代码 (可选，如 "en", "zh")
    pub language_code: Option<String>,
}
```

### 9.2 TypeScript 类型定义

```typescript
/** ElevenLabs WebSocket 消息类型 */
interface ScribeMessage {
  message_type:
    | "session_started"
    | "partial_transcript"
    | "committed_transcript"
    | "committed_transcript_with_timestamps"
    | "error";
}

interface SessionStartedMessage extends ScribeMessage {
  message_type: "session_started";
  session_id: string;
  config: {
    sample_rate: number;
    audio_format: string;
    model_id: string;
    commit_strategy: string;
  };
}

interface PartialTranscriptMessage extends ScribeMessage {
  message_type: "partial_transcript";
  text: string;
}

interface CommittedTranscriptMessage extends ScribeMessage {
  message_type: "committed_transcript";
  text: string;
}

/** 差异比对结果 */
interface DiffResult {
  backspaces: number;
  newText: string;
}

/** 转写状态 */
type TranscriptionState =
  | "idle"
  | "initializing"
  | "waiting_session"
  | "recording"
  | "finalizing";
```

---

## 10. 降级与容错策略

### 10.1 降级触发条件

```mermaid
flowchart TD
    START[转写结束] --> CHECK{焦点检查结果?}

    CHECK -->|Editable| INJECT[正常注入流程]
    CHECK -->|NotEditable| FALLBACK1[主动降级: 剪切板]
    CHECK -->|DetectionFailed| FALLBACK2[被动降级: 剪切板]

    INJECT --> INJECT_OK{注入成功?}
    INJECT_OK -->|是| DONE[完成]
    INJECT_OK -->|否 / 超时| FALLBACK3[运行时降级: 剪切板]

    subgraph "剪切板降级流程"
        FALLBACK1 --> COPY[复制 committed_transcript 到剪切板]
        FALLBACK2 --> COPY
        FALLBACK3 --> COPY
        COPY --> NOTIFY[发送系统通知:<br/>转写完成：文本已复制到剪切板]
        NOTIFY --> DONE
    end
```

### 10.2 错误处理矩阵

| 错误场景 | 检测方式 | 处理策略 |
|---|---|---|
| 麦克风权限未授予 | cpal 打开流时错误 | 引导用户到系统设置授权 |
| Accessibility 权限未授予 | `AXIsProcessTrusted()` 返回 false | 引导用户到系统设置授权 |
| WebSocket 连接失败 | 连接超时 / HTTP 错误码 | 通知用户，回到 Idle 状态 |
| WebSocket 连接中断 | `onerror` / `onclose` 事件 | 尝试重连 1 次，失败则降级 |
| ElevenLabs API 错误 | `message_type: "error"` | 根据错误类型处理（quota / auth / rate_limit） |
| 音频设备不可用 | cpal `DevicesError` | 通知用户，回到 Idle 状态 |
| 焦点探测失败 | `FocusResult::DetectionFailed` | 降级到剪切板模式 |
| 按键注入超时 | 注入时间 > 5 秒 | 降级到剪切板模式 |
| 自动 90 秒提交 | ElevenLabs 强制提交 | 自动重新开始累积，保持连接 |
| 单次令牌过期 | 连接被服务端关闭 | 重新获取令牌，重新连接 |

---

## 11. 性能指标与约束

### 11.1 延迟预算

```mermaid
gantt
    title 端到端延迟预算 (目标 < 500ms)
    dateFormat X
    axisFormat %L ms

    section 音频采集
    麦克风 → cpal 缓冲       :a1, 0, 64
    RingBuffer 读取          :a2, 64, 100

    section 数据传输
    Base64 编码              :t1, 100, 102
    Tauri IPC Channel        :t2, 102, 107
    WebSocket 发送           :t3, 107, 120

    section 云端处理
    ElevenLabs 模型推理      :c1, 120, 270

    section 结果注入
    WebSocket 接收           :i1, 270, 275
    DiffEngine 计算          :i2, 275, 277
    IPC 命令发送             :i3, 277, 280
    CGEvent 按键注入         :i4, 280, 350

    section 总计
    端到端延迟               :done, 0, 350
```

| 阶段 | 预期延迟 | 说明 |
|---|---|---|
| 音频采集 (cpal 缓冲) | ~64ms | 1024 frames @ 16kHz |
| RingBuffer 读取间隔 | ~100ms | 定时任务间隔 |
| Base64 编码 | <2ms | Rust 端高性能编码 |
| Tauri IPC Channel | ~5ms | 进程间通信 |
| WebSocket 传输 | ~10ms | 局域网 RTT |
| ElevenLabs 模型推理 | ~150ms | 官方标称延迟 |
| DiffEngine 计算 | <2ms | LCP 算法 |
| CGEvent 按键注入 | ~70ms | 取决于文本长度 |
| **端到端总延迟** | **~350-500ms** | 首字符到首字符 |

### 11.2 资源占用目标

| 资源 | 目标值 | 说明 |
|---|---|---|
| 内存占用 | < 50MB | 对比 Electron ~200MB |
| CPU 空闲时 | < 1% | 仅菜单栏常驻 |
| CPU 录音时 | < 5% | 音频采集 + 编码 + 传输 |
| 安装包大小 | < 15MB | Tauri v2 + Rust 原生 |
| 启动时间 | < 2s | 冷启动到菜单栏就绪 |

---

## 12. 开发里程碑

```mermaid
gantt
    title VoxFlow 开发计划
    dateFormat  YYYY-MM-DD
    axisFormat  %m-%d

    section Phase 1: 基础骨架
    Tauri v2 项目初始化         :p1a, 2026-03-27, 1d
    菜单栏常驻 + Dock 隐藏      :p1b, after p1a, 1d
    全局快捷键注册              :p1c, after p1b, 1d
    设置窗口 UI 基础            :p1d, after p1c, 2d

    section Phase 2: 音频管道
    cpal 音频采集               :p2a, after p1c, 2d
    RingBuffer + Base64 编码    :p2b, after p2a, 1d
    Tauri Channel IPC 桥接      :p2c, after p2b, 1d
    麦克风权限处理              :p2d, after p2a, 1d

    section Phase 3: 转写集成
    ElevenLabs WebSocket 客户端  :p3a, after p2c, 2d
    转写状态机实现              :p3b, after p3a, 1d
    manual commit 策略          :p3c, after p3b, 1d
    previous_text 上下文注入    :p3d, after p3c, 1d

    section Phase 4: 文本注入
    AX API 焦点探测            :p4a, after p3b, 2d
    CGEvent 按键模拟           :p4b, after p4a, 2d
    DiffEngine 退格差异算法     :p4c, after p4b, 1d
    端到端集成测试             :p4d, after p4c, 2d

    section Phase 5: 降级与打磨
    剪切板降级机制             :p5a, after p4d, 1d
    系统通知                   :p5b, after p5a, 1d
    Accessibility 权限引导     :p5c, after p4a, 1d
    性能优化与压力测试          :p5d, after p5b, 2d
```

### 里程碑说明

| Phase | 目标 | 交付物 |
|---|---|---|
| **Phase 1** | 可运行的 Tauri v2 菜单栏应用骨架 | 菜单栏常驻、快捷键响应、基础设置 UI |
| **Phase 2** | 音频采集管道打通 | 麦克风采集 → RingBuffer → Base64 → IPC Channel → TypeScript |
| **Phase 3** | ElevenLabs 转写集成 | WebSocket 连接、实时转写、manual commit |
| **Phase 4** | 跨应用文本注入 | 焦点探测、按键模拟、差异算法、端到端可用 |
| **Phase 5** | 降级、容错与打磨 | 剪切板降级、权限引导、性能优化、完整可用产品 |

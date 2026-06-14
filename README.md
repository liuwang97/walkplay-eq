# Walkplay EQ

> 一款为 **Walkplay / TTGK Technology T02** 系列 USB DAC 耳放打造的桌面参量均衡器（PEQ）控制软件。

Walkplay EQ 让你在 Windows 桌面上直接调节硬件耳放的 8 段参量均衡——拖动滑块即时写入设备，并以实时频响曲线可视化效果。基于 [Tauri 2](https://tauri.app/) + React 构建，原生、轻量、无需常驻浏览器内核之外的额外运行时。

> [!WARNING]
> 本项目为**第三方独立开发**，与 Walkplay / TTGK Technology 官方无任何隶属或合作关系。设备通信协议通过对官方应用抓包逆向得到，**仅在 T02（VID/PID 对应设备）上验证过**。固件升级等操作存在风险，请阅读下方[免责声明](#-免责声明)后自行评估使用。

---

## ✨ 功能特性

- **8 段参量均衡（PEQ）**：每个频段可独立调节
  - 频率（Hz）、Q 值、增益（dB）
  - 滤波器类型（峰值 Peaking / 低架 Low-shelf / 高架 High-shelf 等）
  - 单段开关
- **前置增益（Preamp）**：全局预增益，避免叠加增益后削顶失真
- **实时频响曲线**：基于 [uPlot](https://github.com/leeoniya/uPlot) 的对数频率轴响应图，所见即所得
- **预设管理**
  - 内置预设：导入自官方应用的 AutoEQ / Harman 调音（如 WH-1000XM5）
  - 自定义预设：保存当前调音，支持**重命名、删除、更新**，本地持久化
  - 在线预设 / 我的分享：浏览、点赞、分享 EQ
- **EQ 试听**：一键应用并对比不同预设
- **固件升级**：内置升级流程，带 dry-run 安全校验机制（默认不写设备）
- **系统托盘**：快速切换 EQ 预设、查看连接状态，关闭窗口后驻留后台
- **自动连接**：插入设备即自动连接，支持热插拔重连；手动断开后不会自动重连
- **中英文双语**：内置 i18n（简体中文 / English）

## 🎧 支持的设备

- Walkplay / TTGK Technology **T02** USB DAC 耳放

> 其他 Walkplay 系列设备如使用相同的 HID biquad 系数协议，理论上可兼容，但尚未验证。欢迎提交 Issue 反馈你的设备。

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 · TypeScript · Vite 7 · Tailwind CSS v4 · shadcn/ui（Radix UI） |
| 状态 / 数据 | Zustand · TanStack Query |
| 图表 / i18n | uPlot · i18next / react-i18next |
| 桌面框架 | Tauri 2（Rust） |
| 设备通信 | HID（`hidapi`），T02 biquad 系数协议（report `0x3302`） |

项目是一个 Cargo workspace：

- `src-tauri/` —— Tauri 应用后端（HID 通信、固件升级、托盘）
- `crates/walkplay-dac-protocol/` —— 设备协议编解码 crate

## 🚀 开发与构建

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) stable 工具链
- Tauri 2 的[系统依赖](https://tauri.app/start/prerequisites/)（Windows 需 WebView2 + MSVC 构建工具）

### 安装依赖

```bash
npm install
```

### 本地开发

```bash
# 启动 Tauri 桌面应用（带热重载）
npm run tauri dev

# 仅启动前端（浏览器预览，无设备通信）
npm run dev
```

### 打包构建

```bash
npm run tauri build
```

构建产物（安装包 / 可执行文件）位于 `src-tauri/target/release/bundle/`。

## 📁 项目结构

```
.
├── src/                          # 前端（React + TS）
│   ├── features/
│   │   ├── connection/           # 连接栏、自动连接
│   │   ├── curve/                # 频响曲线（uPlot）+ DSP
│   │   ├── eq/                   # EQ 面板、T02 协议组帧
│   │   ├── firmware/             # 固件升级对话框
│   │   └── presets/             # 预设面板（内置/自定义/在线/分享）
│   ├── lib/                      # 全局 store、Tauri bridge、类型
│   └── i18n/                     # 中英文文案
├── src-tauri/                    # Tauri 后端（Rust）
│   └── src/{hid,firmware,lib}.rs
├── crates/
│   └── walkplay-dac-protocol/    # 设备协议 crate
└── public/
```

## 🔌 关于设备协议

T02 使用 HID 输出报告传输 biquad（双二阶）滤波器系数：上位机将每个频段的频率、Q、增益、类型换算为定点化的滤波器系数，组成完整的 8 段程序后一次性下发并提交（commit），前置增益作为独立帧发送。相关实现见 `src/features/eq/t02-protocol.ts` 与 `crates/walkplay-dac-protocol/`，协议细节经与官方应用对比验证。

> Windows 上该设备的系数读回（readback）被屏蔽，因此连接时由上位机将当前 UI 状态推送到设备，以保证「界面 == 设备」的一致状态。

## ⚠️ 免责声明

- 本软件按「现状」提供，不提供任何明示或暗示的担保。
- 设备通信协议为逆向所得，可能在固件更新后失效；作者不保证其正确性或与未来固件的兼容性。
- **固件升级等写操作可能导致设备变砖**，请务必了解风险后再操作。因使用本软件造成的任何损失，作者不承担责任。
- Walkplay、TTGK Technology 及相关商标归各自所有者所有，本项目与之无关。

## 📄 License

[MIT](./LICENSE) © 2026 Akira

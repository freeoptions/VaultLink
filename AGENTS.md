# VaultLink 项目专属规则

通用规则见：`E:\@imFile-Download\AI-Useful-Prompt\通用开发工作规则.md`。

- 本项目是 Tauri + React + TypeScript 应用，Rust/Tauri 代码在 `src-tauri`，同时保留 Tauri Android 工程。
- 开发命令：`npm run dev`；前端检查/构建：`npm run build`；正式 Windows EXE 使用 `npm run build:exe`，该流程会执行 `copy-exe`。
- 不得用裸 `cargo build --release` 代替正式交付，也不要绕过项目已有的 EXE 复制流程。
- 项目名与交付映射：`VaultLink-Windows端 -> VaultLink.exe`。
- Windows 最终产物只复制到 `D:\@Software\VaultLink\VaultLink.exe`；不要复制 `target`、`dist`、Android build 或其他中间产物。
- 安卓相关命令包括 `npm run android:init`、`npm run android:dev`、`npm run android:build` 和 `npm run android:build:all`；除非用户明确要求，修改后只提醒去 Android Studio 构建。
- 账号、加密数据、本地配置和任何密钥只能保留在本地；涉及搜索时保留现有中文、完整拼音和首字母搜索能力。

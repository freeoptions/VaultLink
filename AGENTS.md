# VaultLink 项目专属规则

本项目继承 Codex 已加载的全局 `AGENTS.md`（本机：`C:\Users\freez\.codex\AGENTS.md`）；以下保留项目专属规则。

- 本项目是 Tauri + React + TypeScript 应用，Rust/Tauri 代码在 `src-tauri`，同时保留 Tauri Android 工程。
- 开发命令：`npm run dev`；前端检查/构建：`npm run build`；正式 Windows EXE 使用 `npm run build:exe`，该流程会执行 `copy-exe`。
- 不得用裸 `cargo build --release` 代替正式交付，也不要绕过项目已有的 EXE 复制流程。
- 项目名与交付映射：`VaultLink-Windows端 -> VaultLink.exe`。
- Windows 最终产物只复制到 `D:\@Software\VaultLink\VaultLink.exe`；不要复制 `target`、`dist`、Android build 或其他中间产物。
- 安卓相关命令包括 `npm run android:init`、`npm run android:dev`、`npm run android:build` 和 `npm run android:build:all`；除非用户明确要求，修改后简短提醒去 Android Studio 构建。 如存在检查失败、未验证或未完成事项，必须同时说明。
- 账号、加密数据、本地配置和任何密钥只能保留在本地；涉及搜索时保留现有中文、完整拼音和首字母搜索能力。

## 构建与共享缓存约束

- 依赖安装、编译检查或打包前，必须主动读取并遵守 D:\MyCodes\@UploadToGithub\AGENTS.md（共享规则），不依赖仓库外父目录自动加载；本项目已有的构建入口、交付方式及更严格限制继续适用。
- Windows 最终 Release 构建须有“11”“构建”“打包”等明确授权，并使用本项目专用入口；前端检查不等于最终打包授权。Android 继续按本项目约定由用户在 Android Studio 构建，不自行扩展为 Gradle 构建或安装。构建授权不自动包含启动、安装或发布。
- 使用 npm、pip、uv 时，下载缓存分别使用 E:\BuildCaches\npm、E:\BuildCaches\pip、E:\BuildCaches\uv，不改回 C 盘或重建旧入口。其他工具沿用已确认的有效位置；BUILD_CACHE_PLAN.md 中尚未实施的规划不视为已迁移。不同工具使用各自缓存子目录。
- 执行前核对工具实际缓存配置及当前进程环境，特别是 GRADLE_USER_HOME、CARGO_HOME、RUSTUP_HOME、APPDATA、LOCALAPPDATA；继承异常时，只为当前命令补齐经核实的现有配置，不擅改全局环境、迁移缓存或新建替代缓存目录。
- 复用现有依赖和增量编译缓存；只有依赖变化、缺失或确认损坏时才处理对应部分，不盲目重装全部依赖、清缓存或全量重建。不执行 cargo clean，不擅删有效 Gradle/Release 缓存；node_modules、.venv、项目 .gradle 和编译输出继续按项目隔离。
- 只执行本次任务必要的检查，不顺带构建其他项目或无关模块；通过后没有新修改或新问题，不重复全量检查。较大下载或构建前核对源码、缓存及产物所在盘的可用空间和实际输出路径，空间不足先说明，不靠清空有效缓存解决。
- 历史正式打包副本只保留最近一次成功且验证完整的版本，固定交付位置的当前版本另行保留；新版验证并交付成功后再按共享规则及本项目清理例外处理旧副本，失败保留上一成功版本。源码、用户修改、运行数据和有效构建缓存不属于历史副本。

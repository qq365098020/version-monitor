# version-monitor

## 项目简介

version-monitor 是一个版本更新监控项目，用于监控 iOS 与豆包输入法（Doubao IME）的版本更新。项目通过 GitHub Actions 定时自动检测官方渠道的最新版本，并在检测到变化时自动记录，方便第一时间了解版本动态。

## 工作原理

项目基于 GitHub Actions 实现自动化检测：

1. GitHub Actions 每 6 小时运行一次「Check Doubao IME Windows」工作流；
2. 工作流使用 Playwright 无头浏览器打开豆包输入法 Windows 版官网下载页，检测页面上的版本、发布日期和安装包信息；
3. 将检测结果与 `status/` 目录下的基线文件进行对比；
4. 若发现版本或相关信息发生变化，自动提交更新记录到仓库。

## 目录结构

- `.github/workflows/`：定时工作流配置，每 6 小时触发一次版本检测；
- `scripts/`：检测脚本，使用 Playwright 无头浏览器采集版本信息；
- `status/`：版本基线与检测结果记录（`baseline.json`、`doubao-windows.json`）；
- `README.md`：项目说明文档；
- `LICENSE`：MIT 开源许可证。

## 当前状态

GitHub Actions 每天稳定运行，持续监控豆包输入法 Windows 版的版本变化，检测结果会自动记录在 `status/` 目录下。

## 许可证

本项目采用 MIT License，详见 [LICENSE](LICENSE)。

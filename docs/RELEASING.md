# Windows 发布指南

## 发布前

- `main` 上的构建、CodeQL 和依赖审查通过。
- `package.json` 与 `package-lock.json` 版本一致。
- `CHANGELOG.md` 有对应版本章节。
- 在真实 Windows 11 x64 机器上完成安装和关键流程验证。

## 步骤

1. 运行 `npm run version:set -- x.y.z`。
2. 更新 `CHANGELOG.md`。
3. 运行：

   ```bash
   npm run verify
   npm run test:official
   npm run package:win:x64
   npm run test:packaged
   ```

4. 核对 `release/SHA256SUMS-win32-x64` 与安装包校验值。
5. 合并到 `main`，创建并推送 `vx.y.z` 标签。
6. GitHub Actions 生成 Windows x64 安装包和 Release。
7. 在干净电脑验证首次启动、版本切换、备份、回滚、托盘、开机启动和卸载。

## 发布资产

- `DSH-Desktop-Setup-<版本>-x64.exe`
- Windows x64 SHA-256 清单
- SBOM 与许可证清单

安装包当前没有受信任代码签名，Release 必须明确说明 SmartScreen 警告。不要覆盖已发布的同名文件；发现严重问题时发布新的补丁版本，不移动已有标签。

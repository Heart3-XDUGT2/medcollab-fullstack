# 组件来源与许可

- `frontends/ohif`：基于 OHIF Viewers 的完整定制工作区，版本与依赖以其中 `package.json`、`pnpm-lock.yaml` 为准；原 MIT LICENSE、NOTICE/引用说明、依赖补丁和上游文档保留。
- `frontends/portal`：MedCollab Portal，保留原 `LICENSE`、`THIRD_PARTY_NOTICES.md` 与 `public/licenses/`。
- `gateway/theme/medcollab-portal`：保留 Portal 派生样式许可 `PORTAL-LICENSE`，并附 Inter 的 `inter-OFL.txt` 和 Lucide 的 `lucide-LICENSE.txt`。
- Keycloak 与 Orthanc 为独立外部服务；本包只提供配置，不附带其发行二进制或原电脑的运行目录。使用这些服务时适用各自上游许可。
- `backend` 与新增集成/部署文件：原项目未提供独立开源许可，本次打包不改变其许可状态。

包中上游文档截图、图标及自动化测试基准图作为原源码资产保留；原电脑实际导入的医学影像、数据库及本机验证截图不包含在本包中。

# 隐私说明（Privacy）

Job Search Copilot 是本地优先工具，不提供中央后端、遥测、分析 SDK 或自动 exporter。默认数据根目录为：macOS `~/Library/Application Support/job-search-copilot`；Linux `$XDG_DATA_HOME/job-search-copilot`，未设置时为 `~/.local/share/job-search-copilot`；Windows `%LOCALAPPDATA%\job-search-copilot`。可用 `JOB_SEARCH_COPILOT_DATA_DIR` 显式覆盖。

## 本地保存与模型处理不是一回事

SQLite 数据库、导入的简历副本、附件与导出文件写在本机。但是，当你要求 Codex 阅读或分析简历时，完整简历文本可能由当前 Codex 模型处理。模型处理适用你当前产品、账户与组织的隐私和保留政策；本插件无法把远程模型变成本地模型，也不应承诺内容永不离开设备。

搜索查询只应包含完成检索所需的岗位、技能和地点。不要把邮箱、电话、住址、证件号、签名、人口统计信息、Cookie、token 或账号凭据放进查询。公开 trace 使用固定字段 allowlist，并对联系方式、凭据、敏感 URL 与本机绝对路径进行脱敏；Viewer 与 recovery snapshot 不返回简历全文或 application field values。

## 保存、导出与删除

每个 workspace 有独立目录及 `attachments/`、`exports/`。SQLite 保留版本化 profile、search brief、preference、run、证据、反馈、packet 和 trace；保留期限由用户负责。`workspace_export` 可生成 JSON、Markdown 或 CSV；显式请求的 JSON recovery 内容仍经过公共脱敏 projection，但导出文件本身仍应按个人数据保护。

需要删除时，先关闭 Codex 中正在运行的该插件，再手动备份或删除对应数据根目录。项目不提供远程副本、回收站或自动保留策略；删除前请自行确认 workspace ID 与所需导出。

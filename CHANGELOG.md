# 更新日志

版本号以仓库根目录 `version` 文件为唯一来源，`package.json` 由 `npm run sync-version` 保持同步。

## [1.2.5] - 2026-08-26

### 修复
- 缩略图缓存清理在图库含压缩包时因类型错误整体中止，且异常被空 catch 吞掉（缓存无限增长且无日志）
- 默认开启 `trust proxy` 导致直接暴露端口时可伪造 `X-Forwarded-For` 绕过登录限流
- `docker-compose.yml` 写死弱默认密码与会话密钥，抵消了随机密码保护
- 启动依赖探测遗漏 `ffprobe`

### 新增
- helmet 安全响应头与 CSP 策略
- 会话持久化到 SQLite（`data/sessions.db`），替换重启即掉线且内存无上限的默认 MemoryStore
- `TRUST_PROXY`、`LOGIN_RATE_LIMIT_MAX`、`API_RATE_LIMIT_MAX` 环境变量
- `npm test` 脚本与 push/PR 触发的 CI 测试流水线，新增路径遍历防护与缩略图清理回归测试
- `npm run sync-version` 校对并同步版本号，CI 不一致则失败

### 改进
- `auth.verify` 改为定长哈希 + `timingSafeEqual` 比较
- `safeResolve` 改为异步，不再每请求两次同步 `realpathSync` 阻塞事件循环
- 镜像构建改用 `npm ci`，容器以非 root 的 `node` 用户运行
- 前端共享逻辑抽到 `public/js/shared.js`（URL 构造、时间分组、收藏键、懒加载、API 封装），消除桌面端与移动端重复实现

### 清理
- 移除从未生效的缩略图 `size` 参数（服务端硬编码忽略了它，前端仍在传）

---

## [1.2.0] - [1.2.4]
- 压缩包读取改为 bsdtar 流式处理，消除整包读入内存
- 项目更名：套图管理器 → 视图浏览器
- 移动端新增分页导航
- CI 构建前清理 GHCR 旧版本

> 注：仓库中 `v1.2.4` 标签指向的提交早于 `v1.2.3`，属历史遗留的标签错位。

---

## [1.1.26] - 安全加固与可观测性

### 新增
- **安全性加固**
  - 添加登录速率限制（15 分钟内最多 30 次尝试）
  - 添加输入验证（express-validator）
  - 路径遍历防护加强
  
- **错误处理和日志**
  - 添加结构化日志系统（winston）
  - 全局错误处理中间件
  - 请求日志记录（包含方法、路径、状态码、响应时间、用户等）
  - 审计日志（登录、登出）
  - 日志文件轮转（最大 5MB，保留 5 个文件）
  - 生产环境错误信息安全处理
  
- **性能优化**
  - 图片和视频列表分页支持（默认每页 50 项，最多 100 项）
  - HTTP 缓存策略：静态资源 1 小时缓存
  - 原始图片添加缓存头（24小时）
  - API 通用速率限制（每分钟每用户 600 次请求）
  - 并发请求管理
  
- **配置管理**
  - 添加 `.env.example` 环境变量示例
  - 改进 `.gitignore`，添加敏感文件过滤
  - 支持 `LOG_LEVEL` 环境变量配置
  
- **文档**
  - 新增 `SECURITY.md` 安全性指南
  - 更新 `README.md` 新增功能说明
  - 添加 `CHANGELOG.md` 更新日志

### 改进
- 日志系统从 console 升级为 winston 结构化日志
- 管理员认证改为直接读取环境变量 `ADMIN_USER` / `ADMIN_PASSWORD`
- 错误处理更加健壮和信息安全
- Session Cookie 安全配置增强（生产环境自动启用 secure 标志）

### 破坏性变更
- 移除 Web 端密码修改功能及 `POST /api/change-password`、`GET /api/csrf-token` 端点
- 移除密码文件存储（`data/users.json`），账号密码完全由环境变量控制
- 移除依赖：`bcryptjs`、`csurf`

### 迁移说明
1. 运行 `npm install` 更新依赖
2. 通过环境变量 `ADMIN_USER` / `ADMIN_PASSWORD` 设置管理员账号，修改后重启服务生效
3. 日志文件现在存储在 `data/logs/` 目录
4. 建议在生产环境设置 `NODE_ENV=production`

---

## [1.0.0] - 初始版本
- 基础套图管理功能
- 登录认证
- 图片浏览和缩略图生成
- Docker 容器支持

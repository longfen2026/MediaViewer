# 安全性指南

## 安全特性

### 认证与授权
- **环境变量认证**：管理员账号密码由环境变量 `ADMIN_USER` / `ADMIN_PASSWORD` 设置，服务不存储任何密码
- **会话管理**：
  - HttpOnly Cookie - 防止 XSS 攻击
  - SameSite 策略 - 防止 CSRF 攻击
  - 7 天有效期，自动过期
  - 会话持久化在 `data/sessions.db`，过期记录定时清理

### 访问控制
- **路径遍历防护**：严格验证所有路径参数，并解析真实路径防止软链接逃逸
- **API 认证**：除 `/ping`、`/version`、`/login` 外所有 API 端点都需要认证

### 速率限制
- **登录限制**：同一 IP 15 分钟内最多 30 次登录尝试（`LOGIN_RATE_LIMIT_MAX`）
- **API 限制**：同一用户每分钟最多 600 次 API 请求（`API_RATE_LIMIT_MAX`）
- 防止暴力破解和资源滥用
- **代理信任**：默认不信任 `X-Forwarded-For`。仅在反向代理后部署时设置 `TRUST_PROXY=1`，否则限流可被伪造请求头绕过

### 日志与监控
- **结构化日志**：所有重要操作都被记录（登录、登出、错误等）
- **日志存储**：
  - `data/logs/error.log` - 错误日志
  - `data/logs/combined.log` - 完整日志
  - 每个日志文件最大 5MB，最多保留 5 个文件
- **敏感信息保护**：日志中不会记录密码或敏感数据

### 错误处理
- **安全的错误信息**：生产环境下不暴露内部错误细节
- **全局错误处理**：捕获并记录所有未处理的异常

## 部署建议

### 生产环境配置

1. **环境变量设置**
```bash
NODE_ENV=production
PORT=8080
SESSION_SECRET=<强随机密钥>  # 使用 `openssl rand -hex 32` 生成
GALLERY_ROOT=/safe/path/to/images
ADMIN_USER=<自定义用户名>
ADMIN_PASSWORD=<强密码>  # 修改后重启服务生效
TRUST_PROXY=1            # 仅当服务运行在反向代理之后
```

2. **HTTPS/TLS**
   - 在生产环境中，应在反向代理（如 Nginx）后运行
   - 启用 HTTPS/TLS 加密传输
   - 设置 `secure: true` Cookie 标志（已在生产环境自动启用）

3. **文件系统权限**
   - 限制 `data/` 目录的访问权限：`chmod 700 data/`
   - 确保图片目录只有必要的读权限

4. **网络隔离**
   - 不要将服务直接暴露到公网
   - 使用防火墙限制访问
   - 考虑在内网或 VPN 后运行

### Docker 安全实践

```bash
# 使用只读根文件系统
docker run -d \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /app/data \
  -v /data/pictures:/gallery:ro \
  -v gallery-data:/app/data \
  -p 8080:8080 \
  gallery-manager
```

## 安全更新

- 定期检查依赖包更新：`npm outdated`
- 更新安全补丁：`npm audit fix`
- 定期更新 Node.js 版本

## 密码管理

管理员账号密码完全由环境变量 `ADMIN_USER` / `ADMIN_PASSWORD` 控制，不提供 Web 端修改密码功能。修改密码即修改对应环境变量并重启服务。

## 问题报告

发现安全漏洞？请通过以下方式报告：
1. 不要在公开 Issue 中发布漏洞
2. 发送邮件至 maintainer（如适用）
3. 提供详细的漏洞描述和复现步骤

## 定期安全审计建议

- [ ] 定期查看访问日志，检查异常登录尝试
- [ ] 检查环境变量 `ADMIN_PASSWORD` 强度并及时更新
- [ ] 检查文件系统权限是否正确
- [ ] 更新所有依赖的安全补丁
- [ ] 备份和恢复测试

# 视图浏览器

基于 Node.js 的 Web 视图浏览器，可浏览映射目录中的图片套图（文件夹与 zip/rar 压缩包），提供登录认证、目录树浏览、缩略图宫格与全屏原图查看。封装为 Docker 容器。

## 功能特性

1. **Web 管理 + 登录认证**：管理员账号密码由环境变量 `ADMIN_USER` / `ADMIN_PASSWORD` 设置（默认 `admin` / `admin`）
2. **映射目录管理**：通过环境变量指定根目录，每个子目录即一个套图集合，可包含多个子文件夹与压缩包
3. **左侧目录树 + 右侧浏览区**：点击左侧目录，右侧展示其中套图与图片
4. **压缩包浏览**：支持 `.zip` 与 `.rar`，统一通过 libarchive `bsdtar` 流式读取
5. **主流图片格式**：JPG/PNG/GIF/WebP/BMP/TIFF/AVIF/SVG/ICO/HEIC 等
6. **宫格缩略图**：进入目录时刷新缩略图（sharp 生成 WebP 缓存），点击图片全屏查看原图，支持左右键切换
7. **性能优化**：
   - 图片和视频列表分页显示（默认每页50项，最多100项）
   - HTTP 缓存策略，减少重复请求
   - 缩略图智能缓存和自动失效
8. **安全加固**：
   - 登录速率限制（15分钟内最多30次尝试，`LOGIN_RATE_LIMIT_MAX` 可调）
   - API 速率限制（每分钟最多600次请求，`API_RATE_LIMIT_MAX` 可调）
   - 路径遍历防护
   - 会话持久化到 SQLite，重启不掉线
   - 容器以非 root 用户运行
   - 结构化日志记录（错误和审计日志）

## 快速开始（Docker Compose）

```bash
# 1. 准备图片目录（放置套图）
mkdir -p /data/pictures

# 2. 启动（默认 admin/admin，根目录 /data/pictures）
ADMIN_USER=admin ADMIN_PASSWORD=your-strong-password GALLERY_DIR=/data/pictures docker compose up -d

# 3. 打开 http://localhost:8080
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | 服务端口 |
| `GALLERY_ROOT` | `/gallery` | 图片映射根目录 |
| `ADMIN_USER` | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD` | 随机生成 | 管理员密码，未设置时启动日志会打印随机密码 |
| `SESSION_SECRET` | 随机生成 | 会话签名密钥，持久化到 `data/session_secret` |
| `THUMB_DIR` | `/app/data/thumbs` | 缩略图缓存目录 |
| `VIDEO_THUMB_DIR` | `/app/data/videothumbs` | 视频缩略图缓存目录 |
| `VIDEO_CACHE_DIR` | `/app/data/videos` | 压缩包内视频解压缓存目录 |
| `CACHE_MAX_MB` | `2048` | 缓存总容量上限（含缩略图与解压视频），超限时按最久未访问淘汰，`0` 为不限 |
| `THUMB_CONCURRENCY` | CPU 核数（2–8） | 缩略图生成并发数，容器内会遵循 cgroup CPU 限制 |
| `TRUST_PROXY` | `0` | 信任的反向代理层数，仅在代理后运行时设为 `1` |
| `LOGIN_RATE_LIMIT_MAX` | `30` | 单 IP 15 分钟内登录尝试上限 |
| `API_RATE_LIMIT_MAX` | `600` | 单用户每分钟 API 请求上限 |

> `TRUST_PROXY` 为 `0` 时按真实连接 IP 限流。若容器直接暴露端口却设为 `1`，客户端可伪造 `X-Forwarded-For` 绕过登录限流。

## 手动构建运行

```bash
docker build -t gallery-manager .
docker run -d -p 8080:8080 \
  -e GALLERY_ROOT=/gallery \
  -v /data/pictures:/gallery \
  -v gallery-data:/app/data \
  gallery-manager

## 从 GHCR 拉取镜像并运行（CI 推送后）

如果仓库启用了 CI 将镜像推送到 GitHub Container Registry，你可以直接拉取 `latest` 镜像：

```bash
# 私有包需要先登录（使用 PAT）
docker login ghcr.io -u <USERNAME> -p <PERSONAL_ACCESS_TOKEN>

docker pull ghcr.io/<owner>/<repo>:latest
docker run -d -p 8080:8080 \
  -e GALLERY_ROOT=/gallery \
  -v /data/pictures:/gallery \
  -v gallery-data:/app/data \
  ghcr.io/<owner>/<repo>:latest
```

### 生成并使用 GitHub PAT（快速说明）

1. 打开 https://github.com/settings/tokens 。
2. 点击 **Generate new token** → **Generate new token (classic)**（或使用新版 UI）。
3. 填写名称并选择有效期；在 **Scopes** 中至少勾选：
  - `read:packages`（拉取私有镜像）
  - `write:packages`（如需推送镜像）
4. 生成后**复制**令牌（仅显示一次）。
5. 本地登录 GHCR：
```bash
echo <PERSONAL_ACCESS_TOKEN> | docker login ghcr.io -u <USERNAME> --password-stdin
```

请妥善保管 PAT，不要在公开仓库中明文提交。若仅需从 CI 拉取私有镜像，可在目标系统使用 repository-level 或 org-level secrets 自动登录。
```

## 本地开发

```bash
npm install
GALLERY_ROOT=./gallery PORT=8080 npm start
```

## 说明

- 管理员账号密码完全由环境变量 `ADMIN_USER` / `ADMIN_PASSWORD` 控制，修改后重启服务生效
- rar 浏览依赖容器内的 `bsdtar`（libarchive），宿主机直接运行时需自行安装 `libarchive-tools`
- 缩略图按 文件路径+大小+修改时间 生成缓存键，自动失效

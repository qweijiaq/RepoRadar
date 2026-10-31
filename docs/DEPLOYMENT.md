# Docker 部署

仓库自带 `Dockerfile` 和 `docker-compose.yml`，一条 Compose 可以启动 PostgreSQL、数据库迁移、Web 和 worker。

## 前置条件

- Docker Engine 24+ 与 Docker Compose v2
- 至少 4 GB 可用内存（worker 的沙箱构建会用到 Docker）
- 一个域名和 HTTPS 反向代理（公网部署）

## 1. 准备环境变量

```bash
cp .env.example .env
```

至少修改：

```dotenv
AUTH_SECRET=用 openssl rand -base64 32 生成
ADMIN_LOGINS=你的GitHub登录名
SETUP_TOKEN=一段随机的初始化令牌
RADAR_BASE_URL=https://你的域名
```

- `AUTH_SECRET` 必须固定保存；更换后，数据库里已加密的 OAuth Secret、模型 Key、SMTP 密码、GitHub token、VAPID 密钥都会无法解密。
- `ADMIN_LOGINS` 决定谁能修改全局配置。留空时最早注册的用户会成为管理员，但公网部署建议显式设置。
- `SETUP_TOKEN` 用于首次配置 GitHub OAuth；localhost 访问不需要。
- 如果要覆盖页面配置，可以填 `SMTP_URL`、`MAIL_FROM`、`GITHUB_TOKEN`、`LLM_*` 等；不填时以设置页为准。

## 2. 启动

```bash
docker compose up -d --build
```

Compose 会依次：

1. 启动 PostgreSQL，等待健康检查；
2. 运行一次性 `migrate` 服务应用数据库 schema；
3. 启动 Web（默认 `http://localhost:3000`）和 worker。

查看状态：

```bash
docker compose ps
docker compose logs -f web
docker compose logs -f worker
```

健康检查：

```bash
curl -fsS http://localhost:3000/api/health
```

如果本机 3000 端口被开发服务器占用：

```bash
WEB_PORT=3001 docker compose up -d --build
```

如果要换 PostgreSQL 宿主机端口（只绑定 127.0.0.1）：

```bash
POSTGRES_PORT=5434 docker compose up -d
```

## 3. 首次配置

打开 `http://localhost:3000/setup`：

- 本机访问可以直接填写 GitHub OAuth App 的 Client ID / Client Secret；
- 公网访问需要在表单里填写 `SETUP_TOKEN`，否则页面锁定；
- GitHub OAuth App 的 Authorization callback URL 填 `https://你的域名/api/auth/callback/github`。

保存后登录，第一个用户或 `ADMIN_LOGINS` 中的用户可以进入设置页配置 AI 模型、邮件通道和站点地址。

默认 OAuth 登录只申请 `read:user user:email`。需要仓库管理、维护周报或补丁生成时，到 `/repos` 点「授权仓库管理」，再授权 `repo` + `delete_repo`；动态同步不需要额外权限。

## 4. 域名、TLS 与反向代理

把域名指向服务器，用 Caddy / Nginx / Traefik 终止 TLS，并反代到 Web。Compose 默认只把 Web 绑定到 `127.0.0.1`，外部访问应经过代理。

### Caddy

仓库提供 `deploy/Caddyfile`：

```caddyfile
{$RADAR_DOMAIN} {
    encode zstd gzip
    reverse_proxy web:3000
    header { -Server }
}
```

在 `.env` 设置域名后启动 TLS profile：

```dotenv
RADAR_DOMAIN=radar.example.com
```

```bash
docker compose --profile tls up -d web caddy
```

Caddy 会自动申请和续期 HTTPS 证书。如果 Caddy 不在同一台机器，把 `reverse_proxy` 改成 `127.0.0.1:3000` 或实际内网地址。

### 本地 TLS 演练

不配置真实域名也可以用 Caddy 的内部 CA 验证 HTTPS 和代理头：

```bash
CADDYFILE=./deploy/Caddyfile.local docker compose --profile tls up -d caddy
curl -k -I https://localhost:8443/login
```

`deploy/Caddyfile.local` 使用 `tls internal`，浏览器首次访问会提示证书不受信任；它只用于演练。

### Nginx

`deploy/nginx.conf` 提供 Let's Encrypt 证书路径、TLS 版本、`X-Forwarded-*` 和 WebSocket 升级示例。将域名和证书路径替换后，把 `proxy_pass` 指向 Web 的 `127.0.0.1:3000`。

### 安全头

应用通过 `apps/web/proxy.ts` 为页面和 API 设置：

- nonce-based CSP（脚本、样式、图片、连接、frame、form-action 限制）
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`
- 生产环境 `Strict-Transport-Security`（一年，includeSubDomains）

生产反向代理不要覆盖或删除这些响应头。HSTS 和 `upgrade-insecure-requests` 只在直接 HTTPS 或代理传入 `X-Forwarded-Proto: https` 时发送；Caddy 会自动设置，Nginx 示例也已设置。本地 HTTP 开发不会发送 HSTS。

然后：

- 设置页「站点地址」填 `https://radar.example.com`；
- GitHub Webhook 填 `https://radar.example.com/api/github/webhook`；
- 如果使用环境变量 `RADAR_BASE_URL`，它会覆盖页面设置。

不要把 PostgreSQL 的 `5433` 端口暴露到公网。Compose 默认只绑定 `127.0.0.1`。

## 5. worker 与 Docker 沙箱

worker 负责定时同步、邮件/推送投递，以及 patch / 依赖升级 / 仓库验证。后三者需要调用 Docker 构建不可信仓库代码，因此 Compose 把宿主机的 Docker socket 挂载给 worker：

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

这等价于给 worker 很高的宿主机权限。生产环境建议：

- worker 单独部署在一台隔离主机；
- 不要和数据库、内部服务共用宿主机；
- 只给 worker 访问 Docker socket，Web 不挂载；
- 在沙箱外再加网络出口限制和资源限制。

如果不需要 patch / 依赖升级 / 仓库验证，可以移除 worker 的 Docker socket 挂载。

## 6. 升级

```bash
git pull
docker compose build
docker compose up -d
```

`migrate` 服务只执行 `packages/core/src/db/migrations/` 中尚未应用的版本，并把版本和 checksum 记录到 `schema_migrations`。历史迁移文件被修改时会拒绝启动；升级前先备份数据库。

## 7. 备份与恢复

备份：

```bash
pnpm db:backup
```

会写入 `backups/repo-radar-<时间>.dump` 和对应的 `.sha256`。本机没有 `pg_dump` 时会自动使用 Compose 的 postgres 容器。

恢复前先确认当前数据库已有可恢复备份，然后执行：

```bash
CONFIRM=YES pnpm db:restore backups/repo-radar-<时间>.dump
```

恢复会清理并覆盖目标数据库中的对象。数据库数据保存在命名卷 `radar-pgdata` 中。

## 8. 停止

```bash
docker compose down
```

这会保留数据库卷。只有确认要删除全部数据时才使用：

```bash
docker compose down -v
```

## 9. 限流、配额与公测白名单

管理员可以在设置页「限流与配额」调整每用户每日 AI 调用/token、全站 token 预算、任务频率、Copilot 消息数和邮件/推送投递数。`0` 表示不限制；关闭「启用 AI 功能」会立即阻止新的 AI 任务和 Copilot 请求，GitHub 动态同步不受影响。

公测阶段建议在 `.env` 设置：

```dotenv
ALLOWED_LOGINS=alice,bob
```

设置后只有名单内的 GitHub 登录名可以登录，`ADMIN_LOGINS` 会自动包含。留空表示开放注册。

## 10. 数据保留

管理员在设置页「数据保留与自动清理」配置保留天数；worker 每天最多执行一次，也可以手动清理。`0` 表示永久保留。默认清理已读通知、已发送/失败投递、已完成任务、动态事件、LLM 用量、采集记录和验证记录；AI 生成内容和 Copilot 对话默认永久保留。多 worker 使用 PostgreSQL advisory lock 避免重复清理。

## 11. 监控与告警

设置 `METRICS_TOKEN` 后，Prometheus 可以抓取：

```yaml
scrape_configs:
  - job_name: repo-radar
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials: 你的 METRICS_TOKEN
    static_configs:
      - targets: ["127.0.0.1:3000"]
```

`/ops` 管理面板会显示任务、投递、token 用量、数据库大小、最近失败和告警记录。worker 每 5 分钟检查失败任务、失败投递、队列积压和心跳超时；告警邮件通过设置页的邮件通道发送，阈值和收件人可在 `/ops` 配置，也可以用 `ALERT_EMAILS` 指定。

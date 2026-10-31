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

## 4. 域名与反向代理

把域名指向服务器，用 Caddy / Nginx / Traefik 终止 TLS，并反代到 Web 的 3000 端口。Caddy 示例：

```caddyfile
radar.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

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

`migrate` 服务会重新运行一次 schema.sql；所有 DDL 都是幂等的。升级前先备份数据库。

## 7. 备份与恢复

备份：

```bash
docker compose exec -T postgres pg_dump -U radar radar > backup.sql
```

恢复：

```bash
cat backup.sql | docker compose exec -T postgres psql -U radar -d radar
```

数据库数据保存在命名卷 `radar-pgdata` 中。

## 8. 停止

```bash
docker compose down
```

这会保留数据库卷。只有确认要删除全部数据时才使用：

```bash
docker compose down -v
```

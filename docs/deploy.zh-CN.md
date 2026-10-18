[English](deploy.md) | 简体中文

> 本文为 [`deploy.md`](deploy.md) 的中文译本，以英文版为准。

# 部署 Keyhook-agent（演示环境）

目标：**Vercel**（Next.js 应用）+ **Neon**（Postgres）+ **Inngest Cloud**（工作流），全部使用免费额度，区域选悉尼
（离新西兰最近）。可选：**Sentry**（错误监控）、**Langfuse**（追踪）。
不要把任何 key 粘贴到聊天、issue 或提交里——只填到各平台的控制台或你本地的 `.env`。

## 1. Neon（数据库）
1. 在 https://neon.tech 用 GitHub 注册。
2. *New project* → 名称 `keyhook-agent`，Postgres 17，区域 **AWS Asia Pacific (Sydney)**。
3. 在 *Connection details* 中复制**两条**连接串——
   - **Pooled**（主机名包含 `-pooler`）→ Vercel 上应用的 `DATABASE_URL`。
   - **Direct**（不含 `-pooler`）→ 在你本机执行迁移和灌入种子数据时使用。

## 2. 迁移与种子数据（在你本机执行）
在终端里执行（这些值只存在于当前 shell 会话）：
```bash
export DATABASE_URL='<Neon DIRECT 连接串>'
pnpm exec tsx src/db/migrate.ts
ALLOW_REMOTE_SEED=true SEED_PM_PASSWORD='<一个强密码，至少 12 位>' pnpm exec tsx src/db/seed/index.ts
unset DATABASE_URL
```
灌入种子数据会先清空所有表；所有演示 PM 都用这个密码登录。迁移会创建行级安全使用的 `keyhook_app` 角色（Neon 的
owner 角色有权限创建）。

## 3. Vercel（应用）
1. 在 https://vercel.com 用 GitHub 注册。
2. *Add New → Project* → 导入 `river7god/keyhook-agent`（框架会自动识别）。
3. *Settings → Functions → Region*：选 **Sydney (syd1)**。
4. *Settings → Environment Variables*（Production）：

| 变量 | 值 |
|---|---|
| `DATABASE_URL` | Neon 的 **pooled** 连接串 |
| `ANTHROPIC_API_KEY` | 你的 Claude API key |
| `INNGEST_EVENT_KEY`、`INNGEST_SIGNING_KEY` | 由 Inngest 集成自动设置（第 4 步） |
| `SIMULATOR_MAX_MESSAGES_PER_HOUR` | 例如 `30` |
| `DAILY_LLM_BUDGET_USD` | 例如 `3` |
| `SENTRY_DSN` | 可选（第 5 步） |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`、`OTEL_EXPORTER_OTLP_TRACES_HEADERS` | 可选（第 6 步） |

生产环境**不要**设置 `INNGEST_DEV`。然后点 *Deploy*。

## 4. Inngest Cloud（工作流）
1. 在 https://www.inngest.com 用 GitHub 注册。
2. 最简单的方式：在 Vercel Marketplace 安装 **Inngest 集成**并关联项目——它会自动添加
   `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`，并在每次部署时同步应用。
   手动方式：从 Inngest 控制台复制这两个 key 到 Vercel，重新部署，然后在 *Apps → Sync new app* 填入
   `https://<你的域名>/api/inngest`。
3. 检查 *Functions*：`job-advance`、`follow-up-sweeper`（cron，每 5 分钟）、`follow-up-handle`、`system-ping`。

## 5. Sentry（可选）
1. 在 https://sentry.io 注册 → *Create project* → 平台选 **Next.js**。
2. 复制 **DSN**（`https://…@….ingest.sentry.io/…`），在 Vercel 中设为 `SENTRY_DSN`，重新部署。
服务端错误和 agent 故障会被上报；请求体、cookie 和用户信息都会被剔除。

## 6. Langfuse 追踪（可选）
在 https://cloud.langfuse.com 创建项目，然后在 Vercel 中设置：
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces` 和
`OTEL_EXPORTER_OTLP_TRACES_HEADERS=Authorization=Basic%20<publicKey:secretKey 的 base64>`。
用 `printf '%s' 'pk-lf-…:sk-lf-…' | base64` 生成这个值。保留 `%20`（header 的值需要 URL 编码，直接写空格会失效）。
美国区域请使用 `https://us.cloud.langfuse.com/…`。

## 7. GitHub（真实评测，可选）
仓库 *Settings → Secrets and variables → Actions* → 添加 `ANTHROPIC_API_KEY`。之后 *Eval* workflow 会每晚和按需运行。

## 7a. 访客体验入口（可选）

在 Vercel 中设置 `DEMO_GUEST_LOGIN=true`，首页和登录页就会出现 **Try the live demo** 按钮。审核者以共享的
"Guest reviewer" PM 身份进入演示公司（`DEMO_GUEST_ORG_SLUG`，默认 `harbour-city`）；这个账号第一次使用时自动创建，没有密码。
会话 2 小时过期；每个 IP 每小时最多 20 次访客登录；模拟器限流和 `DAILY_LLM_BUDGET_USD` 限制模型花费。私有部署不要设置它。

## 8. 验证
- `https://<域名>/api/v1/health` → `{"status":"ok","db":"ok"}`
- 用 `aroha@harbourcity.example.test` 和种子密码登录。
- 模拟器：以租客身份发送 "No hot water" → 一分钟内工单应进入 AWAITING_QUOTE；Inngest 中能看到运行记录。

**每次部署带有新迁移时**（`src/db/migrations/` 下出现新文件），都要再执行一次第 2 步的迁移命令（不要重跑种子数据）。数据库落后于代码时，
`/api/v1/health` 会返回 **503**，并显示 `"pending": N`——页面出现服务器错误时，先检查这里。

**排错：** 出现 `prepared statement … does not exist` → `DATABASE_URL` 必须是 pooled 主机（对 `-pooler` 主机会自动关闭
预编译语句，也可设置 `DATABASE_PREPARE=false`）。登录后到处都是 401 → 站点必须通过 HTTPS 访问（生产环境的会话 cookie
带 `Secure` 标志）。

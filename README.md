# GuGuDu / LinguaFlow 英语学习平台

GuGuDu 是一个围绕真实英文材料的学习平台。它把外刊阅读、划词翻译、词典、生词本、间隔复习、阅读进度、学习目标、AI 精读、TTS 朗读、RSS 内容导入和 AO3 公开作品阅读整合在同一个学习工作台里。

前端当前以 LinguaFlow 品牌展示，仓库和后端模块仍使用 GuGuDu 命名。

## 功能概览

- 文章阅读：精选文章、最近更新、分类/来源筛选、阅读进度、阅读历史、完读测验。
- 划词学习：选词/选句翻译、词典查询、上下文保存、生词本。
- 复习闭环：每日学习目标、待复习词、弱项词、简化 SRS 复习反馈。
- 内容来源：后台手动文章管理、RSS feed 导入、AO3 公开作品搜索与阅读代理。
- 会员能力：会员套餐、订单 demo 激活、AI 句子分析、文章助手等权限控制功能。
- 语音能力：TTS 音频生成、缓存和 `/api/tts/audio/:filename` 读取。
- 管理功能：管理员文章 CRUD、发布状态、精选状态、RSS 导入入口。

## 技术栈

### 后端

- Go 1.22
- Gin
- GORM + PostgreSQL
- Redis
- JWT
- TOML 配置
- Baidu / Youdao 翻译词典服务
- OpenAI-compatible AI / TTS 服务

### 前端

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Zustand
- Axios
- Radix UI primitives
- Lucide React

## 项目结构

```text
gugudu/
├── backend/
│   ├── main.go                  # 服务入口、路由注册、服务初始化
│   ├── config/                  # TOML 配置加载
│   ├── database/                # PostgreSQL / Redis 初始化与 seed
│   ├── handlers/                # Gin HTTP handlers
│   ├── middleware/              # JWT、管理员、会员权限中间件
│   ├── models/                  # GORM 模型
│   └── services/                # RSS、AO3、翻译、词典、AI、TTS 等服务
├── frontend/
│   ├── src/app/                 # Next.js App Router 页面
│   ├── src/components/          # 复用组件
│   ├── src/lib/                 # API client 和工具函数
│   ├── src/store/               # Zustand store
│   └── src/types/               # TypeScript 类型
├── docker-compose.yml           # 本地 PostgreSQL / Redis / 前后端编排
├── AGENTS.md                    # Agent 协作说明
├── CLAUDE.md                    # Claude Code 说明
└── GEMINI.md                    # Gemini 说明
```

## 快速开始

### 前置要求

- Go 1.22+
- Node.js 20+，本地开发 Node.js 18+ 通常也可运行
- PostgreSQL 15+
- Redis 7+
- Docker / Docker Compose 可选

### 1. 启动依赖

使用仓库已有 compose 文件启动完整服务：

```bash
docker compose up -d
```

默认端口：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8080`
- PostgreSQL：`localhost:5432`
- Redis：`localhost:6379`

只想本地运行前后端时，也可以单独启动数据库和 Redis：

```bash
docker run -d --name gugudu-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=gugudu \
  -p 5432:5432 \
  postgres:15-alpine

docker run -d --name gugudu-redis \
  -p 6379:6379 \
  redis:7-alpine
```

### 2. 配置后端

后端使用 `backend/config.toml`，不是 `.env`。

```bash
cd backend
cp config.toml.example config.toml
```

本地开发至少确认这些配置：

- `[database]`：PostgreSQL 主机、端口、用户、密码和库名。
- `[redis]`：Redis 主机、端口和密码。
- `[jwt] secret`：本地可使用任意非空字符串，生产环境必须替换。
- `[cors] allowed_origins`：默认允许 `http://localhost:3000`。

翻译、词典、AI、TTS 可不配置。缺少外部服务凭据时，相关功能会使用 mock/fallback 或返回受限结果。

### 3. 启动后端

```bash
cd backend
go mod download
go run main.go
```

健康检查：

```bash
curl http://localhost:8080/health
```

启动时会自动执行 GORM migration，并写入 demo seed 数据。

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端默认请求 `http://localhost:8080/api`。如需覆盖：

```bash
cat > frontend/.env.local <<'EOF'
NEXT_PUBLIC_API_URL=http://localhost:8080/api
EOF
```

## 常用命令

### 后端

```bash
cd backend
go mod download
go run main.go
go build ./...
go test ./...
```

### 前端

```bash
cd frontend
npm install
npm run dev
npm run lint
npm run build
npm run start
```

### Docker

```bash
docker compose up -d
docker compose logs -f backend
docker compose logs -f frontend
docker compose down
```

## 配置说明

后端配置模板在 `backend/config.toml.example`，Docker 环境使用 `backend/config.docker.toml` 挂载到容器内的 `/app/config.toml`。

主要配置块：

- `[database]`：PostgreSQL 连接。
- `[redis]`：Redis 连接。
- `[jwt]`：登录 token 签名密钥。
- `[server]`：端口和 Gin 模式。
- `[cors]`：允许的前端 origin，多个值用逗号分隔。
- `[translation]`：Baidu / Youdao 翻译和词典凭据。
- `[ai]`：OpenAI-compatible 句子分析和文章助手配置。
- `[tts]`：OpenAI-compatible TTS 配置和音频缓存目录。
- `[rss]` 与 `[[rss.feeds]]`：RSS 导入开关、代理、超时和 feed 列表。
- `[ao3]`：AO3 公开页面解析代理和超时。

不要提交 `config.toml`、真实 API key、JWT secret、数据库密码或其他敏感配置。

## 主要 API

公开接口：

```text
GET    /health
POST   /api/auth/register
POST   /api/auth/login
GET    /api/articles
GET    /api/articles/featured
GET    /api/articles/:slug
GET    /api/categories
GET    /api/rss/feeds
GET    /api/ao3/search
GET    /api/ao3/works/:id
POST   /api/translate
GET    /api/dictionary?word=example
GET    /api/tts/audio/:filename
```

登录后接口：

```text
GET    /api/profile
POST   /api/profile/avatar
GET    /api/subscriptions
POST   /api/subscriptions
DELETE /api/subscriptions/:article_id
GET    /api/history
POST   /api/articles/:id/progress
GET    /api/article-quizzes/:id
POST   /api/article-quizzes/:id/submit
GET    /api/article-completions/:id
POST   /api/tts
GET    /api/study/today
GET    /api/study/diagnostics
PUT    /api/study/goal
GET    /api/vocabulary
GET    /api/vocabulary/review-exercises
POST   /api/vocabulary
PATCH  /api/vocabulary/:id/learned
POST   /api/vocabulary/:id/review
POST   /api/vocabulary/:id/review-answer
```

会员相关接口：

```text
GET    /api/membership/info
GET    /api/membership/plans
GET    /api/membership/benefits
POST   /api/membership/orders
GET    /api/membership/orders
POST   /api/membership/orders/:order_no/activate
```

管理员接口：

```text
GET    /api/admin/articles
POST   /api/admin/articles
GET    /api/admin/articles/:id
PUT    /api/admin/articles/:id
DELETE /api/admin/articles/:id
PATCH  /api/admin/articles/:id/status
PATCH  /api/admin/articles/:id/featured
POST   /api/admin/rss/import
```

注意：`/api/admin/rss/import` 当前是本地/开发导入入口，生产环境使用前应补齐鉴权、限流和导入 token 校验。

## 开发约定

- 后端路由集中在 `backend/main.go` 注册，HTTP 逻辑放在 `backend/handlers/`。
- 外部服务和解析逻辑放在 `backend/services/`，优先给 RSS、AO3、翻译/词典、AI 序列化等边界逻辑补测试。
- GORM 模型集中在 `backend/models/models.go`，修改模型后确认 auto migration 行为。
- 前端 API 调用优先通过 `frontend/src/lib/api.ts` 暴露的 helper，不在页面里散落 Axios 调用。
- 前端页面放在 `frontend/src/app/`，复用组件放在 `frontend/src/components/`，共享类型放在 `frontend/src/types/`。
- UI 使用 TypeScript、React function components 和 Tailwind CSS，复杂交互优先沿用现有 Radix UI pattern。

## 验证

当前后端已有服务层测试，推荐在后端变更后运行：

```bash
cd backend
go test ./...
go build ./...
```

前端暂未引入单元测试 runner。前端变更至少运行：

```bash
cd frontend
npm run lint
npm run build
```

## 部署

仓库包含前后端 Dockerfile 和根目录 `docker-compose.yml`。本地或单机部署可直接使用：

```bash
docker compose up -d --build
```

生产部署前至少处理：

- 替换 JWT secret、数据库密码和第三方 API key。
- 收紧 CORS origin。
- 为 RSS/AO3 外部抓取增加鉴权、限流、缓存和响应体大小限制。
- 配置持久化卷和备份策略。
- 接入真实支付流程后再开放会员购买。

## 许可证

MIT

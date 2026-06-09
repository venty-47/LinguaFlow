# GuGuDu 英语学习平台 - 后端

基于 Golang + Gin + PostgreSQL + Redis 的英语学习资讯平台后端服务。

## 功能特性

- 📚 **文章管理**：支持分类、标签、难度分级
- 🔐 **用户认证**：JWT token 认证
- 📖 **阅读追踪**：阅读历史、进度记录
- 🔖 **订阅系统**：收藏感兴趣的文章
- 🌐 **翻译服务**：划词翻译、段落翻译
- 📝 **生词本**：保存学习的单词，支持复习
- 💾 **缓存优化**：Redis 缓存翻译结果

## 技术栈

- **框架**: Gin
- **数据库**: PostgreSQL (GORM)
- **缓存**: Redis
- **认证**: JWT
- **密码加密**: bcrypt

## 项目结构

```
backend/
├── main.go              # 主入口
├── config/              # 配置管理
├── database/            # 数据库连接
├── models/              # 数据模型
├── handlers/            # 请求处理
│   ├── auth.go         # 认证
│   ├── article.go      # 文章
│   ├── translation.go  # 翻译
│   └── user.go         # 用户
├── middleware/          # 中间件
└── .env.example         # 环境变量示例
```

## 快速开始

### 1. 安装依赖

```bash
cd backend
go mod download
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库和 Redis 连接
```

### 3. 启动 PostgreSQL 和 Redis

使用 Docker：

```bash
docker run -d --name postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=gugudu \
  -p 5432:5432 \
  postgres:15

docker run -d --name redis \
  -p 6379:6379 \
  redis:7
```

### 4. 运行服务

```bash
go run main.go
```

服务将在 `http://localhost:8080` 启动。

## API 端点

### 认证

- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 文章

- `GET /api/articles` - 获取文章列表（支持分页、筛选）
- `GET /api/articles/featured` - 获取精选文章
- `GET /api/articles/:slug` - 获取文章详情
- `GET /api/categories` - 获取分类列表

### 翻译

- `POST /api/translate` - 翻译文本
- `GET /api/dictionary?word=xxx` - 查词

### 用户（需认证）

- `GET /api/profile` - 获取用户信息
- `GET /api/subscriptions` - 获取订阅列表
- `POST /api/subscriptions` - 添加订阅
- `DELETE /api/subscriptions/:article_id` - 取消订阅
- `GET /api/history` - 获取阅读历史
- `POST /api/articles/:id/progress` - 更新阅读进度
- `GET /api/article-quizzes/:id` - 获取文章读后测验
- `POST /api/article-quizzes/:id/submit` - 提交文章读后测验

### 生词本（需认证）

- `GET /api/vocabulary` - 获取生词本
- `POST /api/vocabulary` - 添加单词
- `PATCH /api/vocabulary/:id/learned` - 标记已掌握

## 数据模型

### User（用户）

- 基本信息：用户名、邮箱、密码、头像
- 会员状态：是否高级会员
- 学习统计：阅读时长、已读文章数、已学单词数

### Article（文章）

- 内容：标题、摘要、正文（英文+中文）
- 元数据：分类、标签、来源、作者、发布时间
- 阅读信息：难度级别、字数、预估阅读时间、浏览量

### Vocabulary（生词本）

- 单词信息：音标、释义、翻译、例句
- 学习信息：上下文、是否掌握、复习次数

### TranslationCache（翻译缓存）

- 源文本、目标语言、翻译结果

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| DB_HOST | 数据库主机 | localhost |
| DB_PORT | 数据库端口 | 5432 |
| DB_USER | 数据库用户 | postgres |
| DB_PASSWORD | 数据库密码 | postgres |
| DB_NAME | 数据库名 | gugudu |
| REDIS_HOST | Redis 主机 | localhost |
| REDIS_PORT | Redis 端口 | 6379 |
| JWT_SECRET | JWT 密钥 | your-secret-key |
| PORT | 服务端口 | 8080 |
| ALLOWED_ORIGINS | CORS 允许源 | http://localhost:3000 |

## 开发建议

### 接入真实翻译 API

当前翻译功能使用模拟数据，建议接入：

- **Google Translate API**
- **DeepL API**
- **百度翻译 API**
- **有道翻译 API**

### 接入词典 API

当前词典查询使用模拟数据，建议接入：

- **有道词典 API**
- **金山词霸 API**
- **Oxford Dictionary API**

## 部署

### 构建

```bash
CGO_ENABLED=0 GOOS=linux go build -o gugudu-backend
```

### Docker

创建 `Dockerfile`：

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -o gugudu-backend

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/gugudu-backend .
EXPOSE 8080
CMD ["./gugudu-backend"]
```

构建并运行：

```bash
docker build -t gugudu-backend .
docker run -p 8080:8080 --env-file .env gugudu-backend
```

## License

MIT

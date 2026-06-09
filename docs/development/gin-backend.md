# Gin 后端开发规范

本规范适用于 `backend/` 下的 Go 1.22 + Gin + GORM + PostgreSQL + Redis 服务。

## 1. 目录职责

### `main.go`

只负责启动编排：

- 加载配置。
- 初始化数据库、Redis、JWT、外部服务。
- 注册 Gin middleware、静态资源、路由组。
- 启动 HTTP 服务。

禁止在 `main.go` 写业务逻辑、数据库查询、外部 API 调用。路由数量继续增加时，应提取 `routes/` 或按领域拆分注册函数，但不要把 handler 内联到 `main.go`。

### `handlers/`

负责 HTTP 层：

- 从 `gin.Context` 读取 path/query/body/header/user context。
- 调用 service 或 GORM 查询。
- 做请求校验和权限边界判断。
- 返回统一 JSON 响应。

handler 可以包含简单查询，但出现以下情况必须下沉到 `services/`：

- 逻辑超过一个清晰业务步骤。
- 涉及外部 HTTP、HTML/XML/JSON 解析、缓存、重试、限流。
- 同一逻辑被两个以上 handler 或前端流程复用。
- 需要独立单元测试保护。

### `services/`

负责业务逻辑和外部能力：

- 翻译、词典、AI、TTS、RSS、AO3 等外部服务调用。
- HTML/XML/JSON 解析、内容清洗、缓存策略。
- 不依赖 Gin，不直接读写 `gin.Context`。
- 可接收 `*gorm.DB`、配置、HTTP client 或参数结构，返回 Go 结构和 `error`。

service 必须尽量可测试；复杂 service 需要添加同目录 `_test.go`。

### `models/`

负责 GORM 模型和数据库字段定义：

- 字段名、JSON tag、索引、唯一约束在这里维护。
- 关联关系必须明确 `foreignKey`。
- 不放 handler 逻辑、不放外部 API 逻辑。

修改模型时必须考虑：

- 是否需要唯一索引或组合索引。
- 是否影响已有 auto migration。
- 是否需要前端类型同步。
- 是否涉及软删除查询条件。

### `middleware/`

只放跨接口能力：

- JWT 鉴权。
- Admin / Premium 权限。
- CORS、安全 header、限流等。

middleware 不应包含具体业务流程。

### `config/` 和 `database/`

- `config/` 只负责 TOML 配置结构、默认值、加载。
- `database/` 只负责 PostgreSQL / Redis 初始化、关闭、基础 seed。
- 新配置必须同步 `config.toml.example` 和必要说明。

## 2. 路由规范

### 路由分组

路由必须按权限和业务域分组：

- 公开接口：`/api/articles`、`/api/categories`、`/api/translate` 等。
- 登录接口：挂在 `protected := api.Group("")` 并使用 `AuthRequired()`。
- 管理接口：挂在 `/api/admin` 并使用 `AuthRequired()` + `AdminRequired()`。
- 会员接口：在对应路由使用 `PremiumRequired(database.DB)`。

禁止新增“看起来像 admin 但没有 admin middleware”的接口。定时任务或脚本接口如果不适合用户 JWT，必须使用明确的 token middleware，并在配置中声明 token 来源。

### URL 和方法

- 列表：`GET /api/<resources>`。
- 详情：`GET /api/<resources>/:id` 或稳定 slug。
- 创建：`POST /api/<resources>`。
- 整体更新：`PUT /api/<resources>/:id`。
- 局部状态更新：`PATCH /api/<resources>/:id/<state>`。
- 删除：`DELETE /api/<resources>/:id`。
- 动作类接口：`POST /api/<resources>/:id/<action>`。

路径使用小写 kebab-case，JSON 字段使用 snake_case，Go 字段使用 PascalCase。

## 3. Handler 写法

### 请求结构

导出的请求/响应结构使用领域前缀，例如：

```go
type ArticleCreateRequest struct {
    Title string `json:"title" binding:"required"`
}
```

只在非常小且不会复用的场景使用匿名 request struct。响应结构如果被前端依赖，必须显式定义或与 model/DTO 保持清晰映射。

### 参数校验

- `page`、`page_size` 必须设置默认值和上限，避免一次拉取过大。
- ID 参数转换失败要返回 400，不要默默变成 0。
- 外部输入字符串需要 `strings.TrimSpace`。
- 用户可控 URL、HTML、文件名、路径必须校验或清洗。

### 响应格式

成功：

```go
c.JSON(http.StatusOK, gin.H{"data": result})
```

列表：

```go
c.JSON(http.StatusOK, gin.H{
    "data": items,
    "pagination": gin.H{
        "page": page,
        "page_size": pageSize,
        "total": total,
        "total_page": totalPage,
    },
})
```

错误：

```go
c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
```

不要把内部堆栈、数据库连接信息、第三方密钥、完整外部响应直接返回给前端。开发期需要定位时使用日志。

## 4. 数据库规范

### 查询

- 列表查询必须有排序。
- 面向用户数据必须带 `user_id` 条件，不能只按资源 ID 查询。
- 读取关联数据使用必要的 `Preload`，避免无意返回巨大对象。
- 计数更新优先使用 `UpdateColumn` + SQL 原子表达式，不先读再写。

### 事务

以下场景必须使用事务：

- 同一请求写多张表且要求一致性。
- 创建订单、激活会员、更新学习记录、更新统计计数。
- 先查后改且并发重复请求会导致错误结果。

### 索引和唯一约束

用户关系表应优先加组合唯一约束，例如：

- `user_id + article_id` 的订阅和阅读历史。
- `user_id + word` 的生词。

只加普通组合索引不能防止重复记录；如果业务要求唯一，必须使用 `uniqueIndex`。

## 5. Service 和外部 HTTP 规范

外部调用必须具备：

- 明确 timeout，不能使用无超时默认 client。
- 响应体大小限制，尤其是 RSS、AO3、HTML 抓取、TTS、AI。
- 错误包装，保留 provider 名称和关键上下文。
- 必要缓存，避免重复请求外部服务。
- 对用户输入参与的 URL、query、prompt 做长度限制。

解析外部 HTML 时：

- 只保留业务需要字段。
- 返回给前端的 HTML 必须清洗。
- 不信任外部脚本、style、form、事件属性。
- parser 行为必须用测试覆盖典型样本和异常样本。

## 6. 认证和权限

- 不从请求 body 接受 `user_id` 作为当前用户；必须从 JWT middleware 的 context 中取。
- admin 接口必须同时要求登录和 admin。
- premium 功能必须在路由层或 handler 开头明确校验。
- 401 用于未登录或 token 无效，403 用于已登录但权限不足。
- 登录、注册、头像上传、TTS、AI 等接口要考虑频率和输入大小限制。

## 7. 配置规范

- 后端统一使用 TOML 配置。
- 新增配置字段时同步：
  - `backend/config/config.go`
  - `backend/config.toml.example`
  - `backend/config.docker.toml` 如 Docker 启动依赖该字段
  - 相关 README 或说明文档
- 默认值必须适合本地开发，但生产敏感项不能有弱默认值。
- secret、token、API key 不写入日志。

## 8. 日志和错误

- 用户可理解错误返回给前端。
- 内部错误写日志，但避免打印密钥和完整 token。
- 外部 provider 错误要标明 provider、endpoint 类型和请求用途。
- 不使用 `panic` 处理普通请求错误。
- 启动阶段初始化失败可以 `log.Fatal`。

## 9. 测试规范

必须优先给以下代码加测试：

- RSS、AO3、文章解析等 parser。
- AI/TTS/翻译 prompt 或响应解析。
- SRS 生词复习算法。
- 会员、订单、权限、学习统计等状态变更。
- bug 修复对应的回归用例。

测试命令：

```bash
cd backend
go test ./...
go build ./...
```

测试文件放在实现旁边，命名为 `*_test.go`。外部 API 测试必须 mock，不依赖真实第三方服务。

## 10. 后端改动检查清单

提交后端改动前确认：

- 新路由放在正确权限组。
- handler 没有塞入大段外部调用或复杂解析。
- 响应结构与前端读取方式一致。
- 数据查询带了必要的 user/admin/premium 限制。
- 输入有默认值、上限和格式校验。
- 新模型字段同步了前端类型和配置文档。
- 外部调用有 timeout、大小限制和错误处理。
- 已运行 `go test ./...`，必要时运行 `go build ./...`。

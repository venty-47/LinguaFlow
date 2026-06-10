# GuGuDu 开发规范总览

这组规范用于约束后续人工和 AI 对本项目的改动。目标不是增加流程负担，而是让 Gin 后端、Next.js 前端和前后端 API 边界长期可维护。

## 适用范围

- 后端 Gin 服务：见 [Gin 后端开发规范](./gin-backend.md)。
- 前端 Next.js App Router 应用：见 [Next.js 前端开发规范](./nextjs-frontend.md)。
- 背单词功能：见 [背单词功能实现文档](./vocabulary-learning.md)。
- 英文视频学习功能：见 [英文视频学习功能实现文档](./video-learning.md)。
- YouTube 字幕机制调研：见 [YouTube 字幕功能技术调研](./youtube-caption-technology.md)。
- 根目录协作约定、构建命令、提交说明：见 [AGENTS.md](../../AGENTS.md)。

## 必须先读的文件

开始改代码前，按改动范围阅读：

1. 任意改动：`AGENTS.md`、本文件。
2. 后端改动：`docs/development/gin-backend.md`、`backend/main.go`、相关 `handlers/`、`services/`、`models/` 文件。
3. 前端改动：`docs/development/nextjs-frontend.md`、`frontend/src/lib/api.ts`、相关 `app/`、`components/`、`types/` 文件。
4. 跨端接口改动：同时阅读后端 handler/model 和 `frontend/src/types/index.ts`、`frontend/src/lib/api.ts`。

## 通用维护原则

### 1. 小步、同域、可验证

- 一次改动只解决一个明确问题，不顺手重构无关文件。
- 新功能必须落在对应业务域内，不把逻辑塞进“刚好能调用”的文件。
- 改完必须运行与改动匹配的验证命令，并在交付说明里写明。

### 2. 分层边界优先于快速堆代码

- HTTP 参数解析、鉴权上下文、响应组装属于 handler/page 边界。
- 业务规则、外部 API、解析、缓存、复杂计算属于 service/lib/hook。
- 数据结构和跨端 DTO 必须集中定义，避免页面或 handler 里散落匿名结构。

### 3. API 合同必须稳定

- 新增或修改接口时，同步更新后端响应、前端 API helper、TypeScript 类型、调用页面。
- 响应结构优先使用 `{ "data": ... }`，列表接口带 `pagination`。
- 错误响应优先使用 `{ "error": "可读错误信息" }`，不要混用多种错误字段。

### 4. 配置和密钥不得硬编码

- 后端配置使用 `backend/config.toml`，模板在 `backend/config.toml.example`。
- 前端公开配置只允许使用 `NEXT_PUBLIC_*`。
- 不提交 `.env`、`config.toml`、JWT secret、数据库密码、第三方 API key。

### 5. AI 生成代码检查要求

AI 生成或大幅改写代码后，必须人工或 agent 做以下检查：

- 是否把后端逻辑放进了正确的 `handlers/`、`services/`、`models/`、`middleware/`。
- 是否把前端请求集中到了 `frontend/src/lib/api.ts` 或专门 lib 文件。
- 是否新增了重复的大段阅读器、翻译、TTS、词汇处理逻辑。
- 是否同步了 TypeScript 类型和 Go JSON 字段。
- 是否处理了 loading、error、empty、unauthorized 等状态。
- 是否有相应测试或至少运行了构建、lint、类型检查。

## 推荐验证命令

后端：

```bash
cd backend
go test ./...
go build ./...
```

前端：

```bash
cd frontend
npm run lint
npm run build
```

如果只改文档，可不运行构建命令，但需要说明“仅文档改动，未运行构建”。

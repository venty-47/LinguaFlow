# Next.js 前端开发规范

本规范适用于 `frontend/` 下的 Next.js 14 App Router + TypeScript + Tailwind CSS + Zustand 应用。

## 1. 目录职责

### `src/app/`

只放路由页面、布局和路由级 loading/error/not-found。

页面组件负责：

- 读取路由参数。
- 组织页面级数据加载。
- 组合业务组件。
- 处理页面级跳转和权限入口。

页面不应长期承载大量业务逻辑。单个页面出现以下情况时必须拆分：

- 超过约 300 行。
- 同时包含数据请求、文本解析、TTS、翻译、AI、弹窗、复杂表单。
- 同一逻辑在文章阅读页和 AO3 阅读页重复。
- state 数量过多，导致行为难以定位。

### `src/components/`

放可复用 UI 和业务组件：

- 文件名 PascalCase，例如 `ArticleCard.tsx`。
- 组件 props 必须显式声明 interface/type。
- 纯展示组件不直接请求 API。
- 复杂交互组件可以接收 handler 或使用专门 hook。

### `src/lib/`

放 API client、业务工具、纯函数：

- `api.ts` 是站内后端 API 主边界。
- 其他领域 helper 可以拆成 `ao3.ts`、`reading.ts`、`format.ts` 等。
- 纯函数必须不依赖 React state，方便测试和复用。

### `src/store/`

放 Zustand 全局状态：

- 只存跨页面共享状态，如 auth、主题、长期用户偏好。
- 不把单页面 loading、form、tooltip、modal 状态放进全局 store。
- persist store 必须有清理路径，避免 token 和 UI 状态漂移。

### `src/types/`

放跨页面共享类型和后端 DTO 镜像：

- 后端 JSON 字段是 snake_case，前端类型保持 snake_case，避免映射层混乱。
- 修改后端 model/response 时必须同步这里。
- 页面内部临时类型可以放在页面文件附近，但跨两个文件使用就应提升到 `types/` 或领域 lib。

## 2. App Router 规范

### Server / Client 组件

- 默认优先使用 Server Component。
- 只有需要 `useState`、`useEffect`、浏览器 API、事件处理、Zustand 的组件才加 `'use client'`。
- 不要因为父页面是 client 就把所有子组件都写成 client；可拆出纯展示组件。

当前项目很多页面是重交互 client 页面。新增功能时应控制 client 边界，避免把无交互展示也绑进大 client bundle。

### 数据加载

- 登录用户数据和需要 token 的请求通常在 client 侧通过 `src/lib/api.ts` 调用。
- 公开、可缓存、无需 token 的数据可以考虑 Server Component 获取，但必须保证 base URL 和错误处理清晰。
- 同一页面多个独立请求可以 `Promise.all`，但错误文案要能说明哪个业务区域失败。

### 路由和跳转

- 内部链接使用 `next/link`。
- 编程式跳转使用 `useRouter`。
- 登录保护页面必须处理 mounted/hydration，避免未恢复 auth store 时闪跳。

## 3. API 调用规范

### 必须集中到 API helper

禁止在页面或组件中散落 Axios URL 字符串。普通后端接口必须通过 `frontend/src/lib/api.ts` 中的领域 API 对象调用，例如：

- `articleAPI`
- `translationAPI`
- `vocabularyAPI`
- `studyAPI`
- `membershipAPI`
- `adminArticleAPI`
- `ao3API`

如果必须使用 `fetch` 做流式响应，也要在 `lib/api.ts` 或领域 lib 中封装，统一 token、base URL 和错误处理。

### 响应读取

优先保持后端响应结构：

- 单资源：`response.data.data`
- 列表：`response.data.data` + `response.data.pagination`
- 错误：`error.response?.data?.error`

不要在不同页面发明新的 response shape。后端接口变更时，必须同步所有调用方。

### 认证状态

- token 来源应与 `useAuthStore` 保持一致。
- logout 或 401 时必须清理 token、user 和 persist auth store。
- 不在组件中手写 Authorization header，除非通过统一 helper。
- 不从前端传 `user_id` 代表当前用户。

## 4. TypeScript 规范

- 保持 `strict: true`。
- 禁止新增无必要的 `any`。捕获 Axios 错误时优先定义窄类型或封装错误提取函数。
- props、API 参数、API 响应必须有类型。
- union 类型用于枚举值，例如 difficulty、membership tier、review rating。
- 不用 `as unknown as` 绕过类型问题，除非在边界层并有明确说明。

后端字段改名、增加、删除时，同步：

- `frontend/src/types/index.ts`
- `frontend/src/lib/api.ts` 参数和返回读取
- 受影响页面和组件

## 5. 页面和组件拆分规范

### 页面文件

页面文件建议保留：

- 路由参数读取。
- 页面级状态。
- 页面级数据加载。
- 页面布局组合。

以下逻辑应拆出：

- 文本切分、分词、句子队列：`src/lib/reading.ts` 或类似文件。
- 翻译 tooltip、查词、生词操作：业务组件或 hook。
- TTS 播放队列：`useTTSPlayer` 之类 hook。
- AI prompt 构造：纯函数或领域 lib。
- 大块重复 UI：独立组件。

### 阅读器类功能

文章阅读页和 AO3 阅读页是项目核心，新增功能必须优先复用共同能力：

- 句子切分。
- 单词 normalize 和点击取词。
- 选区翻译。
- 段落翻译。
- 生词高亮和保存。
- TTS 句子队列。
- AI 精读 prompt。

禁止复制一套相似逻辑到另一个阅读器页面。确实差异很大时，也要先抽出共享纯函数，再保留页面差异。

### 组件 props

- props 命名表达业务含义，不使用 `data`、`item` 贯穿多层。
- 回调使用动词短语，例如 `onSaveWord`、`onPlaySentence`。
- 组件不要直接修改父组件状态对象；通过回调提交意图。

## 6. UI 和 Tailwind 规范

- 使用 Tailwind utility，避免散落 inline style；动态宽度、进度条等必要场景除外。
- 复杂交互优先使用已安装 Radix primitives。
- 图标优先使用 `lucide-react`。
- 保持移动端优先，至少检查手机和桌面布局。
- 交互元素必须有清晰 hover/focus/disabled/loading 状态。
- 文本按钮和图标按钮要有足够点击区域。
- 不把页面 section 过度包成嵌套 card；card 用于重复条目、工具面板、弹窗。

当前项目整体偏深色 UI。新增页面应复用现有颜色、边框、间距，不引入完全不同的视觉系统。

## 7. 表单和状态规范

- 表单提交必须处理 loading，防止重复提交。
- 后端错误展示给用户时使用可读中文文案。
- 页面数据加载必须覆盖 loading、error、empty、success。
- 删除、激活、支付、会员、admin 状态变更等危险动作需要明确确认或清晰反馈。
- 输入值发送前做 trim 和基础校验，后端仍必须做最终校验。

## 8. 安全规范

- 不使用未清洗的 `dangerouslySetInnerHTML`。
- 外部 HTML 必须由后端清洗；前端仍要限制可渲染范围。
- 外部图片 URL 使用 `resolveAPIAssetURL` 或明确配置的 Next image domain 策略。
- 不在前端暴露非公开 API key。
- 不把 token 打印到 console。
- 用户生成内容进入 Markdown/HTML 渲染时必须确认清洗策略。

## 9. 性能规范

- 大列表必须分页或限制数量。
- 滚动进度、阅读计时、TTS 状态更新要节流或只在 checkpoint 同步。
- 派生数据使用 `useMemo`，但不要滥用。
- 事件 handler 传给深层 memo 组件时使用 `useCallback`。
- 大页面拆分后，非首屏重组件可以按需 dynamic import。
- 图片使用 `next/image`，外部无法优化时明确 `unoptimized` 的原因。

## 10. 测试和验证

当前前端未配置测试 runner。改动验证至少运行：

```bash
cd frontend
npm run lint
npm run build
```

如果新增测试框架，必须同步：

- `frontend/package.json` scripts。
- 本规范的测试命令。
- PR/交付说明中的验证方式。

对核心纯函数，例如阅读文本切分、单词 normalize、API response transform，新增测试 runner 后应优先补测试。

## 11. 前端改动检查清单

提交前端改动前确认：

- 页面没有继续堆叠可抽离的大段逻辑。
- API 请求集中在 `src/lib/api.ts` 或领域 lib。
- 类型与后端 JSON 字段同步。
- 登录、401、权限不足有处理。
- loading、error、empty、success 状态齐全。
- 移动端和桌面布局没有明显溢出或重叠。
- 没有新增不必要的 `any`、inline style、重复阅读器逻辑。
- 已运行 `npm run lint`，必要时运行 `npm run build`。

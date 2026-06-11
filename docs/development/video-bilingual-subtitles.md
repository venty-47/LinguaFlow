# 视频双语字幕功能实现文档

本文说明如何在当前 GuGuDu 视频学习模块中实现双语字幕：自动识别英文字幕后批量生成中文翻译，并在视频播放页支持原文、译文、双语三种显示模式。

相关总设计见 [英文视频学习功能实现文档](./video-learning.md)。后端改动必须遵守 [Gin 后端开发规范](./gin-backend.md)，前端改动必须遵守 [Next.js 前端开发规范](./nextjs-frontend.md)。

## 1. 当前基础

当前代码已经具备双语字幕的主要数据基础：

- `backend/models/models.go` 中 `VideoSubtitle` 已有 `Text` 和 `Translation` 字段。
- `backend/services/video_learning.go` 已能从 ASR transcript 生成 `VideoSubtitle` rows。
- `backend/handlers/video_learning.go` 已提供字幕列表和 WebVTT 输出接口。
- `frontend/src/types/index.ts` 的 `VideoSubtitle` 已有 `translation?: string`。
- `frontend/src/app/study/videos/[id]/page.tsx` 已能按播放时间高亮英文字幕。

当前缺口：

- 后端没有批量翻译字幕接口。
- 后端没有字幕文本和译文编辑接口。
- `SubtitlesToVTT` 只输出英文原文。
- 前端播放器只显示 `subtitle.text`，没有原文/译文/双语切换。
- 字幕列表未展示 `translation`。

结论：MVP 不需要新建字幕表，直接复用 `video_subtitles.translation` 落地；后续需要多语种、多版本、多轨道时再拆 `VideoSubtitleTrack`。

## 2. 产品目标

MVP 目标：

- 视频自动字幕生成完成后，用户可以一键生成中文字幕。
- 播放器支持三种字幕模式：英文、中文、双语。
- 字幕列表展示英文原文和中文译文。
- 当前字幕、右侧字幕列表、点击跳转、单句循环都保持正常。
- 翻译结果保存到数据库，避免每次播放实时请求翻译。
- 用户可以编辑英文原文和中文译文。

非目标：

- MVP 不做逐词时间轴高亮。
- MVP 不做多中文版本对照。
- MVP 不做实时边播边翻译。
- MVP 不把中文翻译作为 ASR 结果的一部分；ASR 只负责原文识别。

## 3. 数据模型

MVP 沿用现有 `VideoSubtitle`：

```go
type VideoSubtitle struct {
    VideoLessonID uint    `json:"video_lesson_id"`
    SortOrder     int     `json:"sort_order"`
    StartSeconds  float64 `json:"start_seconds"`
    EndSeconds    float64 `json:"end_seconds"`
    Text          string  `json:"text"`
    Translation   string  `json:"translation"`
    Confidence    float64 `json:"confidence"`
    Source        string  `json:"source"`
}
```

建议新增约束和索引：

- `video_lesson_id + sort_order` 加唯一约束，避免重复 cue。
- 翻译为空字符串表示“未翻译”。
- 英文原文或译文被用户修改后，`source` 更新为 `edited`。

后续扩展多语言时再加：

```go
type VideoSubtitleTrack struct {
    VideoLessonID uint
    Language      string // en, zh, ja
    Kind          string // original, translation, bilingual
    Source        string // auto, manual, imported
}
```

## 4. 后端接口

所有接口挂在已登录的 `/api/video-lessons` 路由组下，并且所有查询必须带 `user_id` 权限边界。

### 4.1 批量翻译字幕

```http
POST /api/video-lessons/:id/subtitles/translate
Content-Type: application/json

{
  "target_lang": "zh",
  "source_lang": "en",
  "force": false
}
```

字段说明：

- `target_lang` 默认 `zh`。
- `source_lang` 默认 lesson 的 `language`，为空时使用 `en`。
- `force=false` 时只翻译 `translation` 为空的字幕。
- `force=true` 时重翻所有字幕，适合用户更换翻译风格或修复早期结果。

响应：

```json
{
  "data": {
    "translated": 42,
    "skipped": 8,
    "failed": 0
  }
}
```

实现位置：

- Handler：`backend/handlers/video_learning.go`
- Service：`backend/services/video_learning.go` 或拆到 `backend/services/video_subtitle_translation.go`
- 路由：`backend/main.go`
- 前端 API：`frontend/src/lib/api.ts`

路由建议：

```go
videoLessons.POST("/:id/subtitles/translate", handlers.TranslateVideoSubtitles)
```

### 4.2 更新单条字幕

```http
PATCH /api/video-lessons/:id/subtitles/:subtitle_id
Content-Type: application/json

{
  "start_seconds": 12.34,
  "end_seconds": 15.67,
  "text": "This is the original subtitle.",
  "translation": "这是中文字幕。"
}
```

校验规则：

- 先按 `lesson_id + user_id` 确认视频归属。
- 再按 `subtitle_id + video_lesson_id` 查询字幕。
- `end_seconds` 必须大于 `start_seconds`。
- `text` 不能为空。
- `translation` 可为空。
- 更新后 `source=edited`。

### 4.3 WebVTT 输出

当前接口：

```http
GET /api/video-lessons/:id/subtitles.vtt
```

建议扩展：

```http
GET /api/video-lessons/:id/subtitles.vtt?track=en
GET /api/video-lessons/:id/subtitles.vtt?track=zh
GET /api/video-lessons/:id/subtitles.vtt?track=bilingual
```

输出规则：

- `track=en`：只输出英文 `text`。
- `track=zh`：优先输出 `translation`，没有翻译时跳过或回退英文。
- `track=bilingual`：同一个 cue 输出两行，第一行英文，第二行中文。

播放器学习页仍推荐用结构化 JSON 自绘字幕；WebVTT 主要用于浏览器原生字幕、导出和兼容场景。

## 5. 翻译服务设计

### 5.1 复用现有翻译能力

优先复用现有 translation service，不在视频模块里新建第三方翻译 client。

推荐 service 方法：

```go
type VideoSubtitleTranslateRequest struct {
    TargetLang string `json:"target_lang"`
    SourceLang string `json:"source_lang"`
    Force      bool   `json:"force"`
}

type VideoSubtitleTranslateResult struct {
    Translated int `json:"translated"`
    Skipped    int `json:"skipped"`
    Failed     int `json:"failed"`
}
```

核心流程：

1. 校验 lesson 归属。
2. 查询字幕列表，按 `sort_order ASC`。
3. 过滤空原文、已有翻译且 `force=false` 的字幕。
4. 分批翻译，每批 20 到 50 条。
5. 把翻译结果按 subtitle id 更新回 `translation`。
6. 返回统计结果。

### 5.2 批量翻译格式

如果现有翻译服务只支持单文本翻译，MVP 可以串行或小并发调用，但必须限制数量和超时。

如果接入 AI 批量翻译，prompt 必须要求返回稳定 JSON：

```json
{
  "translations": [
    { "id": 101, "translation": "大家好，欢迎回来。" },
    { "id": 102, "translation": "今天我们要讨论一个问题。" }
  ]
}
```

不要只按数组位置盲目写库；应同时带 `id`，并校验返回数量和 id 是否匹配。

### 5.3 成本和限流

视频字幕可能有数百条 cue，必须做限制：

- 单次最多处理 1000 条字幕。
- 每批 20 到 50 条。
- 每批失败可重试 1 次。
- HTTP client 使用明确 timeout。
- 失败时保留已成功写入的翻译，不回滚整段视频。
- 不把完整字幕内容或 API key 打进日志。

## 6. 前端交互

### 6.1 字幕显示模式

在 `frontend/src/app/study/videos/[id]/page.tsx` 增加状态：

```ts
type SubtitleDisplayMode = 'en' | 'zh' | 'bilingual' | 'off';

const [subtitleMode, setSubtitleMode] = useState<SubtitleDisplayMode>('bilingual');
```

播放器叠加层显示规则：

- `off`：不显示字幕。
- `en`：显示 `activeSubtitle.text`。
- `zh`：显示 `activeSubtitle.translation`，为空时显示“未生成翻译”或回退英文。
- `bilingual`：上方英文，下方中文；中文为空时只显示英文。

字幕列表显示规则：

- 始终展示英文原文，便于查词。
- 有中文翻译时在英文下方展示。
- 当前字幕高亮时，英文和中文都必须保持可读对比度。

### 6.2 生成翻译按钮

在详情页操作区增加按钮：

- 文案：`生成双语字幕`
- loading 文案：`翻译中`
- disabled 条件：lesson 未 ready、字幕为空、请求中。

交互：

1. 点击后调用 `videoLessonAPI.translateSubtitles(lesson.id, { target_lang: 'zh' })`。
2. 成功后重新请求 `getSubtitles`。
3. 如果部分失败，展示后端返回统计。
4. 不阻塞视频播放。

### 6.3 编辑字幕

MVP 可以先做简单 inline 编辑：

- 每条字幕右侧放编辑按钮。
- 弹窗或展开表单编辑 `text`、`translation`、`start_seconds`、`end_seconds`。
- 保存调用 `PATCH /api/video-lessons/:id/subtitles/:subtitle_id`。
- 保存成功后更新本地 subtitles 数组。

编辑前端校验：

- 英文原文不能为空。
- 结束时间必须大于开始时间。
- 时间不能小于 0。
- 中文翻译可为空。

## 7. 前端 API 和类型

`frontend/src/lib/api.ts` 增加：

```ts
translateSubtitles: (
  id: number,
  data: { target_lang?: string; source_lang?: string; force?: boolean }
) => api.post(`/video-lessons/${id}/subtitles/translate`, data),

updateSubtitle: (
  lessonId: number,
  subtitleId: number,
  data: Partial<Pick<VideoSubtitle, 'start_seconds' | 'end_seconds' | 'text' | 'translation'>>
) => api.patch(`/video-lessons/${lessonId}/subtitles/${subtitleId}`, data),

getSubtitleVTTURL: (id: number, track: 'en' | 'zh' | 'bilingual' = 'en') =>
  `${API_URL}/video-lessons/${id}/subtitles.vtt?track=${track}`,
```

`frontend/src/types/index.ts` 可新增：

```ts
export type SubtitleDisplayMode = 'en' | 'zh' | 'bilingual' | 'off';

export interface VideoSubtitleTranslateResult {
  translated: number;
  skipped: number;
  failed: number;
}
```

## 8. 推荐实现步骤

### Phase 1: 后端翻译闭环

- 新增 `POST /api/video-lessons/:id/subtitles/translate`。
- 复用现有翻译 service 批量填充 `VideoSubtitle.Translation`。
- 添加 `PATCH /api/video-lessons/:id/subtitles/:subtitle_id`。
- 扩展 `.vtt?track=en|zh|bilingual`。

验证：

```bash
cd backend
go test ./...
go build ./...
```

### Phase 2: 前端双语展示

- 在视频详情页增加字幕模式切换。
- 播放器叠加层支持英文、中文、双语、关闭。
- 字幕列表展示译文。
- 增加“生成双语字幕”按钮。
- `videoLessonAPI` 同步新增接口。

验证：

```bash
cd frontend
npm run lint
npm run build
```

### Phase 3: 编辑和体验优化

- 增加字幕编辑 UI。
- 增加重翻译 `force=true`。
- 空翻译 cue 提供单条翻译入口。
- 长字幕在移动端自动换行，避免遮挡播放控件。

## 9. 测试建议

后端测试：

- 不能翻译他人的 video lesson。
- `force=false` 跳过已有翻译。
- `force=true` 覆盖已有翻译。
- 翻译失败时返回统计，不泄露 provider 原始敏感响应。
- `track=bilingual` 的 VTT 同一 cue 输出英文和中文。
- `PATCH subtitle` 校验时间和归属。

前端验证：

- 没有翻译时，双语模式不报错。
- 生成翻译后列表和当前字幕立即显示中文。
- 切换 `en`、`zh`、`bilingual`、`off` 不影响播放。
- 单句循环仍按原字幕时间工作。
- 点击英文单词查词仍正常。
- 手机宽度下双语字幕不溢出、不遮挡主要控件。

## 10. MVP 验收标准

- 上传英文视频并生成英文字幕后，可以一键生成中文字幕。
- 重新打开视频详情页时，中文翻译从数据库加载，不需要重新翻译。
- 播放器能按当前时间显示英文、中文或双语字幕。
- 字幕列表展示英文和中文，点击任一字幕能跳转播放。
- 用户可以编辑单条字幕原文和译文。
- 所有字幕读取、翻译、编辑接口都只能访问当前用户自己的视频。

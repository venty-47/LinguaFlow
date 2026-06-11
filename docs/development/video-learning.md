# 英文视频学习功能系统设计文档

本文说明如何在当前 English learning 平台内实现类似 YouTube 的视频字幕学习能力：上传或导入视频后自动生成字幕，播放器按时间显示字幕，并把字幕与翻译、查词、生词、跟读、复习等学习功能结合。

相关技术调研见 [YouTube 字幕功能技术调研](./youtube-caption-technology.md)。

## 1. 目标和非目标

### 1.1 目标

- 用户上传本地视频或音频文件。
- 后端异步抽取音频并调用 ASR 生成英文字幕。
- 系统保存结构化字幕 cue，并可导出 WebVTT/SRT。
- 前端播放器按播放时间展示当前字幕。
- 支持双语字幕、字幕列表、点击字幕跳转、逐句循环、倍速播放。
- 字幕文本接入现有翻译、查词、生词本、TTS、学习记录能力。
- 允许用户编辑自动字幕和翻译，标记自动生成、人工修改、导入来源。

### 1.2 非目标

- 不做 YouTube 视频下载或绕过第三方平台限制。
- 不承诺自动字幕达到专业无障碍字幕质量。
- MVP 不做直播实时字幕。
- MVP 不做多人说话人分离的强依赖；ASR 若提供 speaker 信息可保留扩展字段。
- MVP 不做视频转码、多码率 HLS 分发；先使用上传原文件直接播放。

## 2. 当前代码基础

仓库已有视频学习相关实现，但仍有可继续完善的功能：

- `backend/config.toml.example` 和 `backend/config.docker.toml` 已有 `[video_learning]` 配置块，包含视频、音频、transcript 存储目录和 ASR provider 配置。
- `backend/config/config.go` 已有 `VideoLearningConfig` 配置结构。
- `backend/models/models.go` 已有 `VideoLesson` 和 `VideoSubtitle` GORM 模型。
- `backend/handlers/video_learning.go` 和 `backend/services/video_learning.go` 已包含上传、列表、详情、删除、重新生成字幕、字幕列表、VTT 输出和播放进度能力。
- `backend/main.go` 已注册 `/api/video-lessons` 相关登录接口。
- `frontend/src/types/index.ts` 已有 `VideoLesson`、`VideoSubtitle` 类型。
- `frontend/src/lib/api.ts` 已有 `videoLessonAPI`。
- `frontend/src/app/study/videos/page.tsx` 和 `frontend/src/app/study/videos/[id]/page.tsx` 已有视频学习列表和播放页。
- `frontend/src/app/globals.css` 已有 `.video-learning-player` 和 `video::cue` 样式。
- `backend/storage/video-audio/`、`backend/storage/video-transcripts/`、`backend/storage/videos/` 有本地样例文件。

仍待完善的重点包括：字幕翻译、字幕编辑、导入/导出、任务队列恢复能力、更多学习记录统计。双语字幕专项设计见 [视频双语字幕功能实现文档](./video-bilingual-subtitles.md)。

结论：后续应继续沿用现有 `video_learning` 领域和 `VideoSubtitle.translation` 字段扩展，而不是另起一个不兼容模块。

## 3. 总体架构

```text
前端上传视频
  -> POST /api/video-lessons
  -> 后端保存 video_lesson
  -> 创建异步处理任务
  -> 抽取音频
  -> 调用 ASR
  -> 规范化 transcript
  -> 生成 video_subtitles rows
  -> 可选批量翻译字幕
  -> 状态 ready
  -> 前端播放器加载视频 + 字幕
```

核心原则：

- HTTP handler 只负责鉴权、参数校验、响应组装。
- 媒体处理、ASR 调用、VTT/SRT 解析生成、字幕分段放到 `backend/services/`。
- 视频、音频、字幕文件路径只保存相对路径，不返回服务器绝对路径。
- 用户数据查询必须带 `user_id` 条件。
- 处理任务必须有状态机，不能让上传请求同步等待长时间 ASR。

## 4. 数据模型

### 4.1 `VideoLesson`

建议加入 `backend/models/models.go`：

```go
type VideoLesson struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

    UserID uint `gorm:"not null;index" json:"user_id"`

    Title            string `gorm:"size:300;not null" json:"title"`
    Description      string `gorm:"type:text" json:"description"`
    Source           string `gorm:"size:50" json:"source"`
    SourceURL        string `gorm:"size:500" json:"source_url"`
    OriginalFilename string `gorm:"size:255" json:"original_filename"`

    VideoPath      string `gorm:"size:500;not null" json:"video_path"`
    AudioPath      string `gorm:"size:500" json:"audio_path"`
    TranscriptPath string `gorm:"size:500" json:"transcript_path"`

    DurationSeconds int64  `gorm:"default:0" json:"duration_seconds"`
    FileSizeBytes   int64  `gorm:"default:0" json:"file_size_bytes"`
    MimeType        string `gorm:"size:100" json:"mime_type"`
    Language        string `gorm:"size:20;default:'en'" json:"language"`

    Status   string `gorm:"size:30;default:'uploaded';index" json:"status"`
    Progress int    `gorm:"default:0" json:"progress"`
    Error    string `gorm:"type:text" json:"error"`

    LastPositionSeconds float64    `gorm:"default:0" json:"last_position_seconds"`
    CompletedAt         *time.Time `json:"completed_at"`

    User      User            `gorm:"foreignKey:UserID" json:"user,omitempty"`
    Subtitles []VideoSubtitle `gorm:"foreignKey:VideoLessonID" json:"subtitles,omitempty"`
}
```

状态枚举与前端已有类型保持一致：

- `uploaded`
- `extracting_audio`
- `transcribing`
- `segmenting`
- `ready`
- `failed`
- `cancelled`

### 4.2 `VideoSubtitle`

```go
type VideoSubtitle struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

    VideoLessonID uint `gorm:"not null;index:idx_video_subtitle_order,priority:1" json:"video_lesson_id"`
    SortOrder     int  `gorm:"not null;index:idx_video_subtitle_order,priority:2" json:"sort_order"`

    StartSeconds float64 `gorm:"not null;index" json:"start_seconds"`
    EndSeconds   float64 `gorm:"not null;index" json:"end_seconds"`
    Text         string  `gorm:"type:text;not null" json:"text"`
    Translation  string  `gorm:"type:text" json:"translation"`
    Confidence   float64 `gorm:"default:0" json:"confidence"`
    Source       string  `gorm:"size:20;default:'auto'" json:"source"`

    VideoLesson VideoLesson `gorm:"foreignKey:VideoLessonID" json:"video_lesson,omitempty"`
}
```

约束建议：

- `end_seconds > start_seconds` 在 service 层校验。
- 同一 `video_lesson_id + sort_order` 应唯一。
- 列表查询按 `sort_order asc, start_seconds asc`。
- `source` 枚举：`auto`、`manual`、`edited`、`imported`。

### 4.3 可选扩展表

后续可加：

- `VideoSubtitleTrack`：当需要一视频多语言、多版本轨道时，单独抽轨道表。
- `VideoLearningEvent`：字幕点击、循环播放、查词、保存生词、跟读评分等事件。
- `VideoSubtitleVersion`：字幕编辑历史和回滚。

MVP 可以先不加轨道表，用 `VideoSubtitle` 存英文原文和中文翻译。

## 5. 配置设计

补齐 `backend/config/config.go`：

```go
type Config struct {
    // ...
    VideoLearning VideoLearningConfig `toml:"video_learning"`
}

type VideoLearningConfig struct {
    Enabled                  bool   `toml:"enabled"`
    StorageDir               string `toml:"storage_dir"`
    AudioDir                 string `toml:"audio_dir"`
    TranscriptDir            string `toml:"transcript_dir"`
    MaxUploadMB              int    `toml:"max_upload_mb"`
    MaxDurationSeconds       int    `toml:"max_duration_seconds"`
    AllowedExtensions        string `toml:"allowed_extensions"`
    ProcessingTimeoutSeconds int    `toml:"processing_timeout_seconds"`
    TranscriptionProvider    string `toml:"transcription_provider"`
    TranscriptionBaseURL     string `toml:"transcription_base_url"`
    TranscriptionAPIKey      string `toml:"transcription_api_key"`
    TranscriptionModel       string `toml:"transcription_model"`
    MaxAudioUploadMB         int    `toml:"max_audio_upload_mb"`
}
```

配置已在 TOML 示例中存在，代码层需要同步加载。

## 6. 后端服务划分

### 6.1 `handlers/video_learning.go`

职责：

- 上传参数读取。
- 当前用户鉴权上下文读取。
- 文件大小、扩展名、MIME 初步校验。
- 调用 service 创建 lesson。
- 查询 lesson 列表、详情、字幕列表。
- 更新播放进度。
- 编辑字幕。
- 导出 VTT/SRT。

不要在 handler 内执行 FFmpeg 或外部 ASR HTTP 调用。

### 6.2 `services/video_learning.go`

职责：

- 创建 lesson。
- 生成安全文件名。
- 保存上传文件。
- 调用媒体探测。
- 创建处理任务。
- 状态流转和错误包装。

### 6.3 `services/media.go`

职责：

- 封装 `ffprobe` 读取时长和流信息。
- 封装 `ffmpeg` 抽取音频。
- 统一 timeout、命令参数、输出大小限制。

推荐音频抽取：

```bash
ffmpeg -y -i input.mp4 -vn -ac 1 -ar 16000 output.wav
```

### 6.4 `services/transcription.go`

职责：

- 定义 ASR provider 接口。
- 实现 FunASR/OpenAI-compatible provider。
- 解析 ASR JSON。
- 兼容只有全文没有 segments 的返回。

接口建议：

```go
type TranscriptionProvider interface {
    Transcribe(ctx context.Context, audioPath string, opts TranscribeOptions) (*Transcript, error)
}

type Transcript struct {
    Task     string              `json:"task"`
    Language string              `json:"language"`
    Duration float64             `json:"duration"`
    Text     string              `json:"text"`
    Segments []TranscriptSegment `json:"segments"`
}

type TranscriptSegment struct {
    Start      float64 `json:"start"`
    End        float64 `json:"end"`
    Text       string  `json:"text"`
    Confidence float64 `json:"confidence"`
}
```

如果 ASR 返回 `segments: []` 但有全文，MVP 可以退化为按句子均匀分配时间；生产效果不佳，应在 UI 标记为低可信并提示重新识别或手动校对。

### 6.5 `services/subtitles.go`

职责：

- Transcript -> Subtitle cues。
- Cue 合并、拆分、排序、去重。
- SRT/VTT 解析和生成。
- 字幕时间合法性校验。

字幕 cue 规范化规则：

- trim 文本。
- 空文本丢弃。
- `start_seconds >= 0`。
- `end_seconds > start_seconds`。
- 与上一条重叠时做最小修正。
- 过长 cue 按标点和长度拆分。
- 过短 cue 与相邻 cue 合并。

## 7. 异步任务设计

MVP 可以用 goroutine + 数据库状态，但建议尽早接入可恢复队列。当前项目已有 Redis，推荐：

- 简单版：Redis list / stream + 后端 worker。
- 更稳版：Asynq（Go + Redis）。

任务 payload：

```json
{
  "video_lesson_id": 123,
  "user_id": 2,
  "video_path": "storage/videos/2/xxx.mp4"
}
```

状态更新：

```text
uploaded: 0
extracting_audio: 10-30
transcribing: 30-75
segmenting: 75-90
ready: 100
failed: 保留 progress，写 error
```

幂等要求：

- 重试任务先查询 lesson 状态。
- 已有音频文件可跳过抽取。
- 已有字幕 rows 时，重新生成前先事务删除旧 auto 字幕，保留 edited/manual 字幕需要产品决策。
- `cancelled` 状态任务不得继续写 ready。

## 8. API 设计

所有接口挂在 protected group，需要登录。

### 8.1 上传视频

```http
POST /api/video-lessons
Content-Type: multipart/form-data

file=<video>
title=...
description=...
language=en
```

响应：

```json
{
  "data": {
    "id": 123,
    "status": "uploaded",
    "progress": 0
  }
}
```

### 8.2 列表

```http
GET /api/video-lessons?page=1&page_size=20&status=ready
```

响应使用现有分页格式：`data + pagination`。

### 8.3 详情

```http
GET /api/video-lessons/:id
```

必须按 `id + user_id` 查询。

### 8.4 字幕列表

```http
GET /api/video-lessons/:id/subtitles
```

返回：

```json
{
  "data": [
    {
      "id": 1,
      "start_seconds": 1.2,
      "end_seconds": 4.8,
      "text": "Hello everyone.",
      "translation": "大家好。",
      "confidence": 0.91,
      "source": "auto"
    }
  ]
}
```

### 8.5 WebVTT

```http
GET /api/video-lessons/:id/subtitles.vtt?lang=en
```

返回 `text/vtt; charset=utf-8`。

### 8.6 更新字幕

```http
PATCH /api/video-lessons/:id/subtitles/:subtitle_id
Content-Type: application/json

{
  "start_seconds": 1.2,
  "end_seconds": 4.9,
  "text": "Hello everyone.",
  "translation": "大家好。"
}
```

更新后 `source` 改为 `edited`。

### 8.7 批量翻译字幕

```http
POST /api/video-lessons/:id/subtitles/translate
Content-Type: application/json

{
  "target_lang": "zh"
}
```

实现上复用现有 translation service，但必须限流、分批、缓存，避免一次长视频触发过多外部请求。

### 8.8 播放进度

```http
POST /api/video-lessons/:id/progress
Content-Type: application/json

{
  "position_seconds": 123.4,
  "completed": false
}
```

前端节流提交，例如每 15 秒或页面隐藏时提交。

## 9. 前端页面设计

### 9.1 路由

建议新增：

- `frontend/src/app/study/videos/page.tsx`：视频学习列表和上传入口。
- `frontend/src/app/study/videos/[id]/page.tsx`：播放器和字幕学习页。

复杂逻辑拆分：

- `frontend/src/components/video/VideoUploader.tsx`
- `frontend/src/components/video/VideoLearningPlayer.tsx`
- `frontend/src/components/video/SubtitlePanel.tsx`
- `frontend/src/components/video/SubtitleEditor.tsx`
- `frontend/src/lib/videoSubtitles.ts`

API helper 放在 `frontend/src/lib/api.ts`：

```ts
export const videoLessonAPI = {
  upload: (formData: FormData) => api.post('/video-lessons', formData),
  list: (params?: { page?: number; page_size?: number; status?: string }) =>
    api.get('/video-lessons', { params }),
  get: (id: number) => api.get(`/video-lessons/${id}`),
  getSubtitles: (id: number) => api.get(`/video-lessons/${id}/subtitles`),
  updateSubtitle: (lessonId: number, subtitleId: number, data: Partial<VideoSubtitle>) =>
    api.patch(`/video-lessons/${lessonId}/subtitles/${subtitleId}`, data),
  translateSubtitles: (id: number, data: { target_lang: string }) =>
    api.post(`/video-lessons/${id}/subtitles/translate`, data),
  updateProgress: (id: number, data: { position_seconds: number; completed?: boolean }) =>
    api.post(`/video-lessons/${id}/progress`, data),
};
```

### 9.2 播放器交互

播放器区：

- 视频播放。
- 字幕开关。
- 原文/译文/双语切换。
- 倍速。
- 逐句循环。
- 上一句/下一句。

字幕区：

- 当前字幕高亮。
- 点击字幕跳转到 `start_seconds`。
- 单句翻译。
- 单词点击查词。
- 添加生词。
- 编辑字幕文本和时间。

推荐实现：

- 原生 `<video>` 负责播放。
- 后端提供 `.vtt` 给 `<track>`，用于浏览器标准字幕。
- 同时前端加载结构化字幕 JSON，渲染右侧字幕列表和学习交互。
- 当前 cue 用 `timeupdate` + 二分查找计算，不依赖浏览器原生字幕的私有状态。

### 9.3 当前字幕匹配

```ts
export function findActiveSubtitle(subtitles: VideoSubtitle[], time: number) {
  let left = 0;
  let right = subtitles.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (subtitles[mid].start_seconds <= time) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (result >= 0 && time < subtitles[result].end_seconds) {
    return subtitles[result];
  }
  return null;
}
```

`timeupdate` 事件频率有限，逐词高亮需要 `requestAnimationFrame` 或更高频的定时器；MVP 做句级高亮即可。

## 10. 学习功能结合点

### 10.1 查词和生词本

复用现有：

- `/api/dictionary`
- `/api/translate`
- `/api/vocabulary`

添加生词时建议扩展 `Vocabulary`：

- 当前已有 `source_type` 设计在背单词文档中提到 `video`，模型可后续补字段。
- MVP 可先把字幕上下文写入 `context`，`article_id` 为空。
- 后续加 `video_lesson_id`、`video_subtitle_id`，实现从生词回跳视频时间点。

### 10.2 字幕翻译

优先批量翻译字幕，而不是播放时逐条实时翻译：

- 播放体验稳定。
- 可缓存。
- 可编辑。
- 可用于复习和搜索。

批量翻译策略：

- 每 20 到 50 条 cue 一批。
- 提供上下文，但要求返回相同数量的翻译数组。
- 失败批次可重试。
- 单条 cue 可手动重新翻译。

### 10.3 TTS 和跟读

现有 TTS 适合字幕句子朗读，但视频本身已有原声。视频学习更适合：

- 原声循环播放当前字幕。
- TTS 作为对照发音。
- 后续可加录音跟读和评分。

MVP：

- 当前字幕“循环播放”。
- 当前字幕“模型朗读”复用 `/api/tts`。
- 保存用户跟读练习事件，为后续统计做准备。

### 10.4 学习记录

与文章阅读类似，视频学习需要记录：

- 最后播放位置。
- 完成状态。
- 学习时长。
- 查词次数。
- 保存生词次数。
- 循环播放句子次数。
- 编辑字幕次数。

MVP 可先只记录 `last_position_seconds` 和 `completed_at`。

## 11. 安全和限制

上传限制：

- 登录后才能上传。
- 文件大小受 `max_upload_mb` 限制。
- 扩展名和 MIME 双重校验。
- 文件名不可直接使用用户原始文件名作为磁盘路径。
- 禁止路径穿越。
- 超长视频拒绝或进入低优先级队列。

外部处理限制：

- FFmpeg 命令必须设置 context timeout。
- ASR HTTP client 必须设置 timeout。
- 响应体大小必须限制。
- 错误日志不得打印 API key 或完整私密文本。

权限：

- 所有 lesson 查询、字幕编辑、导出都必须带 `user_id`。
- 管理员接口如需全量管理，单独放 `/api/admin/video-lessons` 并加 admin middleware。

成本：

- ASR 和翻译都可能产生高成本。
- 建议视频学习作为 premium 功能或设置免费额度。
- 任务队列需要并发限制和用户级限流。

## 12. 实施计划

### Phase 1: 数据和上传闭环

- 补 `VideoLearningConfig`。
- 加 `VideoLesson`、`VideoSubtitle` 模型并 auto migrate。
- 加上传、列表、详情接口。
- 保存视频文件。
- 前端做 `/study/videos` 列表和上传。

验证：

- `go test ./...`
- `go build ./...`
- `npm run lint`
- `npm run build`

### Phase 2: 自动字幕处理

- 加 media service：ffprobe、ffmpeg。
- 加 transcription provider：FunASR/OpenAI-compatible。
- 加 subtitles service：Transcript -> rows、VTT 生成。
- 加后台 worker 或 goroutine 任务。
- 前端显示处理状态和进度。

验证：

- 用短视频上传，确认状态到 `ready`。
- 确认生成 audio、transcript、subtitle rows。
- 确认失败状态能显示错误且不泄露内部信息。

### Phase 3: 播放和字幕学习

- 加视频详情页。
- 原生 video 播放。
- 加 `<track>` VTT。
- 加结构化字幕列表。
- 实现点击字幕跳转、当前字幕高亮、逐句循环。
- 接入查词、生词、单句翻译。

验证：

- 手机和桌面布局。
- 拖动进度条后字幕高亮正确。
- 倍速播放字幕仍匹配。
- 未 ready、failed、空字幕状态都有 UI。

### Phase 4: 编辑、翻译和复习

- 字幕编辑接口和 UI。
- 批量字幕翻译。
- 导入/导出 SRT/VTT。
- 视频来源生词回跳。
- 学习记录统计。

## 13. 测试建议

后端单元测试：

- SRT/VTT parser 和 generator。
- Transcript segment 转 subtitles。
- 重叠 cue 修正。
- 空 segments 退化策略。
- handler 权限：不能访问他人视频。

集成测试：

- 上传小 mp4。
- mock ASR provider 返回固定 transcript。
- 断言 lesson 状态、subtitle rows、VTT 输出。

前端验证：

- 列表 loading/error/empty/success。
- 上传进度和失败提示。
- 播放器当前字幕匹配。
- 点击字幕跳转。
- 双语字幕长文本不溢出。

## 14. MVP 验收标准

- 用户可以上传一个 5 分钟以内英文视频。
- 后端能抽取音频并调用配置的 ASR。
- 处理完成后生成字幕 rows 和 `.vtt` 输出。
- 前端可以播放视频并显示字幕。
- 字幕列表能按播放进度高亮，点击能跳转。
- 用户可以点击字幕中的词查词并加入生词本。
- 用户离开后再次进入能恢复播放位置。
- 所有视频和字幕数据只允许 owner 访问。

# 英文视频学习功能实现文档

本文档用于指导 `Video Lessons / 视频学习` 功能的分阶段实现。目标是让用户上传 TED、公开演讲、课程片段等英文视频后，系统自动生成带时间轴的字幕，并在播放器下方以逐句字幕形式进行精听、查词和复习。

实现前必须同时遵守：

- `AGENTS.md`
- `docs/development/README.md`
- `docs/development/gin-backend.md`
- `docs/development/nextjs-frontend.md`

## 1. 产品目标

### 1.1 核心体验

用户上传一个英文视频，等待系统处理完成后进入学习页：

1. 页面上方播放视频。
2. 页面下方或右侧展示按时间排序的字幕句子。
3. 视频播放时自动高亮当前字幕。
4. 用户点击任意字幕句子，视频跳转到该句开始时间。
5. 用户可以暂停视频，点击单词查词，并将单词加入生词本。

### 1.2 MVP 边界

第一版只做完整闭环，不做复杂学习模式：

- 支持上传本地 `.mp4`、`.mov`、`.m4v`、`.webm`、`.mp3`、`.m4a` 文件。
- 后端保存文件并生成一条视频学习记录。
- 后端异步处理视频，生成英文字幕。
- 前端展示视频列表、上传状态、详情播放器和同步字幕。
- 字幕支持点击跳转、当前句高亮。
- 字幕文本中的单词复用现有查词和生词本能力。

第一版暂不做：

- 多用户共享视频。
- 外部 URL 直接导入。
- 多语言语音识别。
- 人工精修字幕工作台。
- 自动配音、AI 跟读打分、听写模式。
- 生产级分布式任务队列。

## 2. 业务命名

建议统一使用以下领域名：

- 后端模型：`VideoLesson`、`VideoSubtitle`、`VideoProcessingJob`
- 后端 handler：`backend/handlers/video_learning.go`
- 后端 service：`backend/services/video_transcription.go`、`backend/services/video_media.go`
- 前端 API：`videoLessonAPI`
- 前端路由：
  - `/study/videos`
  - `/study/videos/[id]`
- 前端组件目录：`frontend/src/components/video-learning/`

避免使用过宽泛的 `Video` 命名，因为后续可能还有课程视频、营销视频、TTS 视频等其他概念。

## 3. 阶段路线图

### 阶段 0：配置与存储准备

目标：为上传、转写和静态访问建立基础设施。

后端：

- 新增 `storage/videos/` 保存上传原始文件。
- 新增 `storage/video-audio/` 保存提取后的音频文件。
- 新增 `storage/video-transcripts/` 可选保存原始转写 JSON，便于排错和重新导入。
- 确认 `main.go` 已通过 `r.Static("/storage", "storage")` 暴露静态文件。
- 在 `backend/config/config.go`、`backend/config.toml.example`、`backend/config.docker.toml` 中新增 `[video_learning]` 配置。

建议配置：

```toml
[video_learning]
enabled = true
storage_dir = "storage/videos"
audio_dir = "storage/video-audio"
transcript_dir = "storage/video-transcripts"
max_upload_mb = 300
max_duration_seconds = 3600
allowed_extensions = ".mp4,.mov,.m4v,.webm,.mp3,.m4a"
processing_timeout_seconds = 1800
transcription_provider = "funasr"
transcription_base_url = "http://localhost:8000/v1"
transcription_api_key = ""
transcription_model = "sensevoice"
max_audio_upload_mb = 500
```

说明：

- 本地开发默认走 FunASR 这类 OpenAI-compatible 本地 ASR 服务，不需要云端 API key；没有本地 ASR 服务时应允许手动上传字幕或返回明确错误。
- 生产环境必须限制上传大小、时长、并发任务和 CORS origins。
- `ffmpeg` 是系统依赖，不能假定所有环境已安装。启动或处理时要返回可读错误。

### 阶段 1：数据模型

目标：保存视频资料、字幕、处理状态和学习进度。

在 `backend/models/models.go` 新增模型，字段保持 GORM + JSON tag 风格。

#### 1.1 `VideoLesson`

建议字段：

```go
type VideoLesson struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

    UserID uint `gorm:"not null;index" json:"user_id"`

    Title       string `gorm:"size:300;not null" json:"title"`
    Description string `gorm:"type:text" json:"description"`
    Source      string `gorm:"size:100" json:"source"`
    SourceURL   string `gorm:"size:1000" json:"source_url"`

    OriginalFilename string `gorm:"size:500" json:"original_filename"`
    VideoPath        string `gorm:"size:1000;not null" json:"video_path"`
    AudioPath        string `gorm:"size:1000" json:"audio_path"`

    DurationSeconds float64 `gorm:"default:0" json:"duration_seconds"`
    FileSizeBytes   int64   `gorm:"default:0" json:"file_size_bytes"`
    MimeType        string  `gorm:"size:100" json:"mime_type"`

    Language string `gorm:"size:20;default:'en'" json:"language"`
    Status   string `gorm:"size:30;default:'uploaded';index" json:"status"`
    Progress int    `gorm:"default:0" json:"progress"`
    Error    string `gorm:"type:text" json:"error"`

    LastPositionSeconds float64    `gorm:"default:0" json:"last_position_seconds"`
    CompletedAt         *time.Time `json:"completed_at"`

    User      User            `gorm:"foreignKey:UserID" json:"user,omitempty"`
    Subtitles []VideoSubtitle `gorm:"foreignKey:VideoLessonID" json:"subtitles,omitempty"`
}
```

`status` 枚举：

- `uploaded`
- `extracting_audio`
- `transcribing`
- `segmenting`
- `ready`
- `failed`
- `cancelled`

索引建议：

- `user_id + created_at`
- `user_id + status`

#### 1.2 `VideoSubtitle`

建议字段：

```go
type VideoSubtitle struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

    VideoLessonID uint `gorm:"not null;index:idx_video_subtitle_order" json:"video_lesson_id"`
    SortOrder     int  `gorm:"not null;index:idx_video_subtitle_order" json:"sort_order"`

    StartSeconds float64 `gorm:"not null;index" json:"start_seconds"`
    EndSeconds   float64 `gorm:"not null" json:"end_seconds"`
    Text         string  `gorm:"type:text;not null" json:"text"`
    Translation  string  `gorm:"type:text" json:"translation"`

    Confidence float64 `gorm:"default:0" json:"confidence"`
    Source     string  `gorm:"size:30;default:'auto'" json:"source"`

    VideoLesson VideoLesson `gorm:"foreignKey:VideoLessonID" json:"video_lesson,omitempty"`
}
```

`source` 枚举：

- `auto`
- `manual`
- `edited`
- `imported`

约束建议：

- `video_lesson_id + sort_order` 使用组合唯一索引。
- handler 查询字幕时必须同时校验 `video_lessons.user_id = current_user_id`。

#### 1.3 `VideoProcessingJob`

MVP 可以不落库，直接在请求后启动 goroutine。更稳妥的第一版建议落库，方便重试和状态追踪。

建议字段：

```go
type VideoProcessingJob struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

    VideoLessonID uint       `gorm:"not null;index" json:"video_lesson_id"`
    Status        string     `gorm:"size:30;default:'queued';index" json:"status"`
    Attempts      int        `gorm:"default:0" json:"attempts"`
    LastError     string     `gorm:"type:text" json:"last_error"`
    StartedAt     *time.Time `json:"started_at"`
    FinishedAt    *time.Time `json:"finished_at"`

    VideoLesson VideoLesson `gorm:"foreignKey:VideoLessonID" json:"video_lesson,omitempty"`
}
```

MVP 状态：

- `queued`
- `running`
- `succeeded`
- `failed`

### 阶段 2：上传接口

目标：用户能创建视频学习记录并上传文件。

新增 protected 路由：

```go
videos := protected.Group("/video-lessons")
{
    videos.GET("", handlers.ListVideoLessons)
    videos.POST("", handlers.CreateVideoLesson)
    videos.GET("/:id", handlers.GetVideoLesson)
    videos.DELETE("/:id", handlers.DeleteVideoLesson)
    videos.GET("/:id/subtitles", handlers.ListVideoSubtitles)
    videos.POST("/:id/process", handlers.ProcessVideoLesson)
    videos.PATCH("/:id/progress", handlers.UpdateVideoLessonProgress)
}
```

#### 2.1 `POST /api/video-lessons`

Content-Type 使用 `multipart/form-data`。

请求字段：

- `file`: required
- `title`: optional，默认使用文件名去扩展名
- `description`: optional
- `source`: optional，例如 `TED`
- `source_url`: optional
- `language`: optional，默认 `en`
- `auto_process`: optional，默认 `true`

响应：

```json
{
  "data": {
    "id": 1,
    "title": "How great leaders inspire action",
    "video_path": "/storage/videos/...",
    "status": "uploaded",
    "progress": 0,
    "created_at": "2026-06-09T..."
  }
}
```

handler 要求：

- 必须从 JWT context 获取 `user_id`。
- 校验扩展名、MIME、大小。
- 文件名不能直接使用用户原始文件名作为磁盘路径。
- 生成随机文件名，例如 `<user_id>/<uuid>.mp4`。
- 保存 `original_filename` 仅用于展示。
- 失败时清理已保存的半成品文件。
- 成功后如果 `auto_process=true`，创建任务并进入处理流程。

#### 2.2 `GET /api/video-lessons`

请求 query：

- `page`
- `page_size`
- `status`
- `search`

响应：

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 0,
    "total_page": 0
  }
}
```

列表项需要包含：

- `id`
- `title`
- `status`
- `progress`
- `duration_seconds`
- `file_size_bytes`
- `last_position_seconds`
- `created_at`
- `updated_at`
- `error`

不要在列表接口返回完整字幕。

#### 2.3 `GET /api/video-lessons/:id`

返回视频详情，不默认返回完整字幕。字幕由独立接口加载，避免页面初次请求过大。

权限要求：

- 只能查询当前用户自己的视频。
- ID 转换失败返回 400。
- 查不到返回 404。

#### 2.4 `GET /api/video-lessons/:id/subtitles`

返回按 `sort_order ASC` 排序的字幕数组。

响应：

```json
{
  "data": [
    {
      "id": 1,
      "video_lesson_id": 1,
      "sort_order": 1,
      "start_seconds": 12.4,
      "end_seconds": 16.8,
      "text": "Today I want to talk about...",
      "translation": "",
      "confidence": 0.93,
      "source": "auto"
    }
  ]
}
```

### 阶段 3：媒体处理与转写

目标：从视频中提取音频并生成结构化字幕。

#### 3.1 服务职责

新增 `backend/services/video_media.go`：

- 检查 `ffmpeg` / `ffprobe` 是否可用。
- 获取视频时长、编码、媒体信息。
- 从视频中提取音频。
- 限制命令超时时间。

新增 `backend/services/video_transcription.go`：

- 定义 provider 接口。
- 调用语音识别服务。
- 把 provider 返回转换成统一字幕段结构。
- 保存原始转写 JSON 到 `transcript_dir`。

建议接口：

```go
type VideoTranscriber interface {
    Transcribe(ctx context.Context, audioPath string, opts TranscribeOptions) (*TranscriptionResult, error)
}

type TranscribeOptions struct {
    Language string
    Model    string
}

type TranscriptionResult struct {
    Language string
    Duration float64
    Segments []TranscriptionSegment
    RawJSON  []byte
}

type TranscriptionSegment struct {
    StartSeconds float64
    EndSeconds   float64
    Text         string
    Confidence   float64
}
```

#### 3.2 provider 选择

MVP 推荐：

1. 默认使用 FunASR 本地服务，后端请求 `transcription_base_url + /audio/transcriptions`。
2. 该接口保持 OpenAI-compatible 形态，因此也可以换成 `faster-whisper-server`、OpenAI Whisper API 或其他兼容服务。
3. 如果没有本地 ASR 服务或转写失败，则允许用户上传 `.srt` 或 `.vtt` 字幕继续学习。

不要在 handler 中直接拼 ASR 请求。外部或本地 ASR 调用必须在 service 中实现，并具备：

- timeout
- 文件大小限制
- provider/base URL 名称
- 错误包装
- 不打印 API key
- 测试中 mock provider

#### 3.3 处理流程

处理器步骤：

1. 加载 `VideoLesson`，确认状态不是 `ready` 或 `running` 类状态。
2. 状态更新为 `extracting_audio`，`progress=10`。
3. 调用 `ffprobe` 获取时长，超过配置上限则失败。
4. 调用 `ffmpeg` 提取音频，推荐输出 `mp3` 或 `m4a`。
5. 状态更新为 `transcribing`，`progress=35`。
6. 调用转写 provider。
7. 状态更新为 `segmenting`，`progress=80`。
8. 开启数据库事务：
   - 删除该视频旧字幕。
   - 批量插入新字幕。
   - 更新 `VideoLesson` 为 `ready`，`progress=100`，清空 `error`。
   - 更新 job 为 `succeeded`。
9. 失败时更新 `status=failed`、`error` 和 job 状态。

#### 3.4 字幕切分规则

provider 通常会返回 segment，但不同 provider 的粒度不稳定。统一转换时要做轻量整理：

- 去掉首尾空白。
- 空文本不入库。
- `end_seconds <= start_seconds` 的片段丢弃或修正。
- 单句超过 20 秒或 260 字符时，可以按标点二次切分，但要保持时间近似分配。
- 相邻片段间隔小于 0.15 秒时不需要强行合并。

MVP 不要求做到专业字幕编辑器级别，重点是学习时逐句可读。

### 阶段 4：前端页面

目标：提供视频列表、上传和字幕学习页面。

#### 4.1 类型

在 `frontend/src/types/index.ts` 新增：

```ts
export type VideoLessonStatus =
  | 'uploaded'
  | 'extracting_audio'
  | 'transcribing'
  | 'segmenting'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface VideoLesson {
  id: number;
  user_id: number;
  title: string;
  description?: string;
  source?: string;
  source_url?: string;
  original_filename?: string;
  video_path: string;
  audio_path?: string;
  duration_seconds: number;
  file_size_bytes: number;
  mime_type?: string;
  language: string;
  status: VideoLessonStatus;
  progress: number;
  error?: string;
  last_position_seconds: number;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoSubtitle {
  id: number;
  video_lesson_id: number;
  sort_order: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
  translation?: string;
  confidence: number;
  source: 'auto' | 'manual' | 'edited' | 'imported';
  created_at: string;
  updated_at: string;
}
```

#### 4.2 API helper

在 `frontend/src/lib/api.ts` 新增 `videoLessonAPI`：

```ts
export const videoLessonAPI = {
  list: (params?: { page?: number; page_size?: number; status?: string; search?: string }) =>
    api.get('/video-lessons', { params }),
  create: (data: FormData) =>
    api.post('/video-lessons', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  get: (id: number) =>
    api.get(`/video-lessons/${id}`),
  remove: (id: number) =>
    api.delete(`/video-lessons/${id}`),
  getSubtitles: (id: number) =>
    api.get(`/video-lessons/${id}/subtitles`),
  process: (id: number) =>
    api.post(`/video-lessons/${id}/process`),
  updateProgress: (id: number, data: { last_position_seconds: number; completed?: boolean }) =>
    api.patch(`/video-lessons/${id}/progress`, data),
};
```

#### 4.3 `/study/videos`

页面职责：

- 登录保护。
- 展示上传入口。
- 展示视频学习列表。
- 对处理中视频定时刷新状态。
- 支持失败后重新处理。
- 支持删除个人视频。

状态要求：

- loading：展示骨架或加载状态。
- empty：提示上传第一个视频。
- error：展示可读错误。
- uploading：按钮 disabled，显示上传进度。
- processing：展示状态文案和百分比。

列表项建议展示：

- 标题
- 状态
- 时长
- 上传时间
- 最近学习位置
- 进入学习按钮

#### 4.4 `/study/videos/[id]`

页面布局建议：

- 桌面：左侧视频播放器，右侧字幕列表或学习面板。
- 移动端：上方播放器，下方字幕列表。
- 播放器使用原生 `<video controls>`，先不引入复杂播放器库。

核心交互：

- `timeupdate` 时根据 `currentTime` 找到当前字幕。
- 当前字幕滚动到可见区域。
- 点击字幕设置 `video.currentTime = subtitle.start_seconds` 并播放。
- 切换字幕显示模式：
  - 英文
  - 中文
  - 双语
- 单词点击：
  - 调用现有 `translationAPI.lookupWord`
  - 可调用 `vocabularyAPI.addWord`
  - `context` 使用当前字幕文本

性能注意：

- `timeupdate` 不要每帧触发大量 state。可用 `requestAnimationFrame` 或节流。
- 当前字幕查找可以对有序数组做二分查找，MVP 字幕少时线性扫描也可接受。
- 字幕列表很多时后续再引入虚拟列表，MVP 先分页或限制单视频时长。

#### 4.5 学习进度

前端在以下时机调用 `PATCH /api/video-lessons/:id/progress`：

- 暂停时。
- 页面卸载前，使用 `navigator.sendBeacon` 可作为后续优化。
- 每 30 秒节流保存一次。
- 播放到 90% 以上且用户停留足够时，标记 `completed=true`。

后端可在更新视频学习进度时同步更新 `StudyRecord.ReadSeconds`，但 MVP 可以先只保存 `VideoLesson.LastPositionSeconds`，避免和文章阅读统计耦合过早。

### 阶段 5：字幕增强

目标：让字幕真正融入现有英语学习系统。

MVP 后第一批增强：

1. 字幕句子翻译
   - 单句点击翻译，调用现有 `translationAPI.translate`。
   - 后端可增加批量翻译接口，按 `video_subtitle_id` 写回 `translation`。
2. 生词来源记录
   - 现有 `Vocabulary` 只有 `article_id`。
   - 短期可以只写 `context`。
   - 后续建议新增 `source_type`、`source_id` 或单独 `video_lesson_id`，避免所有视频词汇无法关联来源。
3. AI 精听解释
   - 对当前字幕句调用 `AnalyzeSentence` 类似能力。
   - premium gate 应沿用 `middleware.PremiumRequired(database.DB)`。
4. 句子收藏
   - 新增 `SavedSentence` 或领域表 `VideoSavedSentence`。
   - 用于后续跟读、背诵和写作仿写。

### 阶段 6：字幕编辑与导入

目标：处理自动字幕不准的问题。

后续接口：

- `POST /api/video-lessons/:id/subtitles/import`
- `PUT /api/video-lessons/:id/subtitles/:subtitle_id`
- `DELETE /api/video-lessons/:id/subtitles/:subtitle_id`
- `POST /api/video-lessons/:id/subtitles/reorder`

支持格式：

- `.srt`
- `.vtt`
- provider 原始 JSON

编辑功能：

- 修改文本。
- 修改开始和结束时间。
- 合并当前句和下一句。
- 拆分当前句。
- 保存后 `source=edited`。

实现要求：

- SRT/VTT 解析放在 `backend/services/`，并写测试。
- 不要在 handler 中用临时字符串拼接解析字幕。
- 修改字幕时必须校验视频归属当前用户。

### 阶段 7：学习模式扩展

后续可以按学习价值从高到低实现：

1. 精听循环
   - 当前句循环播放。
   - A-B repeat。
   - 播放速度 `0.75x`、`1x`、`1.25x`。
2. 听写模式
   - 隐藏字幕。
   - 用户输入听到的句子。
   - 对比差异并高亮漏听词。
3. 跟读模式
   - 录音。
   - ASR 转写用户跟读。
   - 对比原句，给出发音和完整度提示。
4. AI 讲解
   - 对一句话解释连读、弱读、关键词、语法结构。
   - 对整段生成摘要和重点词。
5. 视频学习报告
   - 学习时长。
   - 完成率。
   - 新增生词。
   - 反复回听句子。
   - 难句列表。

这些增强应优先复用已有翻译、词典、TTS、AI、知识图谱和学习统计模块，避免复制一套阅读器逻辑。

## 4. 权限、安全与成本控制

### 4.1 权限

- 所有视频学习接口必须登录。
- 所有查询和写入必须带 `user_id` 条件。
- 管理员不能通过普通用户接口读取他人视频，除非后续新增明确 admin 接口。
- 转写、AI 精听、批量翻译等高成本能力建议加 premium gate 或用额度限制。

### 4.2 上传安全

- 不信任文件扩展名，至少同时检查 MIME 和实际媒体探测结果。
- 上传路径不得包含用户原始文件名。
- 文件大小必须限制。
- 视频时长必须限制。
- 删除视频时只删除该用户记录对应的受控 storage 路径，不能接受前端传入路径删除。
- 错误日志不能打印 token、API key 或完整第三方响应。

### 4.3 外部调用成本

控制策略：

- 免费用户限制单个视频时长，例如 10 分钟。
- 会员用户限制单个视频时长，例如 60 分钟。
- 每日或每月转写分钟数额度。
- 同一视频不重复转写，除非用户明确重新处理。
- 失败重试次数限制，默认最多 2 次。

MVP 可以先在配置中写死全局限制，后续再接会员权益和订单系统。

## 5. 后端实现步骤

建议按以下顺序提交：

1. 新增配置结构和示例配置。
2. 新增 `VideoLesson`、`VideoSubtitle`、`VideoProcessingJob` 模型，并加入 AutoMigrate。
3. 新增 `video_media` service，封装 `ffprobe` 和 `ffmpeg`。
4. 新增 `video_transcription` service，先用 mock provider 或可配置 provider。
5. 新增 handler：
   - 列表
   - 上传
   - 详情
   - 字幕列表
   - 触发处理
   - 更新进度
6. 在 `main.go` 注册 protected 路由。
7. 添加后端测试：
   - 文件类型校验。
   - 字幕 segment 清洗。
   - SRT/VTT 解析，如果实现导入。
   - service provider mock。
8. 运行：

```bash
cd backend
go test ./...
go build ./...
```

## 6. 前端实现步骤

建议按以下顺序提交：

1. 在 `frontend/src/types/index.ts` 新增视频学习类型。
2. 在 `frontend/src/lib/api.ts` 新增 `videoLessonAPI`。
3. 新增 `frontend/src/components/video-learning/VideoLessonUploader.tsx`。
4. 新增 `frontend/src/components/video-learning/VideoLessonCard.tsx`。
5. 新增 `frontend/src/components/video-learning/SubtitleTimeline.tsx`。
6. 新增 `frontend/src/components/video-learning/VideoStudyPlayer.tsx`。
7. 新增 `/study/videos/page.tsx`。
8. 新增 `/study/videos/[id]/page.tsx`。
9. 从现有 `/study` 页面增加入口。
10. 验证移动端和桌面布局。
11. 运行：

```bash
cd frontend
npm run lint
npm run build
```

## 7. API 合同汇总

### `GET /api/video-lessons`

登录：是。

用途：分页获取当前用户的视频学习列表。

响应：`{ data, pagination }`。

### `POST /api/video-lessons`

登录：是。

用途：上传视频并创建学习记录。

请求：`multipart/form-data`。

响应：`{ data: VideoLesson }`。

### `GET /api/video-lessons/:id`

登录：是。

用途：获取当前用户的视频学习详情。

响应：`{ data: VideoLesson }`。

### `DELETE /api/video-lessons/:id`

登录：是。

用途：删除当前用户的视频学习记录和受控存储文件。

响应：`{ message: "Video lesson deleted" }`。

### `GET /api/video-lessons/:id/subtitles`

登录：是。

用途：获取当前视频的字幕。

响应：`{ data: VideoSubtitle[] }`。

### `POST /api/video-lessons/:id/process`

登录：是。

用途：手动触发或重试转写。

响应：`{ data: VideoLesson }`。

### `PATCH /api/video-lessons/:id/progress`

登录：是。

用途：保存学习位置和完成状态。

请求：

```json
{
  "last_position_seconds": 123.4,
  "completed": false
}
```

响应：`{ data: VideoLesson }`。

## 8. UI 行为细节

### 状态文案

建议前端映射：

- `uploaded`: 已上传
- `extracting_audio`: 正在提取音频
- `transcribing`: 正在生成字幕
- `segmenting`: 正在整理字幕
- `ready`: 可学习
- `failed`: 处理失败
- `cancelled`: 已取消

### 详情页空状态

- `uploaded`: 显示“开始生成字幕”按钮。
- `extracting_audio` / `transcribing` / `segmenting`: 显示处理进度并轮询详情接口。
- `failed`: 显示错误和“重试处理”按钮。
- `ready` 但字幕为空：显示“字幕为空，请重新处理或导入字幕”。

### 字幕同步

当前字幕判定：

```ts
subtitle.start_seconds <= currentTime && currentTime < subtitle.end_seconds
```

如果当前时间落在字幕间隔中：

- 保持上一句高亮，直到下一句开始；或
- 不高亮任何句子。

MVP 推荐保持上一句高亮，学习体验更连续。

## 9. 测试计划

### 后端

必测：

- 未登录访问返回 401。
- 用户不能读取、删除、处理他人的视频。
- 上传超大文件返回 400 或 413。
- 非允许扩展名返回 400。
- 处理失败时 `VideoLesson.Status=failed` 且保存可读错误。
- 转写结果为空时状态为 `failed` 或 `ready` 但字幕为空，二者要统一。
- 字幕按 `sort_order` 返回。

建议测试：

- `TranscriptionSegment` 清洗和切分。
- `ffmpeg` 不存在时错误可读。
- provider mock 返回典型片段、空片段、乱序片段。

### 前端

手工验证：

- 未登录访问 `/study/videos` 跳转登录。
- 上传按钮在上传中 disabled。
- 处理中的视频会刷新状态。
- ready 视频能播放。
- 点击字幕能跳转。
- 播放时当前字幕高亮移动。
- 查词和加入生词本使用当前字幕作为 context。
- 移动端字幕区域不遮挡播放器控制条。

命令验证：

```bash
cd frontend
npm run lint
npm run build
```

## 10. 实现注意事项

- 不要把视频转写长任务放在 HTTP 请求同步等待里。上传接口应快速返回，处理任务异步推进。
- MVP 使用 goroutine 可以接受，但要把处理逻辑封装为 service，后续才能替换成 Redis queue、Asynq 或 worker。
- 不要把 OpenAI、Whisper 或其他 provider 的返回结构泄漏到前端。前端只依赖 `VideoSubtitle`。
- 不要在前端页面中直接写 `/api/video-lessons` 字符串，必须通过 `videoLessonAPI`。
- 视频文件和音频文件路径返回前端时使用 `/storage/...` 相对路径，前端通过 `resolveAPIAssetURL` 转成完整 URL。
- 删除文件要限制在配置的 storage 根目录内，防止路径穿越。
- 只做文档或小范围变更时不需要跑全量构建；代码实现后必须按改动范围验证。

## 11. 推荐拆分任务

可以按以下任务逐步开发：

1. `Add video learning models and config`
2. `Add video lesson upload and list APIs`
3. `Add video transcription service`
4. `Add video subtitle APIs`
5. `Add video lesson list page`
6. `Add video study player page`
7. `Connect subtitles to dictionary and vocabulary`
8. `Add subtitle import and edit support`
9. `Add listening practice modes`

每个任务都应保持可运行、可验证，不要一次性把所有阶段塞进一个大改动。

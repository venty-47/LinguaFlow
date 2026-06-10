# YouTube 字幕功能技术调研

本文只说明 YouTube 字幕能力本身和可复现的通用工程方案，不涉及任何具体业务系统设计。

## 1. 功能范围

YouTube 的字幕能力可以拆成四层：

1. 字幕轨道管理：一个视频可以关联多条字幕轨道，例如人工字幕、自动语音识别字幕、强制字幕、不同语言字幕。
2. 自动字幕生成：上传视频后，平台从音频中识别语音并生成带时间戳的文本片段。
3. 自动同步：创作者可以提供无时间戳或弱时间戳的文字稿，由平台将文字稿与视频音频对齐。
4. 播放器呈现：播放器按当前播放时间选择字幕 cue，并叠加显示在视频画面上，同时支持用户切换语言、开关字幕、自动翻译等能力。

公开资料可确认：

- YouTube 使用语音识别技术和机器学习算法生成自动字幕，字幕质量会受发音、口音、方言、背景噪声影响。
- YouTube 的自动字幕不一定在上传后立即可用，处理时间取决于音频复杂度。
- YouTube Data API 将自动语音识别字幕轨道标记为 `ASR`，并提供字幕轨道的 list、insert、update、download、delete 等管理接口。
- YouTube 支持上传多种字幕文件格式，基础格式包括 `.srt`、`.sbv/.sub`、`.mpsub`、`.lrc` 等，高级格式包括 `.smi/.sami`、`.rt`、`.vtt`、`.ttml/.dfxp` 等。

公开资料没有披露 YouTube 当前生产系统的完整内部模型、训练数据、服务框架、分布式调度细节、质量评估阈值和线上实验策略。因此，下文中涉及“内部流水线”的内容属于基于公开能力和行业通用做法的工程推断。

## 2. 关键公开接口和格式

### 2.1 字幕轨道模型

YouTube Data API 的 `captions` resource 表示一条字幕轨道。一条轨道关联一个视频，核心字段包括：

- `videoId`：关联的视频。
- `language`：BCP-47 语言标签。
- `trackKind`：轨道类型，公开枚举包括 `ASR`、`forced`、`standard`。
- `isCC`：是否为面向听障用户的闭字幕。
- `isDraft`：是否为草稿。
- `isAutoSynced`：是否由 YouTube 同步到音频。
- `status`：字幕轨道处理状态，例如 `serving`、`syncing`、`failed`。
- `failureReason`：失败原因，例如处理失败或格式不支持。

这说明 YouTube 在数据模型上把“字幕轨道”作为独立资源管理，而不是把字幕文本直接内嵌在视频对象里。

### 2.2 字幕文件格式

基础字幕格式本质是“时间范围 + 文本”：

```srt
1
00:00:00,599 --> 00:00:04,160
Hello, my name is Alice.

2
00:00:04,160 --> 00:00:06,770
And this is John.
```

Web 场景更常用 WebVTT：

```vtt
WEBVTT

00:00.599 --> 00:04.160
Hello, my name is Alice.

00:04.160 --> 00:06.770
And this is John.
```

WebVTT 的核心概念是 cue：每个 cue 有开始时间、结束时间和文本 payload。浏览器可以通过 `<track>` 元素加载 VTT，也可以通过 JavaScript 的 `TextTrack` / `VTTCue` API 动态创建 cue。字幕样式可以通过 `video::cue` 控制。

### 2.3 播放器能力

YouTube 嵌入播放器可以通过 `<iframe>` 或 IFrame Player API 接入。公开参数包括：

- `cc_load_policy=1`：优先显示字幕。
- `enablejsapi=1`：允许通过 IFrame Player API 控制播放器。
- `playerVars`：IFrame Player API 创建播放器时的参数入口。

在通用 HTML5 播放器里，字幕显示通常依赖：

- `<video controls>`
- `<track kind="captions" src="captions.vtt" srclang="en" default>`
- 浏览器原生 TextTrack 引擎
- `timeupdate` / `cuechange` 事件
- CSS `::cue` 样式

如果需要自定义双语字幕、逐词高亮、点击字幕跳转、学习笔记等高级交互，通常会在原生字幕轨道之外维护一份结构化 cue 数据，由应用自己渲染字幕面板和当前句高亮。

## 3. 自动字幕生成流水线

公开资料确认 YouTube 的自动字幕由 ASR 技术生成。一个可复现的自动字幕工程流水线如下：

```text
视频上传
  -> 媒体探测
  -> 音频抽取/转码
  -> 语音活动检测 VAD
  -> 语音识别 ASR
  -> 标点/大小写恢复
  -> 句子切分与字幕分段
  -> 时间戳修正/强制对齐
  -> 质量评估
  -> 生成字幕轨道
  -> 播放器加载与用户编辑
```

### 3.1 媒体探测

系统读取容器、编码、时长、音频轨、采样率、声道数、码率等信息，常用工具是 FFmpeg / ffprobe。

需要得到的信息：

- 视频时长。
- 是否存在音频轨。
- 音频采样率和声道。
- 文件大小和 MIME。
- 是否需要转码。

### 3.2 音频抽取和转码

ASR 通常不直接吃原始视频容器，而是先抽取音频并转为模型稳定支持的格式，例如：

- 单声道。
- 16 kHz 或 48 kHz 采样率。
- WAV / FLAC / MP3 / M4A。
- 分片后的短音频块。

典型命令：

```bash
ffmpeg -i input.mp4 -vn -ac 1 -ar 16000 output.wav
```

### 3.3 VAD 语音活动检测

VAD 用于找出有语音的时间区间，跳过静音、音乐或长时间空白。这样可以降低 ASR 成本并改善字幕分段。

输出示例：

```json
[
  { "start": 0.52, "end": 7.84 },
  { "start": 8.91, "end": 14.20 }
]
```

### 3.4 ASR 语音识别

ASR 模型把音频转换为文本。现代方案通常是深度学习模型，能力包括：

- 多语言识别。
- 语言检测。
- 词级或片段级时间戳。
- 噪声鲁棒性。
- 专有名词、口音、领域词汇适配。

可选技术栈：

- Google / YouTube 内部 ASR：公开资料只确认 YouTube 使用 Google 语音识别和机器学习，内部模型细节未公开。
- Whisper：开源通用 ASR，适合自托管或离线处理。
- FunASR / SenseVoice：偏工程化的自托管 ASR 方案，支持 OpenAI 兼容接口、VAD、标点、说话人等能力。
- 云厂商 STT：Google Cloud Speech-to-Text、Azure Speech、AWS Transcribe 等。

ASR 输出通常包括全文和 segment：

```json
{
  "language": "en",
  "text": "hello everyone today we will talk about...",
  "segments": [
    {
      "start": 0.52,
      "end": 3.40,
      "text": "Hello everyone.",
      "confidence": 0.91
    }
  ]
}
```

### 3.5 标点、大小写和规范化

ASR 原始输出可能缺少标点或大小写。字幕系统会做后处理：

- 恢复句号、逗号、问号。
- 英文首字母大小写。
- 数字规范化，决定显示 `twenty twenty four` 还是 `2024`。
- 去除重复词、口吃、明显识别噪声。
- 插入非语音提示，例如 `[music]`、`[applause]`。YouTube 当前英文自动字幕还支持更具表现力的非语音和语气提示。

### 3.6 字幕分段

字幕不是简单按 ASR segment 原样显示，还需要符合阅读体验：

- 单条字幕持续时间通常不宜太短。
- 单条字幕字数不宜过长。
- 避免在短语中间断行。
- 避免字幕重叠。
- 当前 cue 与下一 cue 之间保留合理间隔。
- 长句按语义和停顿拆分。

常见规则：

- 每条字幕 1 到 7 秒。
- 每行 32 到 42 个字符左右。
- 最多 1 到 2 行。
- 阅读速度控制在可接受范围，例如英文 12 到 20 chars/sec，具体阈值按产品目标调整。

### 3.7 时间戳匹配和自动同步

字幕“匹配视频”的核心是时间对齐。存在三种场景：

1. ASR 直接输出 segment 时间戳。
2. 用户上传已有时间戳的 SRT/VTT，系统直接按时间显示。
3. 用户上传无时间戳文字稿，系统把文字稿和音频强制对齐。

第三种就是 YouTube 早期公开提到的 auto-timing / automatic caption timing：创作者提供完整文字稿，系统使用 ASR 技术判断每个词何时被说出，再生成字幕时间码。

工程上可用的匹配方法：

- ASR token 时间戳：模型直接输出词级或片段级时间。
- Forced alignment：已知文本 + 音频，使用声学模型或 CTC 对齐算法得到词级时间。
- Dynamic Time Warping：把 ASR 结果和人工文字稿做序列匹配，修正缺词、重复、插入。
- 文本相似度对齐：用编辑距离、token overlap、embedding similarity 把字幕句和 ASR 片段对齐。
- VAD 边界修正：把 cue start/end 吸附到语音活动边界附近。

一个简化匹配算法：

```text
输入：人工文字稿 sentences，ASR segments
1. 规范化两边文本：小写、去标点、数字规整。
2. 把 ASR segments 展开为 token 序列，每个 token 带时间估计。
3. 用编辑距离或 DTW 将 transcript token 对齐到 ASR token。
4. 每个 sentence 的 start 取第一个匹配 token 的时间。
5. 每个 sentence 的 end 取最后一个匹配 token 的时间。
6. 对无匹配 sentence 使用相邻 cue 插值或标记为需人工校验。
7. 合并过短 cue，拆分过长 cue，消除重叠。
```

### 3.8 翻译字幕

YouTube 公开视频能力包含字幕自动翻译。通用实现方式是：

1. 先确定源字幕轨道。
2. 逐 cue 或按上下文批量翻译。
3. 保留源 cue 的时间戳。
4. 生成目标语言字幕轨。
5. 播放时让用户选择原文、译文、双语或关闭。

关键问题：

- 逐 cue 翻译上下文不足，容易代词和术语错误。
- 大批量翻译会破坏每条 cue 的长度约束。
- 更好的做法是按段落批量翻译，再对齐回 cue。

## 4. 播放端字幕匹配

播放器不需要“搜索”字幕。播放端匹配是一个时间区间查询：

```text
currentTime = video.currentTime
activeCue = cues.find(cue.start <= currentTime < cue.end)
```

为避免每次线性扫描，可用：

- 当前 index 游标：视频正常播放时只向前推进。
- 二分查找：拖动进度条时按 start 时间查找。
- interval tree：字幕很多且有重叠轨道时使用。

伪代码：

```ts
function findActiveCue(cues: Cue[], time: number): Cue | null {
  let left = 0;
  let right = cues.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (cues[mid].start <= time) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (result >= 0 && time < cues[result].end) return cues[result];
  return null;
}
```

## 5. 编辑和质量闭环

YouTube 鼓励创作者检查和编辑自动字幕。字幕系统一般需要：

- 自动字幕可编辑。
- 保留 `auto`、`manual`、`edited`、`imported` 等来源。
- 保存置信度。
- 对低置信度 cue 标记人工复核。
- 支持导入/导出 SRT、VTT。
- 支持重新生成或局部重新识别。
- 支持版本历史和回滚。

质量指标：

- WER：Word Error Rate，词错误率。
- CER：Character Error Rate，字符错误率。
- 时间偏移：cue start/end 与真实语音边界的偏差。
- 阅读速度：字符数 / 秒。
- 重叠率：cue 时间重叠和冲突。
- 人工编辑率：自动结果上线后被修改的比例。

## 6. 推荐通用技术选型

### 6.1 后端处理

- 媒体处理：FFmpeg / ffprobe。
- 异步任务：队列系统，例如 Redis queue、Sidekiq、Celery、BullMQ、Temporal、Asynq 等。
- ASR：Whisper、FunASR/SenseVoice、云厂商 STT 或自研模型。
- 对齐：ASR 时间戳优先；无时间戳文字稿使用 forced alignment 或 DTW。
- 存储：对象存储保存视频、音频、VTT/SRT；关系数据库保存结构化字幕 cue。
- 缓存：Redis 缓存处理状态、热门字幕轨、播放器元数据。

### 6.2 前端播放

- 原生 HTML5 `<video>` + `<track>`：适合标准字幕。
- TextTrack / VTTCue API：适合动态字幕和浏览器原生渲染。
- 自定义字幕层：适合双语、逐词高亮、点击查词、逐句循环、字幕编辑器。
- Video.js / Shaka Player / hls.js：适合 HLS/DASH、多码率、跨浏览器一致性要求更高的场景。

### 6.3 字幕格式

建议内部结构化存储，外部导入导出支持通用格式：

- 内部：JSON cue rows，包含 `start_seconds`、`end_seconds`、`text`、`translation`、`confidence`、`source`。
- 播放：WebVTT。
- 导入导出：SRT、VTT。
- 搜索：字幕文本入全文索引或向量索引。

## 7. 关键风险

- 自动字幕不是无障碍合规的充分条件，专业场景仍需要人工校对。
- 背景噪声、多人重叠说话、强口音、专有名词会显著降低 ASR 准确率。
- ASR 可能产生幻觉或不适当内容，需要敏感词和低置信度复核策略。
- 自动翻译字幕不能只按单句处理，长上下文和术语表会影响质量。
- 播放端自定义字幕层要处理全屏、移动端、画中画、倍速、拖动、键盘可访问性。

## 8. 资料来源

- YouTube Help: Use automatic captioning: https://support.google.com/youtube/answer/6373554
- YouTube Help: Supported subtitle and closed caption files: https://support.google.com/youtube/answer/2734698
- YouTube Data API captions resource: https://developers.google.com/youtube/v3/docs/captions
- YouTube embedded player parameters: https://developers.google.com/youtube/player_parameters
- Google Blog: Automatic captions in YouTube: https://googleblog.blogspot.com/2009/11/automatic-captions-in-youtube.html
- Google Research Blog: Automatic Captioning in YouTube: https://research.google/blog/automatic-captioning-in-youtube/
- MDN WebVTT API: https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API
- MDN `<track>` element: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/track
- W3C WebVTT specification: https://www.w3.org/TR/webvtt1/
- FFmpeg documentation: https://ffmpeg.org/ffmpeg.html
- OpenAI Whisper: https://openai.com/index/whisper/
- FunASR: https://github.com/modelscope/FunASR

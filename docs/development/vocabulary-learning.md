# 背单词功能实现文档

本文档用于指导 GuGuDu 背单词功能的产品设计、后端实现、前端实现和验证工作。目标是在现有生词本、词典、阅读器、学习统计和知识图谱能力之上，补齐一个可持续使用的「每日背单词」闭环，而不是新建一套与现有词汇系统并行的功能。

## 1. 背景与目标

GuGuDu 当前已经具备以下基础能力：

- 用户可在文章阅读页、AO3 阅读页和翻译 tooltip 中把单词加入生词本。
- 后端已有 `Vocabulary` 模型，记录单词、释义、音标、例句、上下文、复习次数、遗忘次数、下次复习时间和复习间隔。
- 后端已有简化 SRS 逻辑，支持 `forgot`、`hard`、`good` 三档反馈。
- 后端已有客观练习题接口，支持英译中选择、中译英拼写、语境填空、听音辨词、例句选义。
- 前端已有 `/vocabulary` 页面，支持列表、客观练习和单词知识图谱。
- `/study` 页面已有每日学习目标、待复习词入口和学习诊断。

本功能的目标不是“收藏单词列表”，而是让用户每天能稳定完成以下循环：

1. 从真实材料中保存生词，并保留语境。
2. 系统自动排出今日要复习的词。
3. 用户通过卡片、拼写、选择、听音、语境填空完成复习。
4. 系统根据表现更新下次复习时间和薄弱词状态。
5. 学习页展示今日进度、薄弱词和后续建议。

## 2. 设计原则

### 2.1 复用现有词汇域

背单词功能必须复用 `backend/models.Vocabulary`、`backend/handlers/translation.go` 中的词汇接口、`frontend/src/lib/api.ts` 中的 `vocabularyAPI` 和 `frontend/src/types/index.ts` 中的 `Vocabulary` 类型。

不要新增一套独立的 `Word`、`Flashcard` 或 `MemoryItem` 表来表示同一件事。只有当需要记录复习会话、单题作答历史或多来源归因时，才新增辅助表。

### 2.2 真实语境优先

平台定位是围绕真实英文材料学习。背单词页面应优先展示：

- 单词在原文中的上下文。
- 来源文章或来源作品。
- 例句和释义。
- 发音和拼写。
- 与同主题、同文章、同词形单词的关系。

不要把背单词做成脱离阅读来源的孤立词库。

### 2.3 每日闭环优先

背单词体验应围绕“今天该做什么”组织，而不是只提供全部词表。入口优先级：

1. `/study` 的“复习单词”目标卡。
2. `/vocabulary?mode=review` 的今日复习模式。
3. `/vocabulary?weak=true` 的薄弱词专项。
4. 文章或 AO3 阅读页内的即时复习按钮。

### 2.4 渐进实现

先把现有 `/vocabulary` 页面整理成稳定的背单词体验，再考虑新增更复杂的复习会话、统计图和词库导入。

## 3. 当前实现基线

### 3.1 后端模型

当前核心模型在 `backend/models/models.go`：

- `Vocabulary`
  - `user_id`
  - `word`
  - `phonetic`
  - `definition`
  - `translation`
  - `examples`
  - `article_id`
  - `context`
  - `is_learned`
  - `review_count`
  - `forgotten_count`
  - `last_review`
  - `next_review_at`
  - `review_interval`
  - `review_ease`

- `StudyGoal`
  - `daily_review_words`

- `StudyRecord`
  - `reviewed_words`

注意：`Vocabulary` 当前使用 `idx_user_word` 普通索引表达 `user_id + word` 查询关系，但不是数据库唯一约束。后端 `AddToVocabulary` 已做应用层查重。后续如果需要强并发防重，应把该索引改为组合唯一索引，并处理历史重复数据。

### 3.2 后端接口

当前已注册的登录态词汇接口：

```text
GET    /api/vocabulary
GET    /api/vocabulary/review-exercises
GET    /api/vocabulary/:id/knowledge-graph
POST   /api/vocabulary
PATCH  /api/vocabulary/:id/learned
POST   /api/vocabulary/:id/review
POST   /api/vocabulary/:id/review-answer
```

当前学习接口：

```text
GET /api/study/today
GET /api/study/diagnostics
PUT /api/study/goal
```

### 3.3 前端页面

当前主要页面和组件：

- `frontend/src/app/vocabulary/page.tsx`
  - 生词列表。
  - 今日复习筛选。
  - 薄弱词筛选。
  - 客观练习卡片。
  - 单词知识图谱。

- `frontend/src/app/study/page.tsx`
  - 每日复习目标。
  - 待复习词入口。
  - 薄弱词和学习诊断。

- `frontend/src/components/TranslationTooltip.tsx`
  - 查词。
  - 加入生词本。
  - 单词即时复习反馈。

## 4. 产品范围

### 4.1 MVP 范围

MVP 应把已有能力整理成稳定可用的背单词闭环：

- 今日复习队列。
- 复习卡片模式。
- 选择题和输入题。
- 答案提交和即时反馈。
- `forgot`、`hard`、`good` 三档 SRS 更新。
- 发音播放。
- 薄弱词专项。
- 学习目标进度更新。
- 空状态、加载态、错误态。
- 手机和桌面布局。

### 4.2 非 MVP 范围

以下功能可以后续做，不应阻塞第一版：

- 用户自定义词书。
- 批量导入 CSV。
- 每道题的完整作答历史。
- 复杂 FSRS/SM-2 参数调优界面。
- 排行榜、社交打卡。
- 离线背单词。
- 后台管理词库。

## 5. 用户流程

### 5.1 保存生词

用户在文章、AO3 或后续视频学习页面中选中单词：

1. 前端调用词典或翻译接口获取释义、音标和例句。
2. 用户点击加入生词本。
3. 前端调用 `POST /api/vocabulary`。
4. 后端按当前用户和单词查重。
5. 新词保存 `context`、`article_id`、`translation`、`definition`、`examples`。
6. 后端同步知识图谱。
7. 前端把该词标记为已收藏，并在阅读器中高亮旧词。

### 5.2 今日复习

用户从 `/study` 点击“去复习”：

1. 进入 `/vocabulary?mode=review`。
2. 前端请求 `GET /api/vocabulary/review-exercises?due=true&limit=30`。
3. 后端返回到期词和未学习词生成的练习题。
4. 用户逐题作答。
5. 前端调用 `POST /api/vocabulary/:id/review-answer`。
6. 后端判断正确性，转换成 `good`、`hard` 或 `forgot`。
7. 后端更新 SRS 字段、知识图谱和 `StudyRecord.reviewed_words`。
8. 前端展示正确答案，并移除已完成题。

### 5.3 快速自评

用户在列表或 tooltip 中点击“忘记 / 模糊 / 记得”：

1. 前端调用 `POST /api/vocabulary/:id/review`。
2. 后端直接按用户选择更新 SRS。
3. 后端计入今日复习数量。
4. 前端更新该词卡片的状态。

### 5.4 薄弱词专项

用户从学习诊断或 `/vocabulary` 切到薄弱词：

1. 前端使用 `weak=true` 请求或本地筛选 `forgotten_count > 0`。
2. 后端优先按 `forgotten_count DESC` 排序。
3. 客观题模式优先返回用户最常忘的词。
4. 练习完成后，若持续答对，词仍保留历史遗忘次数，但 `next_review_at` 会后移，掌握度会提升。

## 6. 后端设计

### 6.1 路由归属

词汇接口继续放在登录保护组：

```go
protected.GET("/vocabulary", handlers.GetVocabulary)
protected.GET("/vocabulary/review-exercises", handlers.GetVocabularyReviewExercises)
protected.GET("/vocabulary/:id/knowledge-graph", handlers.GetVocabularyKnowledgeGraph)
protected.POST("/vocabulary", handlers.AddToVocabulary)
protected.PATCH("/vocabulary/:id/learned", handlers.MarkWordLearned)
protected.POST("/vocabulary/:id/review", handlers.ReviewVocabulary)
protected.POST("/vocabulary/:id/review-answer", handlers.SubmitVocabularyReviewAnswer)
```

所有查询必须带 `user_id` 条件，不允许用户通过词汇 ID 访问他人的词。

### 6.2 数据模型建议

MVP 可继续使用现有字段。后续增强时可以考虑新增以下字段：

```go
NormalizedWord string `gorm:"size:100;index" json:"normalized_word"`
SourceType     string `gorm:"size:50;index" json:"source_type"`
SourceID       string `gorm:"size:100;index" json:"source_id"`
MasteryLevel   int    `gorm:"default:0;index" json:"mastery_level"`
```

字段含义：

- `normalized_word`：统一小写、去标点后的查重词，避免 `Word`、`word`、`word,` 形成重复。
- `source_type`：`article`、`ao3`、`video`、`manual`。
- `source_id`：对应来源的稳定 ID 或 slug。
- `mastery_level`：可选的 0-100 掌握度冗余字段，便于排序和统计。

如果新增字段，必须同步：

- `backend/models/models.go`
- `backend/database` auto migration 影响评估
- `frontend/src/types/index.ts`
- `frontend/src/lib/api.ts`
- 相关页面读取逻辑

### 6.3 查重策略

当前 `AddToVocabulary` 使用原始 `word` 查重：

```go
database.DB.Where("user_id = ? AND word = ?", userID, req.Word)
```

建议后续改为：

1. 后端 trim 输入。
2. 使用已有或新增的 normalize 函数统一小写、去首尾标点。
3. 用 `user_id + normalized_word` 查重。
4. 数据库层增加组合唯一约束。
5. 对唯一冲突返回已存在的词，而不是返回 500。

### 6.4 SRS 规则

当前 `applyVocabularyReview` 规则如下：

- `forgot`
  - 间隔重置为 1 天。
  - `review_ease` 减少 0.2。
  - `is_learned = false`。
  - `forgotten_count + 1`。

- `hard`
  - 初始间隔为 1 天。
  - 非初始间隔约乘以 1.4。
  - `review_ease` 减少 0.05。
  - `is_learned = false`。

- `good`
  - 初始间隔为 2 天。
  - 非初始间隔按 `interval * ease` 增长，且至少比当前间隔多 1 天。
  - `review_ease` 增加 0.05。
  - 当 `review_count >= 2` 或间隔达到 7 天后标记为已掌握。

- 所有反馈
  - `review_ease` 下限为 1.3。
  - `review_count + 1`。
  - 更新 `last_review`。
  - 设置 `next_review_at = now + interval days`。

MVP 不需要替换算法。若后续切换到 FSRS 或更复杂算法，应先把 SRS 逻辑从 `translation.go` 提取到 `backend/services/vocabulary_review.go`，并添加单元测试。

### 6.5 练习题生成

当前题型：

```text
en_to_zh_choice       英译中选择
zh_to_en_spelling     中译英拼写
context_fill_blank    原文语境填空
audio_word_choice     听音辨词
sentence_meaning_choice 例句中选义
```

题型选择规则：

- 基础候选为英译中选择、中译英拼写、听音辨词。
- 有上下文且上下文包含目标词时，加入语境填空。
- 有例句时，加入例句选义。
- 按词在队列中的 index 取模分配题型。

后续优化方向：

- 对遗忘次数高的词增加拼写题比例。
- 对发音薄弱词增加听音题比例。
- 对有上下文的词优先出语境填空。
- 避免连续多题同题型。
- 干扰项按同主题、同词性或同文章优先选择。

### 6.6 客观题答案判定

当前规则：

- 选择题必须与标准答案 normalize 后完全一致。
- 拼写、填空、听音题按 normalize 后的英文单词完全一致。
- 中译英拼写如果接近正确答案，返回 `hard` 而不是 `forgot`。
- 接近拼写包括：
  - 用户答案是正确答案前缀，且只差不超过 2 个字符。
  - Levenshtein 距离不超过 1。

### 6.7 学习统计

每次有效复习后调用 `addStudyReviewedWord(userID)`：

- 创建或获取当天 `StudyRecord`。
- `reviewed_words + 1`。
- 根据 `StudyGoal` 更新 `is_completed`。

注意事项：

- 如果后续引入复习会话，需要决定“同一个词一天重复复习多次”是否多次计入目标。
- MVP 可以保持当前行为，所有提交都计入。
- 如果要去重，应新增 `VocabularyReviewLog` 或 `StudyRecord` 明细表，而不是在前端推断。

## 7. API 合同

### 7.1 获取生词

```http
GET /api/vocabulary?due=true&weak=false&article_id=123
```

响应：

```json
{
  "data": [
    {
      "id": 1,
      "word": "resilient",
      "phonetic": "/rɪˈzɪliənt/",
      "translation": "有韧性的；能复原的",
      "context": "The system proved resilient under pressure.",
      "is_learned": false,
      "review_count": 2,
      "forgotten_count": 1,
      "last_review": "2026-06-08T10:00:00Z",
      "next_review_at": "2026-06-09T10:00:00Z",
      "review_interval": 1,
      "review_ease": 2.3,
      "created_at": "2026-06-01T10:00:00Z",
      "updated_at": "2026-06-08T10:00:00Z"
    }
  ]
}
```

### 7.2 获取复习题

```http
GET /api/vocabulary/review-exercises?due=true&weak=false&limit=30
```

响应：

```json
{
  "data": [
    {
      "vocabulary_id": 1,
      "word": "resilient",
      "type": "context_fill_blank",
      "prompt": "根据原文语境补全空缺单词",
      "context": "The system proved ____ under pressure.",
      "placeholder": "_________"
    }
  ]
}
```

### 7.3 提交客观题答案

```http
POST /api/vocabulary/1/review-answer
Content-Type: application/json

{
  "type": "context_fill_blank",
  "answer": "resilient"
}
```

响应：

```json
{
  "message": "Review answer saved",
  "data": {
    "id": 1,
    "word": "resilient",
    "is_learned": false,
    "review_count": 3,
    "forgotten_count": 1,
    "next_review_at": "2026-06-11T10:00:00Z",
    "review_interval": 2,
    "review_ease": 2.35
  },
  "correct": true,
  "rating": "good",
  "correct_answer": "resilient"
}
```

### 7.4 提交自评

```http
POST /api/vocabulary/1/review
Content-Type: application/json

{
  "rating": "hard"
}
```

响应：

```json
{
  "message": "Review saved",
  "data": {
    "id": 1,
    "word": "resilient",
    "review_count": 4,
    "review_interval": 2,
    "review_ease": 2.3
  }
}
```

## 8. 前端设计

### 8.1 页面结构

继续使用 `/vocabulary` 作为背单词主页面，支持以下模式：

- `?mode=review`：默认进入客观练习。
- `?weak=true`：薄弱词专项。
- 默认列表：查看和管理全部生词。
- 图谱模式：查看单词语义、来源、上下文和关系。

页面顶部应展示：

- 总词数。
- 已掌握数量。
- 今日待复习数量。
- 薄弱词数量。
- 当前练习进度。

### 8.2 建议拆分组件

当前 `frontend/src/app/vocabulary/page.tsx` 承载了较多逻辑。后续扩展时建议拆成：

```text
frontend/src/components/vocabulary/VocabularySummary.tsx
frontend/src/components/vocabulary/VocabularyFilters.tsx
frontend/src/components/vocabulary/VocabularyReviewCard.tsx
frontend/src/components/vocabulary/VocabularyList.tsx
frontend/src/components/vocabulary/VocabularyGraphPanel.tsx
frontend/src/lib/vocabulary.ts
```

其中：

- `VocabularyReviewCard` 负责单题展示、输入、选项和答案反馈。
- `VocabularyList` 负责词卡列表和快速自评。
- `VocabularyGraphPanel` 负责单词图谱。
- `frontend/src/lib/vocabulary.ts` 放 `isDue`、答案状态、日期格式等纯函数。

拆分时保持 API 调用集中在页面或专门 hook 中，展示组件通过 props 接收数据和回调。

### 8.3 复习卡片交互

卡片应覆盖以下状态：

- 加载题目。
- 无待复习词。
- 展示题目。
- 选项题已选择但未提交。
- 输入题未填写。
- 提交中。
- 回答正确。
- 回答错误。
- 显示正确答案。
- 进入下一题。

按钮规则：

- 未填写答案时禁用“提交答案”。
- 已提交后禁用选项和输入框。
- 已提交后显示“下一题”。
- `audio_word_choice` 必须提供发音播放按钮。
- 网络错误应展示可读中文错误，不只写 `console.error`。

### 8.4 发音策略

MVP 可以继续使用浏览器 `speechSynthesis`。如果后续要接入后端 TTS：

1. 优先使用词典返回的 `speech_url`、`uk_speech_url`、`us_speech_url`。
2. 没有词典音频时调用 `/api/tts`。
3. 最后回退到 `speechSynthesis`。

不要在每张卡片加载时自动请求 TTS，避免成本和延迟失控。

### 8.5 与学习页联动

`/study` 页面应保持以下入口：

- 今日目标卡中的“复习单词”跳到 `/vocabulary?mode=review`。
- 薄弱词诊断跳到 `/vocabulary?weak=true`。
- 知识图谱建议跳到 `/vocabulary?mode=review` 或具体图谱入口。

完成复习后，如果用户返回 `/study`，应重新拉取 `studyAPI.getToday()`，避免进度显示过期。

## 9. 视觉和体验要求

背单词页面属于学习工具，不做营销式 hero。界面应保持安静、可扫描、重复使用友好：

- 使用紧凑工具栏和清晰的题卡。
- 筛选使用分段按钮。
- 题型使用小标签。
- 复习动作按钮使用稳定尺寸，避免答题后布局跳动。
- 列表卡片半径不超过现有设计习惯。
- 移动端题卡、选项和输入框不能溢出。
- 不使用大面积单一色系背景。
- 错误、空状态和加载状态必须可见。

## 10. 数据与迁移风险

### 10.1 重复词

当前应用层查重不防并发重复。若添加唯一约束，迁移前必须：

1. 找出同一用户下 normalize 后重复的词。
2. 保留较早创建或复习数据更完整的一条。
3. 合并 `review_count`、`forgotten_count`、`last_review`、`next_review_at`。
4. 迁移知识图谱引用。
5. 删除重复记录或软删除重复记录。

### 10.2 JSON 字段

`definition` 和 `examples` 当前可能是 JSON 字符串，也可能是普通文本。前端渲染时不能假设一定是合法 JSON。后端生成题目时已经做了容错解析，前端新增展示也应保持容错。

### 10.3 时区

`next_review_at` 使用后端 `time.Now()`。前端判断是否到期时按浏览器时间比较。短期可接受，后续如果要严格按用户本地日历复习，应在用户设置中引入时区，并让后端按用户时区计算“今日到期”。

## 11. 安全与权限

- 所有词汇接口必须登录。
- 所有词汇查询必须带 `user_id`。
- 不从 body 接受 `user_id`。
- 不返回其他用户的文章来源或词汇。
- 用户输入的 `word`、`context`、`translation`、`definition` 要限制长度。
- 外部词典或 TTS 错误不要直接泄露 provider token、完整 URL 或外部原始响应。
- 如果未来支持导入词表，必须限制文件大小、行数和字段长度。

## 12. 测试计划

### 12.1 后端单元测试

优先补充：

- `applyVocabularyReview`
  - `forgot` 重置间隔并增加遗忘次数。
  - `hard` 增加较短间隔。
  - `good` 增加间隔并可能标记掌握。
  - `review_ease` 不低于 1.3。

- 练习题生成
  - 有上下文时生成语境填空。
  - 有例句时生成例句选义。
  - 干扰项不足时使用 fallback。
  - 选项不重复。

- 答案判定
  - 选择题严格匹配。
  - 英文拼写 normalize 后匹配。
  - 近似拼写返回 `hard`。
  - 空答案返回错误或判错。

后端验证命令：

```bash
cd backend
go test ./...
go build ./...
```

### 12.2 前端验证

当前前端未配置测试 runner。实现或调整页面后至少运行：

```bash
cd frontend
npm run lint
npm run build
```

手动验证：

- 未登录访问 `/vocabulary` 应跳转或显示登录状态。
- 无生词时显示空状态。
- 有到期词时进入复习卡片。
- 选择题提交后显示正确答案。
- 拼写题正确、错误、近似正确都能得到合理反馈。
- 听音题播放按钮可用。
- 点击下一题会移除当前题。
- 快速自评会更新词卡状态。
- `/study` 今日复习进度会在刷新后增加。
- 手机宽度下按钮和文本不重叠。

## 13. 分阶段落地计划

### 阶段 1：整理现有背单词体验

目标：不改数据库，提升可用性和稳定性。

任务：

1. 检查 `/vocabulary?mode=review` 默认进入客观练习。
2. 为复习题请求、提交失败、列表加载失败增加可见错误提示。
3. 统一空状态文案。
4. 让完成复习后页面计数即时更新。
5. 抽出 `isDue` 等纯函数，减少页面重复逻辑。
6. 给 SRS 和答案判定补后端测试。

### 阶段 2：增强复习队列和题型质量

目标：让题目更贴近用户薄弱点。

任务：

1. 调整 `GetVocabularyReviewExercises` 排序权重。
2. 遗忘次数高的词优先出拼写、语境填空。
3. 有音标或词典音频的词优先支持听音题。
4. 干扰项优先从同文章、同主题、相近释义中选择。
5. 添加 `limit`、`due`、`weak` 参数测试。

### 阶段 3：数据质量和查重

目标：减少重复词和脏数据。

任务：

1. 新增 normalize 函数并用于添加词汇。
2. 评估新增 `normalized_word` 字段。
3. 清理历史重复词。
4. 增加 `user_id + normalized_word` 唯一约束。
5. 保证唯一冲突返回已有词。

### 阶段 4：复习会话与统计

目标：支持更精细的学习分析。

可选新增模型：

```go
type VocabularyReviewLog struct {
    ID           uint
    UserID       uint
    VocabularyID uint
    ExerciseType string
    Answer       string
    Correct      bool
    Rating       string
    ReviewedAt   time.Time
}
```

任务：

1. 每次 `review` 和 `review-answer` 写入日志。
2. 学习页展示正确率、连续复习天数、最弱题型。
3. 决定每日目标按“提交次数”还是“去重词数”统计。
4. 支持会话结束页，展示本次完成数、正确率、遗忘词。

## 14. 实现注意事项

- 不要把新背单词逻辑塞进 `main.go`。
- 复杂 SRS 或题目生成逻辑应迁移到 `backend/services/`。
- 新接口响应保持 `{ "data": ... }`。
- 前端请求继续放在 `frontend/src/lib/api.ts`。
- 修改后端 DTO 时同步 `frontend/src/types/index.ts`。
- 阅读器中的保存生词逻辑不要复制到背单词页面。
- 不要把 `Vocabulary` 的 JSON 字段在前端强行 `JSON.parse` 后无容错渲染。
- 不要把 `/api/admin/rss/import` 或其他无关接口描述为背单词依赖。

## 15. 推荐提交拆分

```text
Add vocabulary review tests
Improve vocabulary review error states
Extract vocabulary review card components
Tune vocabulary exercise queue
Normalize vocabulary word lookup
Add vocabulary review logs
```

第一版推荐只做前三个提交，避免把 UI、算法、迁移和统计混在同一次改动里。

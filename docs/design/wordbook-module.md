# 词书模块（WordBook）设计文档

## 1. 概述与目标

### 1.1 模块定位

词书模块是 LinguaFlow 上一个**独立的、以系统化词库驱动的主动背词**子系统。它与现有 `/vocabulary`(被动生词本)形成互补:

| 维度 | 现有 `/vocabulary` | 新词书模块 `/wordbook` |
|------|---------------------|------------------------|
| 词的来源 | 用户从文章/视频/AO3 被动收录 | 系统预置词库(四六级/考研/托福/GRE) |
| 学习节奏 | 用户自行决定何时复习 | 每日计划驱动(N 个新词 + 复习旧词) |
| 进度管理 | 无词书进度概念 | 词书维度进度(已学/总量)、单元推进 |
| UI 入口 | `/vocabulary` 复习+管理 | `/wordbook` 独立选书、学习、统计 |
| 数据结构 | `Vocabulary` 模型 | 新增 `WordBook`、`WordBookEntry`、`UserWordBook`、`UserWordBookProgress` |

### 1.2 用户故事

1. **选书与订阅**:作为一名备考 CET-6 的大学生,我想在词书库里浏览可用词书并选择 CET-6 高频 2500 词订阅,设定每天背 30 个新词。
2. **每日学习**:作为一名日常用户,我想每天早上打开 `/wordbook` 页面,看到今日要学的新词和要复习的旧词,按顺序完成学习任务。
3. **复习卡片**:作为一名用户,我想用翻卡片 + 自评(认识/模糊/忘了)的方式复习词书里的词,系统自动安排下次复习时间。
4. **进度追踪**:作为一名备考托福的用户,我想看到我在《托福核心 5000 词》上的整体进度、每日打卡日历和预估完成日期。
5. **联动生词本**:作为一名用户,我想在词书里学到的词自动出现在 `/vocabulary` 生词本中,让我在阅读文章时也能复习这些词。

### 1.3 非目标(明确不做什么)

- **不做** 用户自定义上传词库(V1 之后再考虑)
- **不做** 词根词缀拆解、联想记忆网络(V2 扩展)
- **不做** 社交排行、打卡分享、好友 PK
- **不做** 离线背词(PWA / Service Worker)
- **不做** 替换现有 `/vocabulary` 的复习体验(两者并存)
- **不做** 拼写训练 / 听写模式的完整版(MVP 只做自评卡片)

---

## 2. 数据模型设计

### 2.1 WordBook(词库/词书)

新建独立表 `word_books`。存储在 `backend/models/wordbook.go`。

```go
// WordBook 系统词库/词书
type WordBook struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

    // 基本信息
    Name        string `gorm:"size:200;not null;uniqueIndex:idx_wb_slug" json:"name"`
    NameEN      string `gorm:"size:200" json:"name_en"`
    Slug        string `gorm:"size:200;not null;uniqueIndex:idx_wb_slug" json:"slug"`
    Description string `gorm:"type:text" json:"description"`
    CoverImage  string `gorm:"size:500" json:"cover_image"`

    // 分类与难度
    Category    string `gorm:"size:50;not null;index" json:"category"`     // cet4, cet6, kaoyan, toefl, gre, ielts, custom
    Difficulty  string `gorm:"size:20;default:'medium'" json:"difficulty"` // beginner, medium, advanced
    CEFRLevel   string `gorm:"size:10" json:"cefr_level"`                 // A1-C2

    // 统计
    WordCount   int  `gorm:"default:0" json:"word_count"`    // 词条总数
    UnitCount   int  `gorm:"default:0" json:"unit_count"`    // 单元数
    IsPublished bool `gorm:"default:false;index" json:"is_published"`

    // 来源信息
    Source      string `gorm:"size:200" json:"source"`       // 词库来源
    License     string `gorm:"size:100" json:"license"`      // 版权说明
    Version     string `gorm:"size:50" json:"version"`       // 词库版本号

    // 关联
    Entries []WordBookEntry `gorm:"foreignKey:WordBookID" json:"entries,omitempty"`
}
```

索引说明:
- `idx_wb_slug`:`slug` 唯一索引,用于 URL 路由
- `category` 索引:按分类筛选词书列表
- `is_published` 索引:只展示已发布的词书

### 2.2 WordBookEntry(词条)

新建独立表 `word_book_entries`。一个词条属于一个词书。

```go
// WordBookEntry 词书中的一个词条
type WordBookEntry struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

    WordBookID uint   `gorm:"not null;index:idx_wbe_book_sort,priority:1" json:"word_book_id"`
    SortOrder  int    `gorm:"not null;index:idx_wbe_book_sort,priority:2" json:"sort_order"`
    Unit       int    `gorm:"default:0;index" json:"unit"` // 所属单元(0=无单元划分)

    // 词汇信息
    Word        string `gorm:"size:100;not null;index:idx_wbe_word" json:"word"`
    Phonetic    string `gorm:"size:100" json:"phonetic"`
    UKPhonetic  string `gorm:"size:100" json:"uk_phonetic"`
    USPhonetic  string `gorm:"size:100" json:"us_phonetic"`
    Definitions string `gorm:"type:text" json:"definitions"`  // JSON: [{pos, definition}]
    Translation string `gorm:"size:1000" json:"translation"`
    Examples    string `gorm:"type:text" json:"examples"`     // JSON: [{en, zh}]
    Collocations string `gorm:"type:text" json:"collocations"`

    // 元数据
    Frequency   int    `gorm:"default:0;index" json:"frequency"`
    Difficulty  string `gorm:"size:20;default:'medium'" json:"difficulty"`
    Tags        string `gorm:"size:500" json:"tags"`

    // 关联
    WordBook WordBook `gorm:"foreignKey:WordBookID" json:"word_book,omitempty"`
}
```

索引说明:
- `idx_wbe_book_sort`:`word_book_id + sort_order` 组合索引
- `idx_wbe_word`:`word` 索引,跨词书查重
- `unit` 索引:按单元筛选

### 2.3 UserWordBook(用户订阅的词书)

新建独立表 `user_word_books`。

```go
// UserWordBook 用户订阅的词书及计划配置
type UserWordBook struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

    UserID     uint `gorm:"not null;uniqueIndex:idx_uwb_user_book" json:"user_id"`
    WordBookID uint `gorm:"not null;uniqueIndex:idx_uwb_user_book" json:"word_book_id"`

    // 计划配置
    DailyNewWords    int  `gorm:"default:20" json:"daily_new_words"`
    DailyReviewWords int  `gorm:"default:50" json:"daily_review_words"`
    AutoPlayAudio    bool `gorm:"default:true" json:"auto_play_audio"`

    // 进度统计
    CurrentUnit       int    `gorm:"default:0" json:"current_unit"`
    LearnedCount      int    `gorm:"default:0" json:"learned_count"`
    MasteredCount     int    `gorm:"default:0" json:"mastered_count"`
    TotalStudiedDays  int    `gorm:"default:0" json:"total_studied_days"`
    CurrentStreak     int    `gorm:"default:0" json:"current_streak"`

    // 状态
    IsActive      bool       `gorm:"default:true;index" json:"is_active"`
    StartedAt     time.Time  `json:"started_at"`
    CompletedAt   *time.Time `json:"completed_at"`
    LastStudiedAt *time.Time `json:"last_studied_at"`

    // 关联
    User     User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
    WordBook WordBook `gorm:"foreignKey:WordBookID" json:"word_book,omitempty"`
}
```

### 2.4 UserWordBookProgress(用户在词书里每个词的学习进度)

新建独立表 `user_word_book_progresses`。

```go
// UserWordBookProgress 用户在词书中每个词的学习进度
type UserWordBookProgress struct {
    ID        uint           `gorm:"primarykey" json:"id"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

    UserID          uint `gorm:"not null;uniqueIndex:idx_uwbp_user_entry" json:"user_id"`
    UserWordBookID  uint `gorm:"not null;index" json:"user_word_book_id"`
    WordBookEntryID uint `gorm:"not null;uniqueIndex:idx_uwbp_user_entry" json:"word_book_entry_id"`
    VocabularyID    *uint `gorm:"index" json:"vocabulary_id"`

    // 学习状态
    Status       string     `gorm:"size:20;default:'new';index" json:"status"` // new, learning, mastered, skipped
    FirstSeenAt  *time.Time `json:"first_seen_at"`
    LastReviewAt *time.Time `json:"last_review_at"`

    // 间隔复习字段(独立于 Vocabulary,避免互相干扰)
    ReviewCount    int        `gorm:"default:0" json:"review_count"`
    ForgottenCount int        `gorm:"default:0;index" json:"forgotten_count"`
    ReviewInterval int        `gorm:"default:0" json:"review_interval"`
    ReviewEase     float64    `gorm:"default:2.5" json:"review_ease"`
    NextReviewAt   *time.Time `gorm:"index" json:"next_review_at"`
    IsLearned      bool       `gorm:"default:false" json:"is_learned"`

    // 关联
    User          User          `gorm:"foreignKey:UserID" json:"user,omitempty"`
    UserWordBook  UserWordBook  `gorm:"foreignKey:UserWordBookID" json:"user_word_book,omitempty"`
    WordBookEntry WordBookEntry `gorm:"foreignKey:WordBookEntryID" json:"word_book_entry,omitempty"`
    Vocabulary    *Vocabulary   `gorm:"foreignKey:VocabularyID" json:"vocabulary,omitempty"`
}
```

### 2.5 WordBookDailyRecord(打卡记录)

```go
// WordBookDailyRecord 词书每日学习记录(用于打卡日历)
type WordBookDailyRecord struct {
    ID        uint      `gorm:"primarykey" json:"id"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`

    UserWordBookID uint   `gorm:"not null;uniqueIndex:idx_wbdr_date" json:"user_word_book_id"`
    Date           string `gorm:"size:10;not null;uniqueIndex:idx_wbdr_date" json:"date"`

    NewLearned  int       `gorm:"default:0" json:"new_learned"`
    NewTotal    int       `gorm:"default:0" json:"new_total"`
    ReviewDone  int       `gorm:"default:0" json:"review_done"`
    ReviewTotal int       `gorm:"default:0" json:"review_total"`
    IsCompleted bool      `gorm:"default:false" json:"is_completed"`
    StudiedAt   time.Time `json:"studied_at"`
}
```

### 2.6 迁移策略

**原则:不动现有 `Vocabulary` 表的任何字段,新模块全部使用独立新表。**

1. 在 `backend/models/` 新建 `wordbook.go`,包含上述五个 struct。
2. 在 `backend/database/db.go` 的 `AutoMigrate` 调用中追加这五个模型。
3. 在 `backend/database/seed.go` 或新增 `backend/database/seed_wordbooks.go` 实现词书初始数据 seed。
4. 不修改 `backend/models/models.go` 中的 `Vocabulary` struct。

### 2.7 与现有 Vocabulary 模型的关系

采用**软关联、双向写入**策略:

- `UserWordBookProgress.VocabularyID` 是一个可空外键,指向 `Vocabulary.ID`。
- 当用户在词书中首次学习一个新词时,系统**同时**做两件事:
  1. 在 `UserWordBookProgress` 中创建进度记录。
  2. 检查该用户 `Vocabulary` 表中是否已有该词(按 `user_id + word` 查重),如果没有则自动创建一条 `Vocabulary` 记录,`Notes` 中标注来源 `[wordbook:slug]`。
- 如果用户已经通过文章划词添加了这个词,`VocabularyID` 指向已有记录,不重复创建。
- **复习调度独立**:词书进度使用 `UserWordBookProgress.NextReviewAt` 和 `ReviewInterval` 等字段,不修改 `Vocabulary.NextReviewAt`。这样 `/vocabulary` 的复习队列和 `/wordbook` 的复习队列互不干扰。
- **统计联动**:词书复习完成后调用已有的 `addStudyReviewedWord()` 函数(`backend/handlers/study.go` 约 201 行),计入 `StudyRecord.ReviewedWords`。

---

## 3. 词库数据来源方案

### 3.1 格式与存储

```
backend/data/wordbooks/
├── cet4_core_2500.json
├── cet6_core_2500.json
├── kaoyan_core_5500.json
├── toefl_core_8000.json
└── gre_core_3000.json
```

每个 JSON 文件的 schema:

```json
{
  "meta": {
    "name": "CET-4 核心 2500 词",
    "name_en": "CET-4 Core 2500",
    "slug": "cet4-core-2500",
    "category": "cet4",
    "difficulty": "beginner",
    "cefr_level": "A2-B1",
    "version": "1.0.0",
    "source": "教育部考试中心 CET-4 词汇大纲",
    "license": "educational-use"
  },
  "units": [
    {
      "unit": 1,
      "name": "List 1",
      "entries": [
        {
          "word": "abandon",
          "uk_phonetic": "/əˈbændən/",
          "us_phonetic": "/əˈbændən/",
          "definitions": [
            {"pos": "vt.", "definition": "to leave a place, thing, or person"},
            {"pos": "n.", "definition": "complete freedom of behavior"}
          ],
          "translation": "放弃;遗弃;放纵",
          "examples": [
            {"en": "He abandoned his wife and children.", "zh": "他抛弃了妻子和孩子。"},
            {"en": "They had to abandon the car.", "zh": "他们不得不弃车。"}
          ],
          "collocations": ["abandon hope", "abandon a plan"],
          "frequency": 1,
          "tags": ["高频"]
        }
      ]
    }
  ]
}
```

### 3.2 Seed 策略

1. 在 `backend/database/seed.go` 中新增 `SeedWordBooks()` 函数。
2. 读取 `backend/data/wordbooks/` 目录下所有 `.json` 文件。
3. 按 `slug` 做 `FirstOrCreate`,词条按 `word_book_id + word` 做 `ON CONFLICT DO NOTHING`。
4. 应用启动时自动 seed,不阻塞主流程。
5. 后续版本可改为管理后台手动上传。

### 3.3 初始内置词库

| 词书 | slug | 词量 | 优先级 |
|------|------|------|--------|
| CET-4 核心 2500 词 | `cet4-core-2500` | ~2500 | MVP |
| CET-6 核心 2500 词 | `cet6-core-2500` | ~2500 | MVP |
| 考研核心 5500 词 | `kaoyan-core-5500` | ~5500 | V1 |
| 托福核心 8000 词 | `toefl-core-8000` | ~8000 | V1 |
| GRE 核心 3000 词 | `gre-core-3000` | ~3000 | V1 |
| IELTS 核心 6000 词 | `ielts-core-6000` | ~6000 | V2 |

### 3.4 词库版权风险

- 优先使用公开的考试大纲词汇表(教育部考试中心、ETS 官方发布的词表属于公开信息)。
- 释义和例句需要自行编写或使用开放许可来源(如 Wiktionary CC BY-SA)。
- 避免直接复制商业词典内容(如牛津、朗文)。

---

## 4. 每日学习算法

### 4.1 核心参数

```go
const (
    DefaultDailyNewWords    = 20
    MinDailyNewWords        = 5
    MaxDailyNewWords        = 100
    DefaultDailyReviewWords = 50
    MinDailyReviewWords     = 10
    MaxDailyReviewWords     = 300
    MaxBacklogDays          = 3
    MaxBacklogWords         = 200
)
```

### 4.2 每日任务生成算法

```go
// GenerateDailyTasks 生成今日词书学习任务
func GenerateDailyTasks(db *gorm.DB, userID uint, ub UserWordBook) (*DailyTasks, error) {
    today := time.Now().Format("2006-01-02")

    // 1. 收集到期复习词
    var dueReviews []UserWordBookProgress
    db.Where("user_word_book_id = ? AND status IN ? AND next_review_at <= ?",
        ub.ID,
        []string{"learning", "mastered"},
        time.Now(),
    ).Order("next_review_at ASC, forgotten_count DESC").
    Limit(ub.DailyReviewWords).
    Find(&dueReviews)

    // 2. 计算新词释放数量
    newWordQuota := ub.DailyNewWords

    // 2a. 基于前一日复习完成度调整
    yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
    var yesterdayRecord WordBookDailyRecord
    if err := db.Where("user_word_book_id = ? AND date = ?", ub.ID, yesterday).
        First(&yesterdayRecord).Error; err == nil {
        if yesterdayRecord.ReviewDone > 0 && yesterdayRecord.ReviewTotal > 0 {
            completionRate := float64(yesterdayRecord.ReviewDone) / float64(yesterdayRecord.ReviewTotal)
            if completionRate < 0.6 {
                newWordQuota = max(5, newWordQuota/2)
            }
        }
    }

    // 2b. 堆积控制:积压复习词超过 MaxBacklogWords,暂停释放新词
    var backlogCount int64
    db.Model(&UserWordBookProgress{}).
        Where("user_word_book_id = ? AND status IN ? AND next_review_at <= ?",
            ub.ID, []string{"learning", "mastered"}, time.Now()).
        Count(&backlogCount)
    if int(backlogCount) > MaxBacklogWords {
        newWordQuota = 0
    }

    // 3. 选取新词
    var newEntries []WordBookEntry
    learnedEntryIDs := db.Model(&UserWordBookProgress{}).
        Where("user_word_book_id = ?", ub.ID).
        Select("word_book_entry_id")

    db.Where("word_book_id = ? AND id NOT IN (?)",
        ub.WordBookID, learnedEntryIDs,
    ).Order("sort_order ASC").
    Limit(newWordQuota).
    Find(&newEntries)

    return &DailyTasks{
        Date:          today,
        NewWords:      newEntries,
        ReviewWords:   dueReviews,
        TotalNew:      len(newEntries),
        TotalReview:   len(dueReviews),
        BacklogCount:  int(backlogCount),
        NewWordQuota:  newWordQuota,
    }, nil
}
```

### 4.3 复习调度(SM-2 风格)

复用现有 SM-2 算法逻辑(参考 `backend/handlers/translation.go` 第 678-722 行 `applyVocabularyReview`),操作 `UserWordBookProgress` 字段:

```go
// applyWordBookReview 对词书进度应用 SM-2 间隔复习
func applyWordBookReview(progress *UserWordBookProgress, rating string) error {
    now := time.Now()
    ease := progress.ReviewEase
    if ease <= 0 {
        ease = 2.5
    }
    interval := progress.ReviewInterval

    switch rating {
    case "forgot":
        interval = 1
        ease -= 0.2
        progress.IsLearned = false
        progress.ForgottenCount++
        progress.Status = "learning"
    case "hard":
        if interval < 1 {
            interval = 1
        } else {
            interval = maxInt(1, int(float64(interval)*1.4))
        }
        ease -= 0.05
        progress.IsLearned = false
    case "good":
        if interval < 1 {
            interval = 2
        } else {
            interval = maxInt(interval+1, int(float64(interval)*ease))
        }
        ease += 0.05
        if progress.ReviewCount >= 3 {
            progress.IsLearned = true
            progress.Status = "mastered"
        }
    default:
        return fmt.Errorf("rating must be forgot, hard, or good")
    }

    if ease < 1.3 {
        ease = 1.3
    }
    nextReview := now.AddDate(0, 0, interval)
    progress.ReviewCount++
    progress.ReviewInterval = interval
    progress.ReviewEase = ease
    progress.LastReviewAt = &now
    progress.NextReviewAt = &nextReview
    return nil
}
```

### 4.4 超时未完成处理

- **堆积上限**:当 `backlogCount > MaxBacklogWords` 时,新词释放暂停,前端显示提示"复习堆积较多,今日先巩固旧词"。
- **堆积提醒**:当 `backlogCount > MaxBacklogWords/2` 时,在 `/wordbook` 首页和 `/study` 仪表盘显示黄色提醒。
- **过期复习词**:超过 `MaxBacklogDays` 未完成的复习词不会丢失,只是排序靠后(`next_review_at ASC`),优先出更紧急的词。

### 4.5 与 Vocabulary 的兼容

- 词书学习时,系统调用已有 `addStudyReviewedWord(userID)` 更新 `StudyRecord.ReviewedWords`,让 `/study` 页面的"复习单词"目标也计入词书复习。
- 不修改 `Vocabulary.NextReviewAt`,两套复习队列独立运作。
- 如果用户在 `/vocabulary` 手动删除了一个词,对应的 `UserWordBookProgress.VocabularyID` 变为悬挂引用(可空外键),不影响词书进度。

---

## 5. API 设计

所有端点均需要 JWT 认证(`middleware.AuthRequired()`),路由注册在 `backend/main.go` 的 `protected` 组下。

### 5.1 词库列表

**`GET /api/wordbooks`**

请求参数:
- `category` (string, optional)
- `difficulty` (string, optional)
- `search` (string, optional)

响应:
```json
{
  "data": [
    {
      "id": 1,
      "name": "CET-4 核心 2500 词",
      "slug": "cet4-core-2500",
      "category": "cet4",
      "difficulty": "beginner",
      "word_count": 2500,
      "unit_count": 30,
      "description": "四级考试核心高频词",
      "cover_image": "...",
      "subscriber_count": 0
    }
  ]
}
```

### 5.2 词库详情

**`GET /api/wordbooks/:id`**

响应:
```json
{
  "data": {
    "id": 1,
    "name": "CET-4 核心 2500 词",
    "slug": "cet4-core-2500",
    "category": "cet4",
    "description": "...",
    "word_count": 2500,
    "unit_count": 30,
    "cefr_level": "A2-B1",
    "source": "教育部考试中心",
    "is_subscribed": false,
    "user_progress": null
  }
}
```

### 5.3 订阅词库

**`POST /api/wordbooks/:id/subscribe`**

请求体:
```json
{
  "daily_new_words": 20,
  "daily_review_words": 50
}
```

响应:
```json
{
  "message": "Subscribed",
  "data": {
    "id": 1,
    "word_book_id": 1,
    "daily_new_words": 20,
    "daily_review_words": 50,
    "is_active": true,
    "learned_count": 0,
    "started_at": "2025-06-15T10:00:00Z"
  }
}
```

错误码:
- `400` - 已订阅该词书
- `404` - 词书不存在

### 5.4 取消订阅

**`DELETE /api/wordbooks/:id/subscribe`**

### 5.5 重置进度

**`POST /api/wordbooks/:id/reset`**

请求体:
```json
{
  "confirm": true
}
```

### 5.6 调整每日计划

**`PATCH /api/wordbooks/:id/plan`**

请求体:
```json
{
  "daily_new_words": 30,
  "daily_review_words": 80
}
```

验证:`daily_new_words` 在 `[5, 100]` 内,`daily_review_words` 在 `[10, 300]` 内。

### 5.7 获取今日任务

**`GET /api/wordbooks/:id/today`**

响应:
```json
{
  "data": {
    "date": "2025-06-15",
    "new_words": [
      {
        "entry_id": 101,
        "word": "abandon",
        "phonetic": "/əˈbændən/",
        "us_phonetic": "/əˈbændən/",
        "uk_phonetic": "/əˈbændən/",
        "translation": "放弃;遗弃",
        "definitions": [{"pos": "vt.", "definition": "to leave..."}],
        "examples": [{"en": "...", "zh": "..."}],
        "status": "new"
      }
    ],
    "review_words": [
      {
        "progress_id": 55,
        "entry_id": 80,
        "word": "abstract",
        "translation": "抽象的;摘要",
        "status": "learning",
        "review_count": 2,
        "forgotten_count": 1,
        "next_review_at": "2025-06-15T00:00:00Z"
      }
    ],
    "total_new": 20,
    "total_review": 15,
    "backlog_count": 3,
    "new_word_quota": 20,
    "plan": {
      "daily_new_words": 20,
      "daily_review_words": 50
    }
  }
}
```

### 5.8 提交学习结果

**`POST /api/wordbooks/:id/learn`**(新词学习)

请求体:
```json
{
  "entry_id": 101,
  "rating": "good"
}
```

`rating` 可选值:`"good"`(认识)、`"hard"`(模糊)、`"forgot"`(忘了)。

响应:
```json
{
  "message": "Learned",
  "data": {
    "progress_id": 200,
    "entry_id": 101,
    "word": "abandon",
    "status": "learning",
    "next_review_at": "2025-06-17T..."
  }
}
```

**`POST /api/wordbooks/:id/review`**(复习)

请求体:
```json
{
  "progress_id": 55,
  "rating": "good"
}
```

### 5.9 词书统计

**`GET /api/wordbooks/:id/stats`**

响应:
```json
{
  "data": {
    "total_entries": 2500,
    "new_count": 500,
    "learning_count": 300,
    "mastered_count": 200,
    "skipped_count": 0,
    "learned_pct": 20,
    "mastered_pct": 8,
    "estimated_days_remaining": 80,
    "current_streak": 5,
    "total_studied_days": 30,
    "avg_daily_new": 18.5,
    "avg_daily_review": 42.3,
    "calendar": [
      {"date": "2025-06-01", "new_count": 20, "review_count": 35, "is_completed": true},
      {"date": "2025-06-02", "new_count": 15, "review_count": 40, "is_completed": false}
    ]
  }
}
```

---

## 6. 前端页面设计

### 6.1 路由结构

```
/wordbook                        -- 词书广场(列表 + 我的词书)
/wordbook/[slug]                 -- 词书详情(介绍 + 订阅/开始学习)
/wordbook/[slug]/learn           -- 学习页面(新词 + 复习卡片)
/wordbook/[slug]/stats           -- 词书统计与打卡日历
/wordbook/[slug]/wordlist        -- 词书完整词表(浏览)
```

### 6.2 新增文件清单

```
frontend/src/app/wordbook/page.tsx                    -- 词书广场
frontend/src/app/wordbook/[slug]/page.tsx              -- 词书详情
frontend/src/app/wordbook/[slug]/learn/page.tsx        -- 学习页面
frontend/src/app/wordbook/[slug]/stats/page.tsx        -- 统计页面
frontend/src/app/wordbook/[slug]/wordlist/page.tsx     -- 词表页面

frontend/src/components/wordbook/WordBookCard.tsx      -- 词书卡片
frontend/src/components/wordbook/LearnCard.tsx         -- 学习卡片
frontend/src/components/wordbook/ReviewCard.tsx        -- 复习卡片
frontend/src/components/wordbook/DailyProgress.tsx     -- 每日进度条
frontend/src/components/wordbook/StudyCalendar.tsx     -- 打卡日历
frontend/src/components/wordbook/PlanSettings.tsx      -- 计划设置
```

### 6.3 页面布局与交互

#### `/wordbook` 词书广场

- **顶部**:我的活跃词书(横向滚动卡片),显示进度条、今日待学、连续天数。
- **中部**:词书分类 tab(全部 / CET / 考研 / 托福 / GRE / IELTS)。
- **卡片列表**:每个词书显示封面、名称、词量、难度、订阅/继续按钮。

#### `/wordbook/[slug]` 词书详情

- **顶部**:封面、名称、描述、词量、单元数、CEFR 等级。
- **中部**:
  - 未订阅:订阅按钮 + 计划设置弹窗(每日新词数 / 复习数)。
  - 已订阅:继续学习按钮 + 进度概览 + 调整计划 + 重置进度。
- **底部**:单元列表(折叠面板),每个单元显示前 5 个词条预览。

#### `/wordbook/[slug]/learn` 学习页面(核心)

```
┌─────────────────────────────────────────────────┐
│ 顶部导航:返回 | 词书名 | 今日进度 12/20         │
├─────────────────────────────────────────────────┤
│                                                 │
│            ┌─────────────────────┐              │
│            │    单词 / 音标       │              │
│            │    发音按钮          │              │
│            │    [点击显示释义]    │              │
│            └─────────────────────┘              │
│                                                 │
│     ┌──────┐  ┌──────┐  ┌──────┐              │
│     │ 认识  │  │ 模糊  │  │ 忘了  │              │
│     └──────┘  └──────┘  └──────┘              │
│                                                 │
│ 底部进度:新词 8/20  复习 12/50                  │
└─────────────────────────────────────────────────┘
```

交互流程:
1. 加载 `GET /api/wordbooks/:id/today`。
2. 先展示新词学习阶段:点击卡片翻转显示释义,三个按钮自评,调用 `POST /api/wordbooks/:id/learn`。
3. 新词学完后进入复习阶段:同样翻卡片 + 三按钮,调用 `POST /api/wordbooks/:id/review`。
4. 全部完成后显示"今日学习完成"庆祝页面 + 今日统计。

#### 学习卡片 UI 形态

MVP 采用**翻牌 + 三按钮自评**:

- **正面**:单词(大号字体)、音标、发音按钮(英音/美音切换)。
- **背面**:多义项释义列表、例句(中英对照)、常见搭配。
- **底部**:`认识 (good)` / `模糊 (hard)` / `忘了 (forgot)` 三个按钮。
- **动画**:CSS 3D 翻牌,按钮点击后左右滑动切换。

V1 可追加:英译中四选一、中译英拼写、听音辨词模式(复用已有 TTS)。

### 6.4 与现有入口联动

1. **Header 导航**(`frontend/src/components/Header.tsx`):在"学习"分组中添加"词书背词"链接指向 `/wordbook`。
2. **`/study` 仪表盘**(`frontend/src/app/study/page.tsx`):新增"词书进度"卡片。
3. **用户菜单**(`Header.tsx` 下拉菜单):添加"我的词书"链接。

### 6.5 移动端响应式要点

- 学习页面全屏模式,隐藏 Header。
- 翻牌卡片高度自适应,最小高度 400px。
- 三个按钮等宽,最小触摸区域 48x48px。

### 6.6 前端 API 层

在 `frontend/src/lib/api.ts` 中新增:

```typescript
export const wordBookAPI = {
  list: (params?: { category?: string; difficulty?: string; search?: string }) =>
    api.get('/wordbooks', { params }),
  get: (id: number) =>
    api.get(`/wordbooks/${id}`),
  subscribe: (id: number, data: { daily_new_words?: number; daily_review_words?: number }) =>
    api.post(`/wordbooks/${id}/subscribe`, data),
  unsubscribe: (id: number) =>
    api.delete(`/wordbooks/${id}/subscribe`),
  reset: (id: number) =>
    api.post(`/wordbooks/${id}/reset`, { confirm: true }),
  updatePlan: (id: number, data: { daily_new_words?: number; daily_review_words?: number }) =>
    api.patch(`/wordbooks/${id}/plan`, data),
  getToday: (id: number) =>
    api.get(`/wordbooks/${id}/today`),
  learn: (id: number, data: { entry_id: number; rating: 'good' | 'hard' | 'forgot' }) =>
    api.post(`/wordbooks/${id}/learn`, data),
  review: (id: number, data: { progress_id: number; rating: 'good' | 'hard' | 'forgot' }) =>
    api.post(`/wordbooks/${id}/review`, data),
  getStats: (id: number) =>
    api.get(`/wordbooks/${id}/stats`),
  getWordList: (id: number, params?: { unit?: number; status?: string; page?: number }) =>
    api.get(`/wordbooks/${id}/entries`, { params }),
};
```

在 `frontend/src/types/index.ts` 中新增对应 TypeScript interface。

---

## 7. 与现有系统集成

### 7.1 词书产生的词是否写入 Vocabulary

**是,采用"自动写入"策略。**

在 `POST /api/wordbooks/:id/learn` 的 handler 中:

```go
var existingVocab models.Vocabulary
err := database.DB.Where("user_id = ? AND word = ?", userID, entry.Word).First(&existingVocab).Error
if errors.Is(err, gorm.ErrRecordNotFound) {
    newVocab := models.Vocabulary{
        UserID:      userID,
        Word:        entry.Word,
        Phonetic:    entry.USPhonetic,
        Translation: entry.Translation,
        Definition:  entry.Definitions,
        Examples:    entry.Examples,
        ReviewEase:  2.5,
        Notes:       "[wordbook:cet4-core-2500]",
    }
    database.DB.Create(&newVocab)
    progress.VocabularyID = &newVocab.ID
} else if err == nil {
    progress.VocabularyID = &existingVocab.ID
}
```

### 7.2 是否计入 StudyRecord / 每日目标

**是。**

- 每完成一次词书复习,调用已有的 `addStudyReviewedWord(userID)`。
- `/study` 页面的"复习单词"目标也会因词书复习而推进。
- 学习日历中对应日期会显示蓝色。

### 7.3 是否同步知识图谱

**是,但延后处理。**

- 当新词写入 `Vocabulary` 时,调用 `services.NewKnowledgeGraphService(database.DB).SyncVocabulary(userID, vocab)`。

---

## 8. 实现计划

### 8.1 MVP 阶段

**目标**:用户可以浏览词书、订阅一本词书、完成每日新词+复习的卡片学习流程。

#### Backend TODO

1. **模型与迁移**
   - [ ] 新建 `backend/models/wordbook.go`:五个模型
   - [ ] 在 `backend/database/db.go` 的 `AutoMigrate` 追加五个模型

2. **词库数据**
   - [ ] 准备 CET-4 和 CET-6 两个 JSON 词库文件放入 `backend/data/wordbooks/`
   - [ ] 新建 `backend/database/seed_wordbooks.go`,实现 `SeedWordBooks()`
   - [ ] 在 `SeedDemoData()` 中调用 `SeedWordBooks()`

3. **Handler 与路由**
   - [ ] 新建 `backend/handlers/wordbook.go`,包含 9 个 handler
   - [ ] 在 `backend/main.go` 的 `protected` 路由组中注册路由

4. **学习算法**
   - [ ] 实现 `GenerateDailyTasks` 和 `applyWordBookReview`
   - [ ] 实现新词自动写入 `Vocabulary`
   - [ ] 调用 `addStudyReviewedWord()` 联动 StudyRecord
   - [ ] 调用 `SyncVocabulary()` 联动知识图谱

#### Frontend TODO

1. **页面**
   - [ ] `/wordbook/page.tsx` -- 词书广场
   - [ ] `/wordbook/[slug]/page.tsx` -- 词书详情
   - [ ] `/wordbook/[slug]/learn/page.tsx` -- 学习页面

2. **组件**
   - [ ] `WordBookCard.tsx`
   - [ ] `LearnCard.tsx`
   - [ ] `DailyProgress.tsx`

3. **API 与类型**
   - [ ] `lib/api.ts` 新增 `wordBookAPI`
   - [ ] `types/index.ts` 新增 interface

4. **导航集成**
   - [ ] `Header.tsx` 在"学习"分组添加"词书背词"
   - [ ] `/study/page.tsx` 添加"词书进度"卡片

#### MVP Endpoint 清单

| # | 方法 | 路径 | 说明 |
|---|------|------|------|
| 1 | GET | `/api/wordbooks` | 词书列表 |
| 2 | GET | `/api/wordbooks/:id` | 词书详情 |
| 3 | POST | `/api/wordbooks/:id/subscribe` | 订阅词书 |
| 4 | DELETE | `/api/wordbooks/:id/subscribe` | 取消订阅 |
| 5 | PATCH | `/api/wordbooks/:id/plan` | 调整计划 |
| 6 | GET | `/api/wordbooks/:id/today` | 今日任务 |
| 7 | POST | `/api/wordbooks/:id/learn` | 提交新词学习 |
| 8 | POST | `/api/wordbooks/:id/review` | 提交复习 |
| 9 | GET | `/api/wordbooks/:id/stats` | 词书统计 |

#### MVP Frontend 页面清单

| # | 路由 | 说明 |
|---|------|------|
| 1 | `/wordbook` | 词书广场 |
| 2 | `/wordbook/[slug]` | 词书详情 |
| 3 | `/wordbook/[slug]/learn` | 学习页面 |

### 8.2 V1 阶段

- [ ] 补充考研、托福、GRE 词库数据
- [ ] `/wordbook/[slug]/stats` 统计页面(打卡日历、进度图表)
- [ ] `/wordbook/[slug]/wordlist` 词表浏览
- [ ] 学习卡片增加英译中四选一、中译英拼写、听音辨词模式
- [ ] 堆积提醒和通知
- [ ] 重置进度功能
- [ ] 后端 service 单测

### 8.3 V2 阶段

- [ ] IELTS 词库
- [ ] 词根词缀拆解展示
- [ ] 用户上传自定义词库(CSV 导入)
- [ ] 多词书并行学习
- [ ] 拼写训练 / 听写模式
- [ ] 导出/导入进度
- [ ] 管理后台词库 CRUD

### 8.4 风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 词库版权 | 高 | 使用公开考试大纲词表;释义/例句自写或用 Wiktionary CC 许可 |
| 词库质量 | 中 | MVP 先做 CET-4/CET-6 小规模词库验证流程 |
| SM-2 调参 | 低 | 默认参数 2.5 已验证;后续 A/B 测试调整 |
| 大词库性能 | 中 | `sort_order` 索引 + `LIMIT` |
| Vocabulary 重复 | 中 | `user_id + word` 查重 |
| 翻牌动画兼容性 | 低 | CSS 3D transform 主流浏览器均支持 |

### 8.5 测试策略

**后端**:
- `backend/handlers/wordbook_test.go`:每个 handler 的集成测试
- `backend/services/wordbook_review_test.go`:SM-2 算法单测
- `backend/database/seed_wordbooks_test.go`:验证 seed 幂等性

**前端**:
- `npm run lint` 和 `npm run build`
- 学习页面组件单测(可选)
- 手动验证移动端 Safari / Chrome 翻牌动画

---

## 9. 未来扩展(可选)

### 9.1 词根词缀

`WordBookEntry` 新增 `morphemes` JSON 字段,前端展示词根拆解,与知识图谱联动。

### 9.2 联想记忆

利用知识图谱自动建立同义词、反义词、形近词关系。

### 9.3 拼写训练

听音后手动拼写,Levenshtein 距离判定(复用已有 `closeSpellingAnswer`)。

### 9.4 听写模式

播放例句音频(TTS 服务),用户听写整句,逐词对比评分。

### 9.5 导出/导入进度

`GET /api/wordbooks/:id/export` 导出 JSON,`POST /api/wordbooks/:id/import` 导入。

### 9.6 多设备同步

进度完全服务端存储,前端无本地状态,多设备登录同一账号自动同步。

---

## 文档元信息

- **创建时间**:2025-06-15
- **最后更新**:2025-06-15
- **作者**:LinguaFlow 设计代理
- **涉及核心文件**:
  - `backend/models/models.go`(现有 Vocabulary 模型,约 336-366 行)
  - `backend/handlers/translation.go`(现有词汇 handler + SM-2 算法,678-722 行)
  - `backend/handlers/study.go`(每日学习闭环)
  - `backend/database/db.go`(迁移)
  - `backend/database/seed.go`(种子数据)
  - `backend/main.go`(路由注册)
  - `frontend/src/app/study/page.tsx`(学习仪表盘)
  - `frontend/src/app/vocabulary/page.tsx`(生词本)
  - `frontend/src/components/Header.tsx`(导航)
  - `frontend/src/lib/api.ts`(API 层)
  - `frontend/src/types/index.ts`(TypeScript 类型)

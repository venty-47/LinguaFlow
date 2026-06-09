package models

import (
	"time"

	"gorm.io/gorm"
)

// User 用户模型
type User struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
	Username  string         `gorm:"uniqueIndex;size:50;not null" json:"username"`
	Email     string         `gorm:"uniqueIndex;size:100;not null" json:"email"`
	Password  string         `gorm:"size:255;not null" json:"-"`
	Nickname  string         `gorm:"size:50" json:"nickname"`
	Avatar    string         `gorm:"size:255" json:"avatar"`
	IsAdmin   bool           `gorm:"default:false;index" json:"is_admin"`
	IsPremium bool           `gorm:"default:false" json:"is_premium"`

	// 会员信息
	MembershipType   string     `gorm:"size:20;default:'free'" json:"membership_type"` // free, monthly, yearly, lifetime
	MembershipExpiry *time.Time `json:"membership_expiry"`                             // 会员到期时间

	// 学习统计
	TotalReadTime int `gorm:"default:0" json:"total_read_time"` // 总阅读时间（分钟）
	ArticlesRead  int `gorm:"default:0" json:"articles_read"`   // 已读文章数
	WordsLearned  int `gorm:"default:0" json:"words_learned"`   // 已学单词数

	// 关联
	Subscriptions  []Subscription  `gorm:"foreignKey:UserID" json:"subscriptions,omitempty"`
	ReadHistory    []ReadHistory   `gorm:"foreignKey:UserID" json:"read_history,omitempty"`
	Vocabulary     []Vocabulary    `gorm:"foreignKey:UserID" json:"vocabulary,omitempty"`
	Orders         []Order         `gorm:"foreignKey:UserID" json:"orders,omitempty"`
	StudyGoal      *StudyGoal      `gorm:"foreignKey:UserID" json:"study_goal,omitempty"`
	StudyRecords   []StudyRecord   `gorm:"foreignKey:UserID" json:"study_records,omitempty"`
	KnowledgeNodes []KnowledgeNode `gorm:"foreignKey:UserID" json:"knowledge_nodes,omitempty"`
	VideoLessons   []VideoLesson   `gorm:"foreignKey:UserID" json:"video_lessons,omitempty"`
}

// Category 分类
type Category struct {
	ID          uint           `gorm:"primarykey" json:"id"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
	Name        string         `gorm:"size:100;not null" json:"name"`
	NameEN      string         `gorm:"size:100" json:"name_en"`
	Slug        string         `gorm:"uniqueIndex;size:100;not null" json:"slug"`
	Description string         `gorm:"size:500" json:"description"`
	Icon        string         `gorm:"size:100" json:"icon"`
	SortOrder   int            `gorm:"default:0" json:"sort_order"`

	Articles []Article `gorm:"foreignKey:CategoryID" json:"articles,omitempty"`
}

// Article 文章
type Article struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// 基本信息
	Title      string `gorm:"size:500;not null" json:"title"`
	TitleCN    string `gorm:"size:500" json:"title_cn"` // 中文标题
	Slug       string `gorm:"uniqueIndex;size:200;not null" json:"slug"`
	Summary    string `gorm:"type:text" json:"summary"`
	SummaryCN  string `gorm:"type:text" json:"summary_cn"`       // 中文摘要
	Content    string `gorm:"type:text;not null" json:"content"` // 英文内容
	ContentCN  string `gorm:"type:text" json:"content_cn"`       // 中文翻译
	CoverImage string `gorm:"size:500" json:"cover_image"`

	// 分类和标签
	CategoryID uint     `gorm:"not null;index" json:"category_id"`
	Category   Category `gorm:"foreignKey:CategoryID" json:"category,omitempty"`
	Tags       string   `gorm:"size:500" json:"tags"` // 逗号分隔

	// 来源信息
	Source      string    `gorm:"size:100" json:"source"` // 来源（如 MIT Technology Review）
	SourceURL   string    `gorm:"size:500" json:"source_url"`
	Author      string    `gorm:"size:100" json:"author"`
	PublishedAt time.Time `json:"published_at"`

	// 阅读难度和统计
	DifficultyLevel string `gorm:"size:20;default:'medium'" json:"difficulty_level"` // easy, medium, hard
	WordCount       int    `gorm:"default:0" json:"word_count"`
	ReadingTime     int    `gorm:"default:0" json:"reading_time"` // 预估阅读时间（分钟）
	Keywords        string `gorm:"size:500" json:"keywords"`      // 逗号分隔
	CEFRLevel       string `gorm:"size:5" json:"cefr_level"`      // A1, A2, B1, B2, C1, C2
	ViewCount       int    `gorm:"default:0" json:"view_count"`

	// 状态
	Status     string `gorm:"size:20;default:'draft'" json:"status"` // draft, published, archived
	IsFeatured bool   `gorm:"default:false" json:"is_featured"`

	// 关联
	ReadHistory []ReadHistory `gorm:"foreignKey:ArticleID" json:"read_history,omitempty"`
	Quiz        *ArticleQuiz  `gorm:"foreignKey:ArticleID" json:"quiz,omitempty"`
}

// ArticleQuiz 文章读后测验
type ArticleQuiz struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	ArticleID uint   `gorm:"not null;uniqueIndex" json:"article_id"`
	Title     string `gorm:"size:500;not null" json:"title"`

	Article   Article               `gorm:"foreignKey:ArticleID" json:"article,omitempty"`
	Questions []ArticleQuizQuestion `gorm:"foreignKey:QuizID" json:"questions,omitempty"`
	Attempts  []ArticleQuizAttempt  `gorm:"foreignKey:QuizID" json:"attempts,omitempty"`
}

// ArticleQuizQuestion 文章测验题目
type ArticleQuizQuestion struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	QuizID       uint   `gorm:"not null;index" json:"quiz_id"`
	SortOrder    int    `gorm:"default:0" json:"sort_order"`
	QuestionType string `gorm:"size:30;default:'single_choice'" json:"question_type"`
	Prompt       string `gorm:"type:text;not null" json:"prompt"`
	Options      string `gorm:"type:text;not null" json:"options"` // JSON 字符串数组
	CorrectIndex int    `gorm:"not null" json:"-"`
	Explanation  string `gorm:"type:text" json:"explanation"`

	Quiz ArticleQuiz `gorm:"foreignKey:QuizID" json:"quiz,omitempty"`
}

// ArticleQuizAttempt 用户读后测验提交记录
type ArticleQuizAttempt struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID      uint      `gorm:"not null;index" json:"user_id"`
	QuizID      uint      `gorm:"not null;index" json:"quiz_id"`
	Answers     string    `gorm:"type:text;not null" json:"answers"` // JSON 数字数组
	Score       int       `gorm:"default:0" json:"score"`
	Total       int       `gorm:"default:0" json:"total"`
	Percentage  int       `gorm:"default:0" json:"percentage"`
	CompletedAt time.Time `json:"completed_at"`

	User User        `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Quiz ArticleQuiz `gorm:"foreignKey:QuizID" json:"quiz,omitempty"`
}

// ArticleStudyEvent 用户阅读中的学习行为事件
type ArticleStudyEvent struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID    uint   `gorm:"not null;index:idx_user_article_event,priority:1;uniqueIndex:idx_study_event_dedupe,priority:1" json:"user_id"`
	ArticleID uint   `gorm:"not null;index:idx_user_article_event,priority:2;uniqueIndex:idx_study_event_dedupe,priority:2" json:"article_id"`
	EventType string `gorm:"size:40;not null;index:idx_user_article_event,priority:3;uniqueIndex:idx_study_event_dedupe,priority:3" json:"event_type"`

	SourceText  string `gorm:"type:text;not null" json:"source_text"`
	ResultText  string `gorm:"type:text" json:"result_text"`
	Context     string `gorm:"type:text" json:"context"`
	Metadata    string `gorm:"type:text" json:"metadata"`
	SourceHash  string `gorm:"size:64;not null;uniqueIndex:idx_study_event_dedupe,priority:4" json:"source_hash"`
	ContextHash string `gorm:"size:64;not null;uniqueIndex:idx_study_event_dedupe,priority:5" json:"context_hash"`

	User    User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Article Article `gorm:"foreignKey:ArticleID" json:"article,omitempty"`
}

// ArticleStudyNote 用户文章精读笔记
type ArticleStudyNote struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID    uint `gorm:"not null;uniqueIndex:idx_user_article_note" json:"user_id"`
	ArticleID uint `gorm:"not null;uniqueIndex:idx_user_article_note" json:"article_id"`

	Title                  string     `gorm:"size:500;not null" json:"title"`
	Summary                string     `gorm:"type:text" json:"summary"`
	Keywords               string     `gorm:"type:text" json:"keywords"` // JSON 字符串数组
	DifficultSentences     string     `gorm:"type:text" json:"difficult_sentences"`
	GrammarPoints          string     `gorm:"type:text" json:"grammar_points"`
	ExpressionReplacements string     `gorm:"type:text" json:"expression_replacements"`
	ReviewPlan             string     `gorm:"type:text" json:"review_plan"`  // JSON 字符串数组
	SourceStats            string     `gorm:"type:text" json:"source_stats"` // JSON 对象
	Provider               string     `gorm:"size:30;default:'rules'" json:"provider"`
	GeneratedAt            time.Time  `json:"generated_at"`
	RefreshedAt            *time.Time `json:"refreshed_at"`

	User    User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Article Article `gorm:"foreignKey:ArticleID" json:"article,omitempty"`
}

// Subscription 用户订阅（我的订阅）
type Subscription struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID    uint `gorm:"not null;index" json:"user_id"`
	ArticleID uint `gorm:"not null;index" json:"article_id"`

	User    User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Article Article `gorm:"foreignKey:ArticleID" json:"article,omitempty"`
}

// ReadHistory 阅读历史
type ReadHistory struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID    uint `gorm:"not null;index:idx_user_article" json:"user_id"`
	ArticleID uint `gorm:"not null;index:idx_user_article" json:"article_id"`

	// 阅读进度
	ReadProgress float64   `gorm:"default:0" json:"read_progress"` // 0-100
	ReadTime     int       `gorm:"default:0" json:"read_time"`     // 阅读时长（秒）
	LastReadAt   time.Time `json:"last_read_at"`
	IsCompleted  bool      `gorm:"default:false" json:"is_completed"`

	User    User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Article Article `gorm:"foreignKey:ArticleID" json:"article,omitempty"`
}

// Vocabulary 生词本
type Vocabulary struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID uint   `gorm:"not null;index:idx_user_word" json:"user_id"`
	Word   string `gorm:"size:100;not null;index:idx_user_word" json:"word"`

	// 词汇信息
	Phonetic    string `gorm:"size:100" json:"phonetic"`    // 音标
	Definition  string `gorm:"type:text" json:"definition"` // 释义（JSON格式，包含多个释义）
	Translation string `gorm:"size:500" json:"translation"` // 中文翻译
	Examples    string `gorm:"type:text" json:"examples"`   // 例句（JSON格式）

	// 学习相关
	ArticleID      *uint      `gorm:"index" json:"article_id"`                // 从哪篇文章添加的
	Context        string     `gorm:"type:text" json:"context"`               // 上下文语境
	IsLearned      bool       `gorm:"default:false" json:"is_learned"`        // 是否已掌握
	ReviewCount    int        `gorm:"default:0" json:"review_count"`          // 复习次数
	ForgottenCount int        `gorm:"default:0;index" json:"forgotten_count"` // 遗忘次数
	LastReview     *time.Time `json:"last_review"`
	NextReviewAt   *time.Time `gorm:"index" json:"next_review_at"`      // 下次复习时间
	ReviewInterval int        `gorm:"default:0" json:"review_interval"` // 复习间隔（天）
	ReviewEase     float64    `gorm:"default:2.5" json:"review_ease"`   // 间隔重复难度系数

	User    User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Article *Article `gorm:"foreignKey:ArticleID" json:"article,omitempty"`
}

// StudyGoal 每日学习目标
type StudyGoal struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID           uint `gorm:"not null;uniqueIndex" json:"user_id"`
	DailyReadMinutes int  `gorm:"default:20" json:"daily_read_minutes"`
	DailyReviewWords int  `gorm:"default:10" json:"daily_review_words"`
	DailyArticles    int  `gorm:"default:1" json:"daily_articles"`

	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

// StudyRecord 每日学习记录
type StudyRecord struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID            uint      `gorm:"not null;uniqueIndex:idx_user_study_date" json:"user_id"`
	Date              string    `gorm:"size:10;not null;uniqueIndex:idx_user_study_date" json:"date"`
	ReadSeconds       int       `gorm:"default:0" json:"read_seconds"`
	ReviewedWords     int       `gorm:"default:0" json:"reviewed_words"`
	CompletedArticles int       `gorm:"default:0" json:"completed_articles"`
	IsCompleted       bool      `gorm:"default:false;index" json:"is_completed"`
	LastActivityAt    time.Time `json:"last_activity_at"`

	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

// KnowledgeNode 学习知识图谱节点
type KnowledgeNode struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID      uint   `gorm:"not null;uniqueIndex:idx_user_knowledge_node_key;index" json:"user_id"`
	NodeKey     string `gorm:"size:180;not null;uniqueIndex:idx_user_knowledge_node_key" json:"node_key"`
	Type        string `gorm:"size:30;not null;index" json:"type"`
	Label       string `gorm:"size:500;not null" json:"label"`
	Description string `gorm:"type:text" json:"description"`
	Weight      int    `gorm:"default:50;index" json:"weight"`
	Metadata    string `gorm:"type:text" json:"metadata"` // JSON 对象

	SourceVocabularyID *uint       `gorm:"index" json:"source_vocabulary_id"`
	SourceArticleID    *uint       `gorm:"index" json:"source_article_id"`
	User               User        `gorm:"foreignKey:UserID" json:"user,omitempty"`
	SourceVocabulary   *Vocabulary `gorm:"foreignKey:SourceVocabularyID" json:"source_vocabulary,omitempty"`
	SourceArticle      *Article    `gorm:"foreignKey:SourceArticleID" json:"source_article,omitempty"`
}

// KnowledgeEdge 学习知识图谱关系
type KnowledgeEdge struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID       uint   `gorm:"not null;uniqueIndex:idx_user_knowledge_edge;index" json:"user_id"`
	SourceNodeID uint   `gorm:"not null;uniqueIndex:idx_user_knowledge_edge;index" json:"source_node_id"`
	TargetNodeID uint   `gorm:"not null;uniqueIndex:idx_user_knowledge_edge;index" json:"target_node_id"`
	Relation     string `gorm:"size:50;not null;uniqueIndex:idx_user_knowledge_edge" json:"relation"`
	Label        string `gorm:"size:100" json:"label"`
	Weight       int    `gorm:"default:50;index" json:"weight"`
	Metadata     string `gorm:"type:text" json:"metadata"` // JSON 对象

	User       User          `gorm:"foreignKey:UserID" json:"user,omitempty"`
	SourceNode KnowledgeNode `gorm:"foreignKey:SourceNodeID" json:"source_node,omitempty"`
	TargetNode KnowledgeNode `gorm:"foreignKey:TargetNodeID" json:"target_node,omitempty"`
}

// UserKnowledgeState 用户对知识节点的掌握状态
type UserKnowledgeState struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID       uint       `gorm:"not null;uniqueIndex:idx_user_knowledge_state;index" json:"user_id"`
	NodeID       uint       `gorm:"not null;uniqueIndex:idx_user_knowledge_state;index" json:"node_id"`
	Familiarity  int        `gorm:"default:30;index" json:"familiarity"`
	ReviewCount  int        `gorm:"default:0" json:"review_count"`
	MistakeCount int        `gorm:"default:0;index" json:"mistake_count"`
	LastSeenAt   *time.Time `json:"last_seen_at"`
	NextReviewAt *time.Time `gorm:"index" json:"next_review_at"`
	Source       string     `gorm:"size:50" json:"source"`

	User User          `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Node KnowledgeNode `gorm:"foreignKey:NodeID" json:"node,omitempty"`
}

// VideoLesson 用户视频学习资料
type VideoLesson struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID uint `gorm:"not null;index:idx_user_video_created,priority:1;index:idx_user_video_status,priority:1" json:"user_id"`

	Title       string `gorm:"size:300;not null" json:"title"`
	Description string `gorm:"type:text" json:"description"`
	Source      string `gorm:"size:100" json:"source"`
	SourceURL   string `gorm:"size:1000" json:"source_url"`

	OriginalFilename string `gorm:"size:500" json:"original_filename"`
	VideoPath        string `gorm:"size:1000;not null" json:"video_path"`
	AudioPath        string `gorm:"size:1000" json:"audio_path"`
	TranscriptPath   string `gorm:"size:1000" json:"transcript_path"`

	DurationSeconds float64 `gorm:"default:0" json:"duration_seconds"`
	FileSizeBytes   int64   `gorm:"default:0" json:"file_size_bytes"`
	MimeType        string  `gorm:"size:100" json:"mime_type"`

	Language string `gorm:"size:20;default:'en'" json:"language"`
	Status   string `gorm:"size:30;default:'uploaded';index;index:idx_user_video_status,priority:2" json:"status"`
	Progress int    `gorm:"default:0" json:"progress"`
	Error    string `gorm:"type:text" json:"error"`

	LastPositionSeconds float64    `gorm:"default:0" json:"last_position_seconds"`
	CompletedAt         *time.Time `json:"completed_at"`

	User      User                 `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Subtitles []VideoSubtitle      `gorm:"foreignKey:VideoLessonID" json:"subtitles,omitempty"`
	Jobs      []VideoProcessingJob `gorm:"foreignKey:VideoLessonID" json:"jobs,omitempty"`
}

// VideoSubtitle 视频字幕句子
type VideoSubtitle struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	VideoLessonID uint `gorm:"not null;index:idx_video_subtitle_order,priority:1;index" json:"video_lesson_id"`
	SortOrder     int  `gorm:"not null;index:idx_video_subtitle_order,priority:2" json:"sort_order"`

	StartSeconds float64 `gorm:"not null;index" json:"start_seconds"`
	EndSeconds   float64 `gorm:"not null" json:"end_seconds"`
	Text         string  `gorm:"type:text;not null" json:"text"`
	Translation  string  `gorm:"type:text" json:"translation"`

	Confidence float64 `gorm:"default:0" json:"confidence"`
	Source     string  `gorm:"size:30;default:'auto'" json:"source"`

	VideoLesson VideoLesson `gorm:"foreignKey:VideoLessonID" json:"video_lesson,omitempty"`
}

// VideoProcessingJob 视频异步处理任务
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

// TranslationCache 翻译缓存
type TranslationCache struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	CreatedAt time.Time `json:"created_at"`

	SourceText  string `gorm:"type:text;not null;uniqueIndex:idx_source_target" json:"source_text"`
	TargetLang  string `gorm:"size:10;not null;uniqueIndex:idx_source_target" json:"target_lang"`
	Translation string `gorm:"type:text;not null" json:"translation"`
	Provider    string `gorm:"size:50" json:"provider"` // 翻译服务提供商
}

// DictionaryCache 查词缓存
type DictionaryCache struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	Word        string `gorm:"size:100;not null;uniqueIndex" json:"word"`
	Provider    string `gorm:"size:50" json:"provider"`
	Phonetic    string `gorm:"size:100" json:"phonetic"`
	UKPhonetic  string `gorm:"size:100" json:"uk_phonetic"`
	USPhonetic  string `gorm:"size:100" json:"us_phonetic"`
	SpeechURL   string `gorm:"size:1000" json:"speech_url"`
	UKSpeechURL string `gorm:"size:1000" json:"uk_speech_url"`
	USSpeechURL string `gorm:"size:1000" json:"us_speech_url"`
	Translation string `gorm:"type:text" json:"translation"`
	Definitions string `gorm:"type:text" json:"definitions"`
	WebMeanings string `gorm:"type:text" json:"web_meanings"`
	Error       string `gorm:"type:text" json:"error"`
}

// Order 订单模型
type Order struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID        uint       `gorm:"not null;index" json:"user_id"`
	OrderNo       string     `gorm:"uniqueIndex;size:100;not null" json:"order_no"` // 订单号
	ProductType   string     `gorm:"size:20;not null" json:"product_type"`          // monthly, yearly, lifetime
	Amount        float64    `gorm:"not null" json:"amount"`                        // 金额
	Currency      string     `gorm:"size:10;default:'CNY'" json:"currency"`         // 货币类型
	Status        string     `gorm:"size:20;default:'pending'" json:"status"`       // pending, paid, cancelled, refunded
	PaymentMethod string     `gorm:"size:50" json:"payment_method"`                 // alipay, wechat, stripe 等
	PaymentTime   *time.Time `json:"payment_time"`
	ExpiryTime    *time.Time `json:"expiry_time"` // 会员到期时间

	User User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

// MembershipBenefit 会员权益
type MembershipBenefit struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Name        string `gorm:"size:100;not null" json:"name"`   // 权益名称
	NameEN      string `gorm:"size:100" json:"name_en"`         // 英文名称
	Description string `gorm:"type:text" json:"description"`    // 描述
	Icon        string `gorm:"size:100" json:"icon"`            // 图标
	ForFree     bool   `gorm:"default:false" json:"for_free"`   // 免费用户是否可用
	ForPremium  bool   `gorm:"default:true" json:"for_premium"` // 会员用户是否可用
	SortOrder   int    `gorm:"default:0" json:"sort_order"`
}

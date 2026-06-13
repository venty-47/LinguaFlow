package models

import (
	"time"

	"gorm.io/gorm"
)

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
	Category   string `gorm:"size:50;not null;index" json:"category"`
	Difficulty string `gorm:"size:20;default:'medium'" json:"difficulty"`
	CEFRLevel  string `gorm:"size:10" json:"cefr_level"`

	// 统计
	WordCount   int  `gorm:"default:0" json:"word_count"`
	UnitCount   int  `gorm:"default:0" json:"unit_count"`
	IsPublished bool `gorm:"default:false;index" json:"is_published"`

	// 来源信息
	Source  string `gorm:"size:200" json:"source"`
	License string `gorm:"size:100" json:"license"`
	Version string `gorm:"size:50" json:"version"`

	// 关联
	Entries []WordBookEntry `gorm:"foreignKey:WordBookID" json:"entries,omitempty"`
}

// WordBookEntry 词书中的一个词条
type WordBookEntry struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	WordBookID uint   `gorm:"not null;uniqueIndex:idx_wbe_book_word,priority:1;index:idx_wbe_book_sort,priority:1" json:"word_book_id"`
	SortOrder  int    `gorm:"not null;index:idx_wbe_book_sort,priority:2" json:"sort_order"`
	Unit       int    `gorm:"default:0;index" json:"unit"`

	// 词汇信息
	Word         string `gorm:"size:100;not null;uniqueIndex:idx_wbe_book_word,priority:2;index:idx_wbe_word" json:"word"`
	Phonetic     string `gorm:"size:100" json:"phonetic"`
	UKPhonetic   string `gorm:"size:100" json:"uk_phonetic"`
	USPhonetic   string `gorm:"size:100" json:"us_phonetic"`
	Definitions  string `gorm:"type:text" json:"definitions"`
	Translation  string `gorm:"size:1000" json:"translation"`
	Examples     string `gorm:"type:text" json:"examples"`
	Collocations string `gorm:"type:text" json:"collocations"`

	// 元数据
	Frequency  int    `gorm:"default:0;index" json:"frequency"`
	Difficulty string `gorm:"size:20;default:'medium'" json:"difficulty"`
	Tags       string `gorm:"size:500" json:"tags"`

	// AI 生成数据(缓存在词条上,所有用户共享)
	Mnemonic    string `gorm:"type:text" json:"mnemonic"`
	AIExamples  string `gorm:"type:text" json:"ai_examples"`

	// 关联
	WordBook WordBook `gorm:"foreignKey:WordBookID" json:"word_book,omitempty"`
}

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
	CurrentUnit      int `gorm:"default:0" json:"current_unit"`
	LearnedCount     int `gorm:"default:0" json:"learned_count"`
	MasteredCount    int `gorm:"default:0" json:"mastered_count"`
	TotalStudiedDays int `gorm:"default:0" json:"total_studied_days"`
	CurrentStreak    int `gorm:"default:0" json:"current_streak"`

	// 状态
	IsActive      bool       `gorm:"default:true;index" json:"is_active"`
	StartedAt     time.Time  `json:"started_at"`
	CompletedAt   *time.Time `json:"completed_at"`
	LastStudiedAt *time.Time `json:"last_studied_at"`

	// 关联
	User     User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	WordBook WordBook `gorm:"foreignKey:WordBookID" json:"word_book,omitempty"`
}

// UserWordBookProgress 用户在词书中每个词的学习进度
type UserWordBookProgress struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID          uint  `gorm:"not null;uniqueIndex:idx_uwbp_user_entry" json:"user_id"`
	UserWordBookID  uint  `gorm:"not null;index" json:"user_word_book_id"`
	WordBookEntryID uint  `gorm:"not null;uniqueIndex:idx_uwbp_user_entry" json:"word_book_entry_id"`
	VocabularyID    *uint `gorm:"index" json:"vocabulary_id"`

	// 学习状态
	Status       string     `gorm:"size:20;default:'new';index" json:"status"`
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

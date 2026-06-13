package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"gugudu-backend/database"
	"gugudu-backend/models"
	"gugudu-backend/services"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 词书模块常量
const (
	wbDefaultDailyNewWords    = 20
	wbMinDailyNewWords        = 5
	wbMaxDailyNewWords        = 100
	wbDefaultDailyReviewWords = 50
	wbMinDailyReviewWords     = 10
	wbMaxDailyReviewWords     = 300
	wbMaxBacklogWords         = 200

	// SRS 统一掌握阈值：生词本和词书共用
	srsMasteryReviewCount = 2
	srsMasteryInterval    = 7
	srsDefaultEase        = 2.5
	srsMinEase            = 1.3
)

// ---------- 请求 / 响应结构 ----------

type wordBookSubscribeRequest struct {
	DailyNewWords    int `json:"daily_new_words"`
	DailyReviewWords int `json:"daily_review_words"`
}

type wordBookPlanRequest struct {
	DailyNewWords    *int `json:"daily_new_words"`
	DailyReviewWords *int `json:"daily_review_words"`
}

type wordBookLearnRequest struct {
	EntryID uint   `json:"entry_id" binding:"required"`
	Rating  string `json:"rating" binding:"required,oneof=good hard forgot"`
}

type wordBookReviewRequest struct {
	ProgressID uint   `json:"progress_id" binding:"required"`
	Rating     string `json:"rating" binding:"required,oneof=good hard forgot"`
}

type dailyTaskNewWord struct {
	EntryID     uint   `json:"entry_id"`
	Word        string `json:"word"`
	Phonetic    string `json:"phonetic"`
	UKPhonetic  string `json:"uk_phonetic"`
	USPhonetic  string `json:"us_phonetic"`
	Translation string `json:"translation"`
	Definitions string `json:"definitions"`
	Examples    string `json:"examples"`
	Collocations string `json:"collocations"`
	Status      string `json:"status"`
}

type dailyTaskReviewWord struct {
	ProgressID     uint   `json:"progress_id"`
	EntryID        uint   `json:"entry_id"`
	Word           string `json:"word"`
	Phonetic       string `json:"phonetic"`
	UKPhonetic     string `json:"uk_phonetic"`
	USPhonetic     string `json:"us_phonetic"`
	Translation    string `json:"translation"`
	Status         string `json:"status"`
	ReviewCount    int    `json:"review_count"`
	ForgottenCount int    `json:"forgotten_count"`
	NextReviewAt   string `json:"next_review_at"`
}

type dailyTasksResponse struct {
	Date          string                `json:"date"`
	NewWords      []dailyTaskNewWord    `json:"new_words"`
	ReviewWords   []dailyTaskReviewWord `json:"review_words"`
	TotalNew      int                   `json:"total_new"`
	TotalReview   int                   `json:"total_review"`
	BacklogCount  int                   `json:"backlog_count"`
	NewWordQuota  int                   `json:"new_word_quota"`
	Plan          struct {
		DailyNewWords    int `json:"daily_new_words"`
		DailyReviewWords int `json:"daily_review_words"`
	} `json:"plan"`
	Progress      struct {
		NewLearned   int `json:"new_learned"`
		NewTotal     int `json:"new_total"`
		ReviewDone   int `json:"review_done"`
		ReviewTotal  int `json:"review_total"`
		IsCompleted  bool `json:"is_completed"`
	} `json:"progress"`
}

type wordBookStatsResponse struct {
	TotalEntries          int     `json:"total_entries"`
	NewCount              int     `json:"new_count"`
	LearningCount         int     `json:"learning_count"`
	MasteredCount         int     `json:"mastered_count"`
	SkippedCount          int     `json:"skipped_count"`
	LearnedPct            int     `json:"learned_pct"`
	MasteredPct           int     `json:"mastered_pct"`
	EstimatedDaysRemaining int    `json:"estimated_days_remaining"`
	CurrentStreak         int     `json:"current_streak"`
	TotalStudiedDays      int     `json:"total_studied_days"`
	AvgDailyNew           float64 `json:"avg_daily_new"`
	AvgDailyReview        float64 `json:"avg_daily_review"`
	Calendar              []struct {
		Date         string `json:"date"`
		NewCount     int    `json:"new_count"`
		ReviewCount  int    `json:"review_count"`
		IsCompleted  bool   `json:"is_completed"`
	} `json:"calendar"`
}

// ---------- Handler 函数 ----------

// ListWordBooks 获取词书列表
func ListWordBooks(c *gin.Context) {
	category := c.Query("category")
	difficulty := c.Query("difficulty")
	search := c.Query("search")

	query := database.DB.Where("is_published = ?", true)
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if difficulty != "" {
		query = query.Where("difficulty = ?", difficulty)
	}
	if search != "" {
		query = query.Where("name ILIKE ? OR name_en ILIKE ?", "%"+search+"%", "%"+search+"%")
	}

	var books []models.WordBook
	if err := query.Order("category, id").Find(&books).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load wordbooks"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": books})
}

// GetWordBook 获取词书详情
func GetWordBook(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	var book models.WordBook
	if err := database.DB.First(&book, bookID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wordbook not found"})
		return
	}

	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	// 检查订阅状态
	var ub models.UserWordBook
	subscribed := false
	err2 := database.DB.Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&ub).Error
	if err2 == nil {
		subscribed = true
	}

	result := gin.H{
		"id":            book.ID,
		"name":          book.Name,
		"name_en":       book.NameEN,
		"slug":          book.Slug,
		"category":      book.Category,
		"difficulty":    book.Difficulty,
		"cefr_level":    book.CEFRLevel,
		"description":   book.Description,
		"cover_image":   book.CoverImage,
		"word_count":    book.WordCount,
		"unit_count":    book.UnitCount,
		"source":        book.Source,
		"version":       book.Version,
		"is_subscribed": subscribed,
		"user_progress": nil,
	}

	if subscribed {
		result["user_progress"] = ub
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// SubscribeWordBook 订阅词书
func SubscribeWordBook(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	var book models.WordBook
	if err := database.DB.First(&book, bookID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wordbook not found"})
		return
	}

	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	// 检查是否已订阅
	var existing models.UserWordBook
	if err := database.DB.Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already subscribed"})
		return
	}

	var req wordBookSubscribeRequest
	_ = c.ShouldBindJSON(&req)

	dailyNew := req.DailyNewWords
	if dailyNew < wbMinDailyNewWords || dailyNew > wbMaxDailyNewWords {
		dailyNew = wbDefaultDailyNewWords
	}
	dailyReview := req.DailyReviewWords
	if dailyReview < wbMinDailyReviewWords || dailyReview > wbMaxDailyReviewWords {
		dailyReview = wbDefaultDailyReviewWords
	}

	now := time.Now()
	ub := models.UserWordBook{
		UserID:           uid,
		WordBookID:       uint(bookID),
		DailyNewWords:    dailyNew,
		DailyReviewWords: dailyReview,
		AutoPlayAudio:    true,
		IsActive:         true,
		StartedAt:        now,
	}

	if err := database.DB.Create(&ub).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to subscribe"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Subscribed",
		"data":    ub,
	})
}

// UnsubscribeWordBook 取消订阅
func UnsubscribeWordBook(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	var ub models.UserWordBook
	if err := database.DB.Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&ub).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	ubID := ub.ID

	// 先清理进度数据
	database.DB.Where("user_id = ? AND user_word_book_id = ?", uid, ubID).Delete(&models.UserWordBookProgress{})

	// 清理每日记录
	database.DB.Where("user_word_book_id = ?", ubID).Delete(&models.WordBookDailyRecord{})

	// 再删除订阅
	database.DB.Delete(&ub)

	c.JSON(http.StatusOK, gin.H{"message": "Unsubscribed"})
}

// UpdateWordBookPlan 调整每日计划
func UpdateWordBookPlan(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	var ub models.UserWordBook
	if err := database.DB.Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&ub).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	var req wordBookPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.DailyNewWords != nil {
		v := *req.DailyNewWords
		if v < wbMinDailyNewWords || v > wbMaxDailyNewWords {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("daily_new_words must be between %d and %d", wbMinDailyNewWords, wbMaxDailyNewWords)})
			return
		}
		ub.DailyNewWords = v
	}
	if req.DailyReviewWords != nil {
		v := *req.DailyReviewWords
		if v < wbMinDailyReviewWords || v > wbMaxDailyReviewWords {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("daily_review_words must be between %d and %d", wbMinDailyReviewWords, wbMaxDailyReviewWords)})
			return
		}
		ub.DailyReviewWords = v
	}

	if err := database.DB.Save(&ub).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update plan"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Plan updated", "data": ub})
}

// GetTodayTasks 获取今日学习任务
func GetTodayTasks(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	var ub models.UserWordBook
	if err := database.DB.Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&ub).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	tasks, err := generateDailyTasks(database.DB, uid, ub)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate daily tasks"})
		return
	}

	// 初始化或更新今日记录的目标值（只在首次或目标值为0时设置）
	initializeDailyRecordTargets(ub.ID, tasks.TotalNew, tasks.TotalReview)

	// 获取今日进度
	today := time.Now().Format("2006-01-02")
	var record models.WordBookDailyRecord
	if err := database.DB.Where("user_word_book_id = ? AND date = ?", ub.ID, today).First(&record).Error; err == nil {
		tasks.Progress.NewLearned = record.NewLearned
		tasks.Progress.NewTotal = record.NewTotal
		tasks.Progress.ReviewDone = record.ReviewDone
		tasks.Progress.ReviewTotal = record.ReviewTotal
		tasks.Progress.IsCompleted = record.IsCompleted
	}

	c.JSON(http.StatusOK, gin.H{"data": tasks})
}

// SubmitLearnResult 提交新词学习结果
func SubmitLearnResult(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	var ub models.UserWordBook
	if err := database.DB.Preload("WordBook").Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&ub).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	var req wordBookLearnRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 查找词条
	var entry models.WordBookEntry
	if err := database.DB.Where("id = ? AND word_book_id = ?", req.EntryID, bookID).First(&entry).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Entry not found"})
		return
	}

	now := time.Now()

	// 查找或创建进度记录
	var progress models.UserWordBookProgress
	err2 := database.DB.Where("user_id = ? AND word_book_entry_id = ?", uid, entry.ID).First(&progress).Error
	if err2 != nil {
		progress = models.UserWordBookProgress{
			UserID:          uid,
			UserWordBookID:  ub.ID,
			WordBookEntryID: entry.ID,
			Status:          "learning",
			FirstSeenAt:     &now,
			ReviewEase:      2.5,
		}
		if err := database.DB.Create(&progress).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create progress"})
			return
		}

		// 自动写入 Vocabulary(查重)
		autoCreateVocabulary(uid, entry, &progress, ub.WordBook.Slug)

		// 更新词书统计
		ub.LearnedCount++
	}

	// 应用 SM-2 复习
	if err := applyWordBookReview(&progress, req.Rating); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := database.DB.Save(&progress).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save progress"})
		return
	}

	// 更新词书记录
	updateWordBookDailyRecord(ub.ID, true)

	// 更新 LastStudiedAt
	ub.LastStudiedAt = &now
	if err := database.DB.Save(&ub).Error; err != nil {
		fmt.Printf("failed to update UserWordBook LastStudiedAt: %v\n", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Learned",
		"data": gin.H{
			"progress_id":    progress.ID,
			"entry_id":       entry.ID,
			"word":           entry.Word,
			"status":         progress.Status,
			"next_review_at": progress.NextReviewAt,
		},
	})
}

// SubmitReviewResult 提交复习结果
func SubmitReviewResult(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	var ub models.UserWordBook
	if err := database.DB.Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&ub).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	var req wordBookReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var progress models.UserWordBookProgress
	if err := database.DB.Where("id = ? AND user_id = ? AND user_word_book_id = ?",
		req.ProgressID, uid, ub.ID).First(&progress).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Progress not found"})
		return
	}

	if err := applyWordBookReview(&progress, req.Rating); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := database.DB.Save(&progress).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save review"})
		return
	}

	// 调用已有函数联动 StudyRecord
	addStudyReviewedWord(uid)

	// 更新词书记录
	updateWordBookDailyRecord(ub.ID, false)

	// 更新 LastStudiedAt
	now := time.Now()
	ub.LastStudiedAt = &now
	if progress.Status == "mastered" {
		ub.MasteredCount++
	}
	if err := database.DB.Save(&ub).Error; err != nil {
		fmt.Printf("failed to update UserWordBook after review: %v\n", err)
	}

	// 加载词条信息用于响应
	var entry models.WordBookEntry
	if err := database.DB.First(&entry, progress.WordBookEntryID).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": "Reviewed",
			"data": gin.H{
				"progress_id":    progress.ID,
				"entry_id":       progress.WordBookEntryID,
				"status":         progress.Status,
				"next_review_at": progress.NextReviewAt,
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Reviewed",
		"data": gin.H{
			"progress_id":    progress.ID,
			"entry_id":       progress.WordBookEntryID,
			"word":           entry.Word,
			"status":         progress.Status,
			"next_review_at": progress.NextReviewAt,
		},
	})
}

// GetWordBookStats 获取词书统计
func GetWordBookStats(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	var ub models.UserWordBook
	if err := database.DB.Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&ub).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	var book models.WordBook
	if err := database.DB.First(&book, bookID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wordbook not found"})
		return
	}

	// 统计各状态数量
	type statusRow struct {
		Status string `gorm:"column:status"`
		Count  int    `gorm:"column:count"`
	}
	var statusRows []statusRow
	database.DB.Model(&models.UserWordBookProgress{}).
		Select("status, COUNT(*) as count").
		Where("user_word_book_id = ?", ub.ID).
		Group("status").
		Scan(&statusRows)

	statusCounts := make(map[string]int)
	for _, r := range statusRows {
		statusCounts[r.Status] = r.Count
	}

	var totalProgress int64
	database.DB.Model(&models.UserWordBookProgress{}).
		Where("user_word_book_id = ?", ub.ID).
		Count(&totalProgress)

	newCount := book.WordCount - int(totalProgress)
	learningCount := statusCounts["learning"]
	masteredCount := statusCounts["mastered"]
	skippedCount := statusCounts["skipped"]

	learnedPct := 0
	masteredPct := 0
	if book.WordCount > 0 {
		learnedPct = int(math.Round(float64(int(totalProgress)) / float64(book.WordCount) * 100))
		masteredPct = int(math.Round(float64(masteredCount) / float64(book.WordCount) * 100))
	}

	// 估算剩余天数
	estimatedDays := 0
	if ub.LearnedCount > 0 && ub.TotalStudiedDays > 0 {
		remaining := book.WordCount - int(totalProgress)
		avgDaily := float64(ub.LearnedCount) / float64(ub.TotalStudiedDays)
		if avgDaily > 0 {
			estimatedDays = int(math.Ceil(float64(remaining) / avgDaily))
		}
	}

	// 每日学习记录(打卡日历)
	var records []models.WordBookDailyRecord
	database.DB.Where("user_word_book_id = ?", ub.ID).
		Order("date ASC").
		Limit(35).
		Find(&records)

	calendar := make([]struct {
		Date        string `json:"date"`
		NewCount    int    `json:"new_count"`
		ReviewCount int    `json:"review_count"`
		IsCompleted bool   `json:"is_completed"`
	}, len(records))
	for i, r := range records {
		calendar[i] = struct {
			Date        string `json:"date"`
			NewCount    int    `json:"new_count"`
			ReviewCount int    `json:"review_count"`
			IsCompleted bool   `json:"is_completed"`
		}{
			Date:        r.Date,
			NewCount:    r.NewLearned,
			ReviewCount: r.ReviewDone,
			IsCompleted: r.IsCompleted,
		}
	}

	// 平均值
	avgDailyNew := 0.0
	avgDailyReview := 0.0
	if ub.TotalStudiedDays > 0 {
		var totalNew, totalReview int64
		database.DB.Model(&models.WordBookDailyRecord{}).
			Where("user_word_book_id = ?", ub.ID).
			Select("SUM(new_learned) as total_new, SUM(review_done) as total_review").
			Row().Scan(&totalNew, &totalReview)
		avgDailyNew = math.Round(float64(totalNew)/float64(ub.TotalStudiedDays)*10) / 10
		avgDailyReview = math.Round(float64(totalReview)/float64(ub.TotalStudiedDays)*10) / 10
	}

	c.JSON(http.StatusOK, gin.H{"data": wordBookStatsResponse{
		TotalEntries:          book.WordCount,
		NewCount:              newCount,
		LearningCount:         learningCount,
		MasteredCount:         masteredCount,
		SkippedCount:          skippedCount,
		LearnedPct:            learnedPct,
		MasteredPct:           masteredPct,
		EstimatedDaysRemaining: estimatedDays,
		CurrentStreak:         ub.CurrentStreak,
		TotalStudiedDays:      ub.TotalStudiedDays,
		AvgDailyNew:           avgDailyNew,
		AvgDailyReview:        avgDailyReview,
		Calendar:              calendar,
	}})
}

// ---------- 核心算法 ----------

// generateDailyTasks 生成今日词书学习任务
func generateDailyTasks(db *gorm.DB, userID uint, ub models.UserWordBook) (*dailyTasksResponse, error) {
	today := time.Now().Format("2006-01-02")

	// 1. 收集到期复习词
	var dueProgresses []models.UserWordBookProgress
	db.Where("user_word_book_id = ? AND status IN ? AND next_review_at <= ?",
		ub.ID,
		[]string{"learning", "mastered"},
		time.Now(),
	).Order("next_review_at ASC, forgotten_count DESC").
		Limit(ub.DailyReviewWords).
		Find(&dueProgresses)

	reviewWords := make([]dailyTaskReviewWord, 0, len(dueProgresses))
	for _, p := range dueProgresses {
		var entry models.WordBookEntry
		if err := db.First(&entry, p.WordBookEntryID).Error; err != nil {
			continue
		}
		nextReview := ""
		if p.NextReviewAt != nil {
			nextReview = p.NextReviewAt.Format(time.RFC3339)
		}
		reviewWords = append(reviewWords, dailyTaskReviewWord{
			ProgressID:     p.ID,
			EntryID:        entry.ID,
			Word:           entry.Word,
			Phonetic:       entry.Phonetic,
			UKPhonetic:     entry.UKPhonetic,
			USPhonetic:     entry.USPhonetic,
			Translation:    entry.Translation,
			Status:         p.Status,
			ReviewCount:    p.ReviewCount,
			ForgottenCount: p.ForgottenCount,
			NextReviewAt:   nextReview,
		})
	}

	// 2. 计算新词释放数量
	newWordQuota := ub.DailyNewWords

	// 2a. 基于前一日复习完成度调整
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	var yesterdayRecord models.WordBookDailyRecord
	if err := db.Where("user_word_book_id = ? AND date = ?", ub.ID, yesterday).
		First(&yesterdayRecord).Error; err == nil {
		if yesterdayRecord.ReviewDone > 0 && yesterdayRecord.ReviewTotal > 0 {
			completionRate := float64(yesterdayRecord.ReviewDone) / float64(yesterdayRecord.ReviewTotal)
			if completionRate < 0.6 {
				newWordQuota = maxInt(5, newWordQuota/2)
			}
		}
	}

	// 2b. 堆积控制
	var backlogCount int64
	db.Model(&models.UserWordBookProgress{}).
		Where("user_word_book_id = ? AND status IN ? AND next_review_at <= ?",
			ub.ID, []string{"learning", "mastered"}, time.Now()).
		Count(&backlogCount)
	if int(backlogCount) > wbMaxBacklogWords {
		newWordQuota = 0
	}

	// 3. 选取新词
	learnedEntryIDs := db.Model(&models.UserWordBookProgress{}).
		Where("user_word_book_id = ?", ub.ID).
		Select("word_book_entry_id")

	var newEntries []models.WordBookEntry
	db.Where("word_book_id = ? AND id NOT IN (?)",
		ub.WordBookID, learnedEntryIDs,
	).Order("sort_order ASC").
		Limit(newWordQuota).
		Find(&newEntries)

	newWords := make([]dailyTaskNewWord, 0, len(newEntries))
	for _, e := range newEntries {
		newWords = append(newWords, dailyTaskNewWord{
			EntryID:     e.ID,
			Word:        e.Word,
			Phonetic:    e.Phonetic,
			UKPhonetic:  e.UKPhonetic,
			USPhonetic:  e.USPhonetic,
			Translation: e.Translation,
			Definitions: e.Definitions,
			Examples:    e.Examples,
			Collocations: e.Collocations,
			Status:      "new",
		})
	}

	return &dailyTasksResponse{
		Date:         today,
		NewWords:     newWords,
		ReviewWords:  reviewWords,
		TotalNew:     len(newWords),
		TotalReview:  len(reviewWords),
		BacklogCount: int(backlogCount),
		NewWordQuota: newWordQuota,
		Plan: struct {
			DailyNewWords    int `json:"daily_new_words"`
			DailyReviewWords int `json:"daily_review_words"`
		}{
			DailyNewWords:    ub.DailyNewWords,
			DailyReviewWords: ub.DailyReviewWords,
		},
	}, nil
}

// applyWordBookReview 对词书进度应用 SM-2 间隔复习
func applyWordBookReview(progress *models.UserWordBookProgress, rating string) error {
	now := time.Now()
	ease := progress.ReviewEase
	if ease <= 0 {
		ease = srsDefaultEase
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
		if progress.ReviewCount >= srsMasteryReviewCount || interval >= srsMasteryInterval {
			progress.IsLearned = true
			progress.Status = "mastered"
		}
	default:
		return fmt.Errorf("rating must be forgot, hard, or good")
	}

	if ease < srsMinEase {
		ease = srsMinEase
	}
	nextReview := now.AddDate(0, 0, interval)
	progress.ReviewCount++
	progress.ReviewInterval = interval
	progress.ReviewEase = ease
	progress.LastReviewAt = &now
	progress.NextReviewAt = &nextReview
	return nil
}

// autoCreateVocabulary 自动写入 Vocabulary(查重)
func autoCreateVocabulary(userID uint, entry models.WordBookEntry, progress *models.UserWordBookProgress, slug string) {
	normalizedWord := normalizeLookupWord(entry.Word)
	var existing models.Vocabulary
	err := database.DB.Where("user_id = ? AND LOWER(TRIM(word)) = ?", userID, normalizedWord).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		newVocab := models.Vocabulary{
			UserID:      userID,
			Word:        normalizedWord,
			Phonetic:    entry.USPhonetic,
			Translation: entry.Translation,
			Definition:  entry.Definitions,
			Examples:    entry.Examples,
			ReviewEase:  srsDefaultEase,
			Notes:       fmt.Sprintf("[wordbook:%s]", slug),
		}
		if err := database.DB.Create(&newVocab).Error; err == nil {
			progress.VocabularyID = &newVocab.ID
			// 联动知识图谱(非阻塞)
			go func() {
				_ = services.NewKnowledgeGraphService(database.DB).SyncVocabulary(userID, newVocab)
			}()
		}
	} else if err == nil {
		progress.VocabularyID = &existing.ID
	}
}

// updateWordBookDailyRecord 更新词书每日学习记录
func updateWordBookDailyRecord(userWordBookID uint, isNew bool) {
	today := time.Now().Format("2006-01-02")

	var record models.WordBookDailyRecord
	err := database.DB.Where("user_word_book_id = ? AND date = ?", userWordBookID, today).First(&record).Error
	if err != nil {
		record = models.WordBookDailyRecord{
			UserWordBookID: userWordBookID,
			Date:           today,
			StudiedAt:      time.Now(),
		}
	}

	todayWasCompleted := record.IsCompleted

	// 只在首次创建时初始化目标值，或者目标值为0时重新设置
	// 注意：实际的目标值应该在 GetTodayTasks 时就设置好，这里只是兜底逻辑
	if record.ID == 0 && record.NewTotal == 0 && record.ReviewTotal == 0 {
		var ub models.UserWordBook
		if err := database.DB.First(&ub, "id = ?", userWordBookID).Error; err == nil {
			record.NewTotal = ub.DailyNewWords
			record.ReviewTotal = ub.DailyReviewWords
		}
	}

	if isNew {
		record.NewLearned++
	} else {
		record.ReviewDone++
	}

	record.IsCompleted = record.NewLearned >= record.NewTotal && record.ReviewDone >= record.ReviewTotal && record.NewTotal > 0 && record.ReviewTotal > 0
	record.StudiedAt = time.Now()

	if record.ID == 0 {
		if err := database.DB.Create(&record).Error; err != nil {
			fmt.Printf("failed to create daily record: %v\n", err)
			return
		}
	} else {
		if err := database.DB.Save(&record).Error; err != nil {
			fmt.Printf("failed to save daily record: %v\n", err)
			return
		}
	}

	// 更新 UserWordBook 的连续天数和学习天数
	updateWordBookStreak(userWordBookID, todayWasCompleted)
}

// initializeDailyRecordTargets 初始化今日记录的目标值（只在首次获取任务时设置）
func initializeDailyRecordTargets(userWordBookID uint, actualNewCount, actualReviewCount int) {
	today := time.Now().Format("2006-01-02")

	var record models.WordBookDailyRecord
	err := database.DB.Where("user_word_book_id = ? AND date = ?", userWordBookID, today).First(&record).Error

	if err != nil {
		// 记录不存在，创建新记录
		record = models.WordBookDailyRecord{
			UserWordBookID: userWordBookID,
			Date:           today,
			NewTotal:       actualNewCount,
			ReviewTotal:    actualReviewCount,
			StudiedAt:      time.Now(),
		}
		if err := database.DB.Create(&record).Error; err != nil {
			fmt.Printf("failed to create daily record: %v\n", err)
		}
	} else if record.NewLearned == 0 && record.ReviewDone == 0 {
		// 记录存在但还没有任何学习进度，更新目标值
		// 这处理了后端重启或目标值不正确的情况
		record.NewTotal = actualNewCount
		record.ReviewTotal = actualReviewCount
		if err := database.DB.Save(&record).Error; err != nil {
			fmt.Printf("failed to update daily record targets: %v\n", err)
		}
	}
	// 如果已经有学习进度（NewLearned > 0 或 ReviewDone > 0），则不修改目标值
}

// updateWordBookStreak 更新词书学习连续天数
func updateWordBookStreak(userWordBookID uint, todayWasCompleted bool) {
	var ub models.UserWordBook
	if err := database.DB.First(&ub, "id = ?", userWordBookID).Error; err != nil {
		return
	}

	today := time.Now().Format("2006-01-02")
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")

	var todayRecord models.WordBookDailyRecord
	todayExists := database.DB.Where("user_word_book_id = ? AND date = ?", userWordBookID, today).First(&todayRecord).Error == nil

	var yesterdayRecord models.WordBookDailyRecord
	yesterdayCompleted := database.DB.Where("user_word_book_id = ? AND date = ? AND is_completed = ?",
		userWordBookID, yesterday, true).First(&yesterdayRecord).Error == nil

	todayCompleted := todayExists && todayRecord.IsCompleted

	if todayCompleted {
		if yesterdayCompleted {
			ub.CurrentStreak++
		} else {
			ub.CurrentStreak = 1
		}
		if !todayWasCompleted {
			ub.TotalStudiedDays++
		}
	} else {
		ub.CurrentStreak = 0
	}

	ub.LastStudiedAt = ptrTime(time.Now())
	database.DB.Save(&ub)
}

func ptrTime(t time.Time) *time.Time {
	return &t
}

// ---------- 词表查询与重置 ----------

// wordBookEntryItem 词表查询中的单个词条
type wordBookEntryItem struct {
	ID            uint   `json:"id"`
	Word          string `json:"word"`
	Phonetic      string `json:"phonetic"`
	UKPhonetic    string `json:"uk_phonetic"`
	USPhonetic    string `json:"us_phonetic"`
	Translation   string `json:"translation"`
	Definitions   string `json:"definitions"`
	Examples      string `json:"examples"`
	Collocations  string `json:"collocations"`
	Unit          int    `json:"unit"`
	SortOrder     int    `json:"sort_order"`
	Frequency     int    `json:"frequency"`
	Difficulty    string `json:"difficulty"`
}

// wordBookProgressSnapshot 用户进度快照
type wordBookProgressSnapshot struct {
	ProgressID     uint   `json:"progress_id"`
	Status         string `json:"status"`
	ReviewCount    int    `json:"review_count"`
	ForgottenCount int    `json:"forgotten_count"`
	ReviewInterval int    `json:"review_interval"`
	ReviewEase     float64 `json:"review_ease"`
	NextReviewAt   string `json:"next_review_at,omitempty"`
	LastReviewAt   string `json:"last_review_at,omitempty"`
	FirstSeenAt    string `json:"first_seen_at,omitempty"`
}

// GetWordBookUnits 返回词书的单元列表(单元号 + 词条数),供词表页筛选器使用
func GetWordBookUnits(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	var book models.WordBook
	if err := database.DB.First(&book, bookID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wordbook not found"})
		return
	}

	type unitRow struct {
		Unit  int `gorm:"column:unit"`
		Count int `gorm:"column:count"`
	}
	var rows []unitRow
	database.DB.Model(&models.WordBookEntry{}).
		Select("unit, COUNT(*) as count").
		Where("word_book_id = ? AND unit > 0", bookID).
		Group("unit").
		Order("unit ASC").
		Scan(&rows)

	units := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		units = append(units, gin.H{"unit": r.Unit, "count": r.Count})
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"word_book_id": bookID,
			"total_units":  book.UnitCount,
			"units":        units,
		},
	})
}

// GetWordBookEntries 获取词书词条列表(分页)
func GetWordBookEntries(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	// 验证词书存在
	var book models.WordBook
	if err := database.DB.First(&book, bookID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wordbook not found"})
		return
	}

	// 解析查询参数
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "30"))
	unit, _ := strconv.Atoi(c.Query("unit"))
	status := c.Query("status")
	search := c.Query("search")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 30
	}

	// 构建查询
	query := database.DB.Where("word_book_id = ?", bookID)
	if unit > 0 {
		query = query.Where("unit = ?", unit)
	}
	if search != "" {
		query = query.Where("word ILIKE ? OR translation ILIKE ?", "%"+search+"%", "%"+search+"%")
	}

	// 状态筛选需要先获取进度
	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	// 查找用户订阅
	var ub models.UserWordBook
	hasSub := database.DB.Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&ub).Error == nil

	// 如果有状态筛选,需要 join 进度表
	if status != "" && hasSub {
		switch status {
		case "new":
			// 未学习的:不在 progress 表中的词条
			learnedIDs := database.DB.Model(&models.UserWordBookProgress{}).
				Where("user_word_book_id = ?", ub.ID).
				Select("word_book_entry_id")
			query = query.Where("id NOT IN (?)", learnedIDs)
		case "learning", "mastered":
			progressIDs := database.DB.Model(&models.UserWordBookProgress{}).
				Where("user_word_book_id = ? AND status = ?", ub.ID, status).
				Select("word_book_entry_id")
			query = query.Where("id IN (?)", progressIDs)
		}
	}

	// 计算总数
	var total int64
	query.Model(&models.WordBookEntry{}).Count(&total)

	totalPages := int(math.Ceil(float64(total) / float64(pageSize)))
	offset := (page - 1) * pageSize

	var entries []models.WordBookEntry
	query.Order("sort_order ASC").Offset(offset).Limit(pageSize).Find(&entries)

	// 构造词条列表
	items := make([]wordBookEntryItem, len(entries))
	for i, e := range entries {
		items[i] = wordBookEntryItem{
			ID:           e.ID,
			Word:         e.Word,
			Phonetic:     e.Phonetic,
			UKPhonetic:   e.UKPhonetic,
			USPhonetic:   e.USPhonetic,
			Translation:  e.Translation,
			Definitions:  e.Definitions,
			Examples:     e.Examples,
			Collocations: e.Collocations,
			Unit:         e.Unit,
			SortOrder:    e.SortOrder,
			Frequency:    e.Frequency,
			Difficulty:   e.Difficulty,
		}
	}

	// 获取用户进度映射
	userProgress := make(map[string]wordBookProgressSnapshot)
	if hasSub && len(entries) > 0 {
		entryIDs := make([]uint, len(entries))
		for i, e := range entries {
			entryIDs[i] = e.ID
		}

		var progresses []models.UserWordBookProgress
		database.DB.Where("user_word_book_id = ? AND word_book_entry_id IN ?", ub.ID, entryIDs).
			Find(&progresses)

		for _, p := range progresses {
			snap := wordBookProgressSnapshot{
				ProgressID:     p.ID,
				Status:         p.Status,
				ReviewCount:    p.ReviewCount,
				ForgottenCount: p.ForgottenCount,
				ReviewInterval: p.ReviewInterval,
				ReviewEase:     p.ReviewEase,
			}
			if p.NextReviewAt != nil {
				snap.NextReviewAt = p.NextReviewAt.Format(time.RFC3339)
			}
			if p.LastReviewAt != nil {
				snap.LastReviewAt = p.LastReviewAt.Format(time.RFC3339)
			}
			if p.FirstSeenAt != nil {
				snap.FirstSeenAt = p.FirstSeenAt.Format(time.RFC3339)
			}
			userProgress[strconv.FormatUint(uint64(p.WordBookEntryID), 10)] = snap
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"items":       items,
			"total":       total,
			"page":        page,
			"page_size":   pageSize,
			"total_pages": totalPages,
		},
		"user_progress": userProgress,
	})
}

// ResetWordBookProgress 重置词书学习进度
func ResetWordBookProgress(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	userID, _ := c.Get("user_id")
	uid := userID.(uint)

	// 验证订阅存在
	var ub models.UserWordBook
	if err := database.DB.Where("user_id = ? AND word_book_id = ?", uid, bookID).First(&ub).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	// 需要确认
	var req struct {
		Confirm bool `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || !req.Confirm {
		c.JSON(http.StatusBadRequest, gin.H{"error": "confirm must be true"})
		return
	}

	// 软删除进度记录
	database.DB.Where("user_word_book_id = ?", ub.ID).Delete(&models.UserWordBookProgress{})

	// 软删除每日记录
	database.DB.Where("user_word_book_id = ?", ub.ID).Delete(&models.WordBookDailyRecord{})

	// 重置统计字段,保留订阅
	ub.LearnedCount = 0
	ub.MasteredCount = 0
	ub.CurrentStreak = 0
	ub.TotalStudiedDays = 0
	ub.CurrentUnit = 0
	ub.CompletedAt = nil
	database.DB.Save(&ub)

	c.JSON(http.StatusOK, gin.H{
		"message": "Progress reset successfully",
		"data":    ub,
	})
}

// 辅助:忽略未使用的 json 包(在 stats 里可能用到)
var _ = json.Marshal

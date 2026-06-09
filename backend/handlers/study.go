package handlers

import (
	"gugudu-backend/database"
	"gugudu-backend/models"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultDailyReadMinutes = 20
	defaultDailyReviewWords = 10
	defaultDailyArticles    = 1
	studyCalendarDays       = 35
)

type studyProgress struct {
	ReadMinutes       int `json:"read_minutes"`
	ReviewedWords     int `json:"reviewed_words"`
	CompletedArticles int `json:"completed_articles"`
}

type studyTodayResponse struct {
	Goal        models.StudyGoal     `json:"goal"`
	Today       models.StudyRecord   `json:"today"`
	Progress    studyProgress        `json:"progress"`
	Completion  int                  `json:"completion"`
	IsCompleted bool                 `json:"is_completed"`
	Streak      int                  `json:"streak"`
	Calendar    []models.StudyRecord `json:"calendar"`
}

type studyMasteryMetric struct {
	Total      int `json:"total"`
	Mastered   int `json:"mastered"`
	MasteryPct int `json:"mastery_pct"`
}

type studyForgottenWord struct {
	ID             uint   `json:"id"`
	Word           string `json:"word"`
	Translation    string `json:"translation"`
	ForgottenCount int    `json:"forgotten_count"`
	Context        string `json:"context"`
}

type studyReadingSpeedTrend struct {
	CurrentWPM       int `json:"current_wpm"`
	PreviousWPM      int `json:"previous_wpm"`
	ChangePct        int `json:"change_pct"`
	CurrentArticles  int `json:"current_articles"`
	PreviousArticles int `json:"previous_articles"`
}

type studyDifficultyCompletion struct {
	Difficulty string `json:"difficulty"`
	Total      int    `json:"total"`
	Completed  int    `json:"completed"`
	RatePct    int    `json:"rate_pct"`
}

type studyWeakGrammarPoint struct {
	Name        string `json:"name"`
	Count       int    `json:"count"`
	Description string `json:"description"`
}

type studyPracticeAction struct {
	Type        string `json:"type"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Href        string `json:"href"`
}

type studyDiagnosticsResponse struct {
	WeekStart             string                      `json:"week_start"`
	NewWordMastery        studyMasteryMetric          `json:"new_word_mastery"`
	MostForgottenWords    []studyForgottenWord        `json:"most_forgotten_words"`
	ReadingSpeedTrend     studyReadingSpeedTrend      `json:"reading_speed_trend"`
	DifficultyCompletions []studyDifficultyCompletion `json:"difficulty_completions"`
	WeakGrammarPoints     []studyWeakGrammarPoint     `json:"weak_grammar_points"`
	PracticeActions       []studyPracticeAction       `json:"practice_actions"`
	GeneratedAt           time.Time                   `json:"generated_at"`
}

// GetStudyToday 获取今日学习闭环数据
func GetStudyToday(c *gin.Context) {
	userID, _ := c.Get("user_id")

	goal, err := ensureStudyGoal(userID.(uint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load study goal"})
		return
	}

	today, err := ensureTodayStudyRecord(userID.(uint), goal)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load study record"})
		return
	}

	calendar, err := getStudyCalendar(userID.(uint), time.Now(), studyCalendarDays)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load study calendar"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": buildStudyTodayResponse(goal, today, calendar)})
}

// GetStudyDiagnostics 获取学习质量诊断数据
func GetStudyDiagnostics(c *gin.Context) {
	userID, _ := c.Get("user_id")

	diagnostics, err := buildStudyDiagnostics(userID.(uint), time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load study diagnostics"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": diagnostics})
}

// UpdateStudyGoal 更新每日目标
func UpdateStudyGoal(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req struct {
		DailyReadMinutes int `json:"daily_read_minutes" binding:"required,min=1,max=240"`
		DailyReviewWords int `json:"daily_review_words" binding:"required,min=1,max=500"`
		DailyArticles    int `json:"daily_articles" binding:"required,min=1,max=20"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	goal, err := ensureStudyGoal(userID.(uint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load study goal"})
		return
	}

	goal.DailyReadMinutes = req.DailyReadMinutes
	goal.DailyReviewWords = req.DailyReviewWords
	goal.DailyArticles = req.DailyArticles

	if err := database.DB.Save(&goal).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update study goal"})
		return
	}

	today, err := ensureTodayStudyRecord(userID.(uint), goal)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update study record"})
		return
	}

	calendar, err := getStudyCalendar(userID.(uint), time.Now(), studyCalendarDays)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load study calendar"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": buildStudyTodayResponse(goal, today, calendar)})
}

func addStudyReadTime(userID uint, seconds int, completedArticle bool) {
	if seconds <= 0 && !completedArticle {
		return
	}

	goal, err := ensureStudyGoal(userID)
	if err != nil {
		return
	}

	record, err := getOrCreateStudyRecord(userID, todayString(), time.Now())
	if err != nil {
		return
	}

	if seconds > 0 {
		record.ReadSeconds += seconds
	}
	if completedArticle {
		record.CompletedArticles++
	}
	updateStudyRecordCompletion(&record, goal)
	database.DB.Save(&record)
}

func addStudyReviewedWord(userID uint) {
	goal, err := ensureStudyGoal(userID)
	if err != nil {
		return
	}

	record, err := getOrCreateStudyRecord(userID, todayString(), time.Now())
	if err != nil {
		return
	}

	record.ReviewedWords++
	updateStudyRecordCompletion(&record, goal)
	database.DB.Save(&record)
}

func ensureStudyGoal(userID uint) (models.StudyGoal, error) {
	goal := models.StudyGoal{
		UserID:           userID,
		DailyReadMinutes: defaultDailyReadMinutes,
		DailyReviewWords: defaultDailyReviewWords,
		DailyArticles:    defaultDailyArticles,
	}

	err := database.DB.Where("user_id = ?", userID).
		Attrs(goal).
		FirstOrCreate(&goal).Error
	return goal, err
}

func ensureTodayStudyRecord(userID uint, goal models.StudyGoal) (models.StudyRecord, error) {
	record, err := getOrCreateStudyRecord(userID, todayString(), time.Now())
	if err != nil {
		return record, err
	}
	updateStudyRecordCompletion(&record, goal)
	if err := database.DB.Save(&record).Error; err != nil {
		return record, err
	}
	return record, nil
}

func getOrCreateStudyRecord(userID uint, date string, activityAt time.Time) (models.StudyRecord, error) {
	record := models.StudyRecord{
		UserID:         userID,
		Date:           date,
		LastActivityAt: activityAt,
	}

	err := database.DB.
		Clauses(clause.OnConflict{DoNothing: true}).
		Where("user_id = ? AND date = ?", userID, date).
		Attrs(record).
		FirstOrCreate(&record).Error
	if err != nil {
		return record, err
	}

	if record.LastActivityAt.IsZero() {
		record.LastActivityAt = activityAt
	}
	return record, nil
}

func updateStudyRecordCompletion(record *models.StudyRecord, goal models.StudyGoal) {
	record.LastActivityAt = time.Now()
	record.IsCompleted = record.ReadSeconds >= goal.DailyReadMinutes*60 &&
		record.ReviewedWords >= goal.DailyReviewWords &&
		record.CompletedArticles >= goal.DailyArticles
}

func getStudyCalendar(userID uint, now time.Time, days int) ([]models.StudyRecord, error) {
	start := now.AddDate(0, 0, -days+1).Format("2006-01-02")
	end := now.Format("2006-01-02")

	var records []models.StudyRecord
	if err := database.DB.
		Where("user_id = ? AND date BETWEEN ? AND ?", userID, start, end).
		Order("date ASC").
		Find(&records).Error; err != nil {
		return nil, err
	}

	byDate := make(map[string]models.StudyRecord, len(records))
	for _, record := range records {
		byDate[record.Date] = record
	}

	calendar := make([]models.StudyRecord, 0, days)
	for index := days - 1; index >= 0; index-- {
		date := now.AddDate(0, 0, -index).Format("2006-01-02")
		if record, ok := byDate[date]; ok {
			calendar = append(calendar, record)
			continue
		}
		calendar = append(calendar, models.StudyRecord{UserID: userID, Date: date})
	}
	return calendar, nil
}

func buildStudyTodayResponse(goal models.StudyGoal, today models.StudyRecord, calendar []models.StudyRecord) studyTodayResponse {
	progress := studyProgress{
		ReadMinutes:       int(math.Ceil(float64(today.ReadSeconds) / 60)),
		ReviewedWords:     today.ReviewedWords,
		CompletedArticles: today.CompletedArticles,
	}

	return studyTodayResponse{
		Goal:        goal,
		Today:       today,
		Progress:    progress,
		Completion:  calculateStudyCompletion(goal, today),
		IsCompleted: today.IsCompleted,
		Streak:      calculateStudyStreak(calendar),
		Calendar:    calendar,
	}
}

func calculateStudyCompletion(goal models.StudyGoal, record models.StudyRecord) int {
	readRatio := ratio(record.ReadSeconds, goal.DailyReadMinutes*60)
	reviewRatio := ratio(record.ReviewedWords, goal.DailyReviewWords)
	articleRatio := ratio(record.CompletedArticles, goal.DailyArticles)
	return int(math.Round((readRatio + reviewRatio + articleRatio) / 3 * 100))
}

func ratio(value, target int) float64 {
	if target <= 0 {
		return 1
	}
	if value >= target {
		return 1
	}
	if value <= 0 {
		return 0
	}
	return float64(value) / float64(target)
}

func calculateStudyStreak(calendar []models.StudyRecord) int {
	streak := 0
	for index := len(calendar) - 1; index >= 0; index-- {
		if !calendar[index].IsCompleted {
			break
		}
		streak++
	}
	return streak
}

func buildStudyDiagnostics(userID uint, now time.Time) (studyDiagnosticsResponse, error) {
	weekStart := startOfWeek(now)
	previousWeekStart := weekStart.AddDate(0, 0, -7)

	newWordMastery, err := getNewWordMastery(userID, weekStart)
	if err != nil {
		return studyDiagnosticsResponse{}, err
	}

	forgottenWords, err := getMostForgottenWords(userID, 5)
	if err != nil {
		return studyDiagnosticsResponse{}, err
	}

	currentSpeed, currentArticles, err := getReadingSpeed(userID, weekStart, now.Add(time.Second))
	if err != nil {
		return studyDiagnosticsResponse{}, err
	}
	previousSpeed, previousArticles, err := getReadingSpeed(userID, previousWeekStart, weekStart)
	if err != nil {
		return studyDiagnosticsResponse{}, err
	}

	completions, err := getDifficultyCompletions(userID)
	if err != nil {
		return studyDiagnosticsResponse{}, err
	}

	weakGrammarPoints, err := getWeakGrammarPoints(userID)
	if err != nil {
		return studyDiagnosticsResponse{}, err
	}

	practiceHref := getLatestPracticeArticleHref(userID)

	return studyDiagnosticsResponse{
		WeekStart:          weekStart.Format("2006-01-02"),
		NewWordMastery:     newWordMastery,
		MostForgottenWords: forgottenWords,
		ReadingSpeedTrend: studyReadingSpeedTrend{
			CurrentWPM:       currentSpeed,
			PreviousWPM:      previousSpeed,
			ChangePct:        percentChange(currentSpeed, previousSpeed),
			CurrentArticles:  currentArticles,
			PreviousArticles: previousArticles,
		},
		DifficultyCompletions: completions,
		WeakGrammarPoints:     weakGrammarPoints,
		PracticeActions: []studyPracticeAction{
			{
				Type:        "rewrite",
				Title:       "改写练习",
				Description: "用最近阅读文章里的句子做同义改写，训练表达弹性。",
				Href:        practiceHref + "?practice=rewrite",
			},
			{
				Type:        "imitation",
				Title:       "仿写练习",
				Description: "抽取文章句式，替换主题和关键词做输出表达。",
				Href:        practiceHref + "?practice=imitation",
			},
			{
				Type:        "cn_en",
				Title:       "中译英复现",
				Description: "根据中文提示复现英文表达，再对照原文修正。",
				Href:        practiceHref + "?practice=cn-en",
			},
			{
				Type:        "ai_correction",
				Title:       "AI 批改输出",
				Description: "提交自己的改写或仿写，让 AI 按准确度和自然度批改。",
				Href:        practiceHref + "?practice=correction",
			},
		},
		GeneratedAt: now,
	}, nil
}

func startOfWeek(now time.Time) time.Time {
	year, month, day := now.Date()
	start := time.Date(year, month, day, 0, 0, 0, 0, now.Location())
	weekday := int(start.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	return start.AddDate(0, 0, -weekday+1)
}

func getNewWordMastery(userID uint, weekStart time.Time) (studyMasteryMetric, error) {
	var words []models.Vocabulary
	if err := database.DB.
		Where("user_id = ? AND created_at >= ?", userID, weekStart).
		Find(&words).Error; err != nil {
		return studyMasteryMetric{}, err
	}

	mastered := 0
	for _, word := range words {
		if word.IsLearned {
			mastered++
		}
	}

	return studyMasteryMetric{
		Total:      len(words),
		Mastered:   mastered,
		MasteryPct: percent(mastered, len(words)),
	}, nil
}

func getMostForgottenWords(userID uint, limit int) ([]studyForgottenWord, error) {
	var words []models.Vocabulary
	if err := database.DB.
		Where("user_id = ? AND forgotten_count > 0", userID).
		Order("forgotten_count DESC, COALESCE(last_review, updated_at) DESC").
		Limit(limit).
		Find(&words).Error; err != nil {
		return nil, err
	}

	result := make([]studyForgottenWord, 0, len(words))
	for _, word := range words {
		result = append(result, studyForgottenWord{
			ID:             word.ID,
			Word:           word.Word,
			Translation:    word.Translation,
			ForgottenCount: word.ForgottenCount,
			Context:        word.Context,
		})
	}
	return result, nil
}

func getReadingSpeed(userID uint, start, end time.Time) (int, int, error) {
	var histories []models.ReadHistory
	if err := database.DB.
		Preload("Article").
		Where("user_id = ? AND last_read_at >= ? AND last_read_at < ? AND read_time > 0", userID, start, end).
		Find(&histories).Error; err != nil {
		return 0, 0, err
	}

	words := 0
	seconds := 0
	for _, history := range histories {
		if history.Article.WordCount <= 0 || history.ReadTime <= 0 {
			continue
		}
		words += history.Article.WordCount
		seconds += history.ReadTime
	}
	if words == 0 || seconds == 0 {
		return 0, len(histories), nil
	}

	return int(math.Round(float64(words) / (float64(seconds) / 60))), len(histories), nil
}

func getDifficultyCompletions(userID uint) ([]studyDifficultyCompletion, error) {
	var histories []models.ReadHistory
	if err := database.DB.
		Preload("Article").
		Where("user_id = ?", userID).
		Find(&histories).Error; err != nil {
		return nil, err
	}

	type difficultyCount struct {
		total     int
		completed int
	}
	counts := map[string]*difficultyCount{
		"easy":   {},
		"medium": {},
		"hard":   {},
	}

	for _, history := range histories {
		difficulty := strings.TrimSpace(history.Article.DifficultyLevel)
		if difficulty == "" {
			difficulty = "medium"
		}
		if _, ok := counts[difficulty]; !ok {
			counts[difficulty] = &difficultyCount{}
		}
		counts[difficulty].total++
		if history.IsCompleted {
			counts[difficulty].completed++
		}
	}

	order := []string{"easy", "medium", "hard"}
	result := make([]studyDifficultyCompletion, 0, len(order))
	for _, difficulty := range order {
		count := counts[difficulty]
		result = append(result, studyDifficultyCompletion{
			Difficulty: difficulty,
			Total:      count.total,
			Completed:  count.completed,
			RatePct:    percent(count.completed, count.total),
		})
	}
	return result, nil
}

func getWeakGrammarPoints(userID uint) ([]studyWeakGrammarPoint, error) {
	var words []models.Vocabulary
	if err := database.DB.
		Where("user_id = ? AND (forgotten_count > 0 OR is_learned = ?)", userID, false).
		Order("forgotten_count DESC, updated_at DESC").
		Limit(80).
		Find(&words).Error; err != nil {
		return nil, err
	}

	texts := make([]string, 0, len(words)+20)
	for _, word := range words {
		if strings.TrimSpace(word.Context) != "" {
			texts = append(texts, word.Context)
		}
	}

	var histories []models.ReadHistory
	if err := database.DB.
		Preload("Article").
		Where("user_id = ?", userID).
		Order("last_read_at DESC").
		Limit(20).
		Find(&histories).Error; err != nil {
		return nil, err
	}
	for _, history := range histories {
		if strings.TrimSpace(history.Article.Content) != "" {
			texts = append(texts, truncateString(history.Article.Content, 1200))
		}
	}

	return rankGrammarPoints(texts), nil
}

func rankGrammarPoints(texts []string) []studyWeakGrammarPoint {
	rules := []struct {
		name        string
		description string
		patterns    []*regexp.Regexp
	}{
		{
			name:        "定语从句",
			description: "who / which / that 引导的后置修饰较多，阅读时先找先行词。",
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)\b(who|which|that|whose|whom)\b`),
			},
		},
		{
			name:        "被动语态",
			description: "be + 过去分词结构较多，注意动作承受者和省略的施动者。",
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)\b(is|are|was|were|be|been|being)\s+\w+(ed|en)\b`),
			},
		},
		{
			name:        "非谓语结构",
			description: "-ing / to do / 过去分词短语承担修饰或补充说明，容易拉长句子。",
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)\b(to\s+\w+|,\s*\w+ing\b|\w+ed\s+by\b)`),
			},
		},
		{
			name:        "完成时",
			description: "have / has / had + 过去分词强调状态延续或先后关系。",
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)\b(has|have|had)\s+\w+(ed|en)\b`),
			},
		},
		{
			name:        "条件与让步",
			description: "if / unless / although / while 等连接词会改变句子逻辑方向。",
			patterns: []*regexp.Regexp{
				regexp.MustCompile(`(?i)\b(if|unless|although|though|while|whereas|despite)\b`),
			},
		},
	}

	points := make([]studyWeakGrammarPoint, 0, len(rules))
	for _, rule := range rules {
		count := 0
		for _, text := range texts {
			for _, pattern := range rule.patterns {
				count += len(pattern.FindAllString(text, -1))
			}
		}
		if count == 0 {
			continue
		}
		points = append(points, studyWeakGrammarPoint{
			Name:        rule.name,
			Count:       count,
			Description: rule.description,
		})
	}

	sort.Slice(points, func(i, j int) bool {
		if points[i].Count == points[j].Count {
			return points[i].Name < points[j].Name
		}
		return points[i].Count > points[j].Count
	})

	if len(points) > 5 {
		return points[:5]
	}
	return points
}

func getLatestPracticeArticleHref(userID uint) string {
	var history models.ReadHistory
	if err := database.DB.
		Preload("Article").
		Where("user_id = ?", userID).
		Order("last_read_at DESC").
		First(&history).Error; err == nil && history.Article.Slug != "" {
		return "/articles/" + history.Article.Slug
	}

	var article models.Article
	if err := database.DB.
		Where("status = ?", "published").
		Order("published_at DESC").
		First(&article).Error; err == nil && article.Slug != "" {
		return "/articles/" + article.Slug
	}

	return "/latest"
}

func percent(value, target int) int {
	if target <= 0 {
		return 0
	}
	return int(math.Round(float64(value) / float64(target) * 100))
}

func percentChange(current, previous int) int {
	if previous <= 0 {
		if current > 0 {
			return 100
		}
		return 0
	}
	return int(math.Round((float64(current-previous) / float64(previous)) * 100))
}

func truncateString(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func todayString() string {
	return time.Now().Format("2006-01-02")
}

func isRecordNotFound(err error) bool {
	return err != nil && err == gorm.ErrRecordNotFound
}

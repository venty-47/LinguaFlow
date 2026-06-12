package handlers

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"gugudu-backend/database"
	"gugudu-backend/models"
	"gugudu-backend/services"
	"math/rand"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var translationService *services.TranslationService
var dictionaryService wordLookupService

type wordLookupService interface {
	LookupWord(word string, dictMode string) (*services.DictionaryResult, error)
}

type vocabularyExercise struct {
	VocabularyID uint     `json:"vocabulary_id"`
	Word         string   `json:"word"`
	Type         string   `json:"type"`
	Prompt       string   `json:"prompt"`
	Context      string   `json:"context,omitempty"`
	Options      []string `json:"options,omitempty"`
	AudioText    string   `json:"audio_text,omitempty"`
	Placeholder  string   `json:"placeholder,omitempty"`
}

func recordArticleStudyEvent(c *gin.Context, eventType string, articleID *uint, sourceText, resultText, contextText string, metadata map[string]any) {
	if articleID == nil || *articleID == 0 {
		return
	}
	userIDValue, exists := c.Get("user_id")
	if !exists {
		return
	}
	userID, ok := userIDValue.(uint)
	if !ok || userID == 0 {
		return
	}
	if err := services.NewArticleStudyNoteService(database.DB).RecordEvent(services.StudyEventInput{
		UserID:     userID,
		ArticleID:  *articleID,
		EventType:  eventType,
		SourceText: sourceText,
		ResultText: resultText,
		Context:    contextText,
		Metadata:   metadata,
	}); err != nil {
		fmt.Printf("记录精读笔记事件失败: %v\n", err)
	}
}

// InitTranslationService 初始化翻译服务
func InitTranslationService(baiduAppID, baiduSecret, baiduDictAPIKey, baiduDictSecretKey, youdaoAppKey, youdaoAppSecret, eliaschenDictURL, eliaschenDictProxy string) {
	translationService = services.NewTranslationService()

	fmt.Printf("初始化翻译服务...\n")
	fmt.Printf("百度翻译 AppID: %s\n", baiduAppID)
	fmt.Printf("百度词典 API Key: %s\n", baiduDictAPIKey)
	fmt.Printf("有道翻译 AppKey: %s\n", youdaoAppKey)

	// 添加百度翻译
	if baiduAppID != "" && baiduSecret != "" {
		baidu := services.NewBaiduTranslator(baiduAppID, baiduSecret)
		translationService.AddProvider(baidu)
		fmt.Println("✓ 百度翻译已初始化")
	}

	// 优先使用 Eliaschen 词典（免费、数据丰富）
	if eliaschenDictURL != "" {
		dictionaryService = services.NewEliaschenDictionaryService(eliaschenDictURL, eliaschenDictProxy)
		fmt.Printf("✓ Eliaschen 词典已初始化")
		if eliaschenDictProxy != "" {
			fmt.Printf("（代理：%s）", eliaschenDictProxy)
		}
		fmt.Println()
	}

	// 其次使用百度智能云文本翻译-词典版
	if dictionaryService == nil && baiduDictAPIKey != "" && baiduDictSecretKey != "" {
		dictionaryService = services.NewBaiduDictionaryService(baiduDictAPIKey, baiduDictSecretKey)
		fmt.Println("✓ 百度词典版已初始化")
	}

	// 添加有道翻译
	if youdaoAppKey != "" && youdaoAppSecret != "" {
		youdao := services.NewYoudaoTranslator(youdaoAppKey, youdaoAppSecret)
		translationService.AddProvider(youdao)
		fmt.Println("✓ 有道翻译已初始化")

		if dictionaryService == nil {
			dictionaryService = services.NewYoudaoDictionaryService(youdaoAppKey, youdaoAppSecret)
			fmt.Println("✓ 有道词典已初始化")
		}
	} else {
		fmt.Println("✗ 有道词典未配置")
	}

	if dictionaryService == nil {
		fmt.Println("✗ 词典服务未配置")
	}
}

func LinkTranslationToVideoLearning() {
	if videoLearningService != nil && translationService != nil {
		videoLearningService.SetTranslationService(translationService)
		fmt.Println("✓ 翻译服务已连接到视频学习模块")
	}
}

// TranslateRequest 翻译请求
type TranslateRequest struct {
	Text       string `json:"text" binding:"required"`
	TargetLang string `json:"target_lang" binding:"required"` // zh, en
	SourceLang string `json:"source_lang"`
	ArticleID  *uint  `json:"article_id"`
	Context    string `json:"context"`
}

// TranslateResponse 翻译响应
type TranslateResponse struct {
	SourceText  string `json:"source_text"`
	Translation string `json:"translation"`
	TargetLang  string `json:"target_lang"`
	Provider    string `json:"provider"`
	Cached      bool   `json:"cached"`
}

// Translate 翻译文本（支持划词翻译、段落翻译）
func Translate(c *gin.Context) {
	var req TranslateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 生成缓存 key
	cacheKey := generateCacheKey(req.Text, req.TargetLang)

	// 先查询 Redis 缓存
	ctx := context.Background()
	cachedResult, err := database.RDB.Get(ctx, cacheKey).Result()
	if err == nil && cachedResult != "" {
		recordArticleStudyEvent(c, services.StudyEventTranslation, req.ArticleID, req.Text, cachedResult, req.Context, map[string]any{
			"target_lang": req.TargetLang,
			"provider":    "cache",
			"cached":      true,
		})
		c.JSON(http.StatusOK, TranslateResponse{
			SourceText:  req.Text,
			Translation: cachedResult,
			TargetLang:  req.TargetLang,
			Provider:    "cache",
			Cached:      true,
		})
		return
	}

	// 查询数据库缓存
	var cache models.TranslationCache
	if err := database.DB.Where("source_text = ? AND target_lang = ?", req.Text, req.TargetLang).
		First(&cache).Error; err == nil {
		// 写入 Redis 缓存
		database.RDB.Set(ctx, cacheKey, cache.Translation, 24*time.Hour)

		recordArticleStudyEvent(c, services.StudyEventTranslation, req.ArticleID, req.Text, cache.Translation, req.Context, map[string]any{
			"target_lang": req.TargetLang,
			"provider":    cache.Provider,
			"cached":      true,
		})
		c.JSON(http.StatusOK, TranslateResponse{
			SourceText:  req.Text,
			Translation: cache.Translation,
			TargetLang:  req.TargetLang,
			Provider:    cache.Provider,
			Cached:      true,
		})
		return
	}

	translation := ""
	provider := "mock"

	if translationService != nil {
		if result, providerName, err := translationService.Translate(req.Text, req.SourceLang, req.TargetLang); err == nil {
			translation = result
			provider = providerName
		}
	}

	if translation == "" {
		translation = mockTranslate(req.Text, req.TargetLang)
	}

	// 保存到数据库
	newCache := models.TranslationCache{
		SourceText:  req.Text,
		TargetLang:  req.TargetLang,
		Translation: translation,
		Provider:    provider,
	}
	database.DB.Create(&newCache)

	// 写入 Redis 缓存
	database.RDB.Set(ctx, cacheKey, translation, 24*time.Hour)

	recordArticleStudyEvent(c, services.StudyEventTranslation, req.ArticleID, req.Text, translation, req.Context, map[string]any{
		"target_lang": req.TargetLang,
		"provider":    provider,
		"cached":      false,
	})

	c.JSON(http.StatusOK, TranslateResponse{
		SourceText:  req.Text,
		Translation: translation,
		TargetLang:  req.TargetLang,
		Provider:    provider,
		Cached:      false,
	})
}

// LookupWord 查词（获取单词详细释义）
func LookupWord(c *gin.Context) {
	word := normalizeLookupWord(c.Query("word"))
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Word parameter required"})
		return
	}

	dictMode := c.Query("dict_mode")
	if dictMode == "" {
		dictMode = "en-cn"
	}

	articleID := parseOptionalUintPointer(c.Query("article_id"))
	contextText := strings.TrimSpace(c.Query("context"))

	if result, ok := getDictionaryCache(word, dictMode); ok {
		recordArticleStudyEvent(c, services.StudyEventDictionary, articleID, word, result.Translation, contextText, map[string]any{
			"provider": "cache",
			"cached":   true,
		})
		c.JSON(http.StatusOK, gin.H{"data": result})
		return
	}

	// 如果配置了词典服务，使用真实的词典服务
	if dictionaryService != nil {
		result, err := dictionaryService.LookupWord(word, dictMode)
		if err == nil && result.Error == "" {
			saveDictionaryCache(word, "dictionary", dictMode, result)
			recordArticleStudyEvent(c, services.StudyEventDictionary, articleID, word, result.Translation, contextText, map[string]any{
				"provider": "dictionary",
				"cached":   false,
			})
			c.JSON(http.StatusOK, gin.H{"data": result})
			return
		}
		// 如果失败，记录错误并继续
		errMsg := fmt.Sprintf("词典查询失败: %v", err)
		if result != nil && result.Error != "" {
			errMsg = fmt.Sprintf("词典查询失败: %s", result.Error)
		}
		fmt.Println(errMsg)

		// 返回错误给前端（不缓存失败结果）
		c.JSON(http.StatusOK, gin.H{
			"data": map[string]interface{}{
				"word":        word,
				"translation": "查词失败",
				"error":       errMsg,
			},
		})
		return
	}

	// 使用百度翻译作为后备方案，构建丰富的返回格式
	if translationService != nil {
		translation, provider, err := translationService.Translate(word, "en", "zh")
		if err == nil {
			// 构建模拟的详细词典结果
			result := map[string]interface{}{
				"word":        word,
				"translation": translation,
				"provider":    provider,
				"phonetic":    "", // 百度翻译不提供音标
				"uk_phonetic": "", // 需要有道词典
				"us_phonetic": "", // 需要有道词典
				"definitions": []map[string]string{
					{"definition": translation}, // 基本翻译
				},
			}
			saveDictionaryCache(word, provider, dictMode, dictionaryResultFromMap(result))
			recordArticleStudyEvent(c, services.StudyEventDictionary, articleID, word, translation, contextText, map[string]any{
				"provider": provider,
				"cached":   false,
			})
			c.JSON(http.StatusOK, gin.H{"data": result})
			return
		}
	}

	// 最后才返回模拟数据
	wordInfo := mockDictionary(word)
	saveDictionaryCache(word, "mock", dictMode, dictionaryResultFromMap(wordInfo))
	recordArticleStudyEvent(c, services.StudyEventDictionary, articleID, word, fmt.Sprint(wordInfo["translation"]), contextText, map[string]any{
		"provider": "mock",
		"cached":   false,
	})
	c.JSON(http.StatusOK, gin.H{"data": wordInfo})
}

// AddToVocabulary 添加到生词本
func AddToVocabulary(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req struct {
		Word        string `json:"word" binding:"required"`
		ArticleID   *uint  `json:"article_id"`
		Context     string `json:"context"`
		Phonetic    string `json:"phonetic"`
		Definition  string `json:"definition"`
		Translation string `json:"translation"`
		Examples    string `json:"examples"`
		Notes       string `json:"notes"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查是否已存在
	var existing models.Vocabulary
	if err := database.DB.Where("user_id = ? AND word = ?", userID, req.Word).
		First(&existing).Error; err == nil {
		if err := services.NewKnowledgeGraphService(database.DB).SyncVocabulary(userID.(uint), existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sync knowledge graph"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message": "Word already exists in vocabulary",
			"data":    existing,
		})
		return
	}

	vocab := models.Vocabulary{
		UserID:      userID.(uint),
		Word:        req.Word,
		ArticleID:   req.ArticleID,
		Context:     req.Context,
		Phonetic:    req.Phonetic,
		Definition:  req.Definition,
		Translation: req.Translation,
		Examples:    req.Examples,
		Notes:       req.Notes,
		ReviewEase:  2.5,
	}

	if err := database.DB.Create(&vocab).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add word"})
		return
	}
	if vocab.ArticleID != nil {
		recordArticleStudyEvent(c, services.StudyEventVocabulary, vocab.ArticleID, vocab.Word, vocab.Translation, vocab.Context, map[string]any{
			"vocabulary_id": vocab.ID,
		})
	}
	if err := services.NewKnowledgeGraphService(database.DB).SyncVocabulary(userID.(uint), vocab); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sync knowledge graph"})
		return
	}

	// 更新用户学习统计
	database.DB.Model(&models.User{}).Where("id = ?", userID).
		UpdateColumn("words_learned", database.DB.Raw("words_learned + 1"))

	c.JSON(http.StatusCreated, gin.H{
		"message": "Word added to vocabulary",
		"data":    vocab,
	})
}

// UpdateVocabularyNotes 更新单词笔记
func UpdateVocabularyNotes(c *gin.Context) {
	userID, _ := c.Get("user_id")
	wordID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid word id"})
		return
	}

	var req struct {
		Notes string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var vocab models.Vocabulary
	if err := database.DB.Where("id = ? AND user_id = ?", wordID, userID).First(&vocab).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Word not found"})
		return
	}

	if err := database.DB.Model(&vocab).Update("notes", req.Notes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update notes"})
		return
	}
	vocab.Notes = req.Notes

	c.JSON(http.StatusOK, gin.H{
		"message": "Notes updated",
		"data":    vocab,
	})
}

// GetVocabulary 获取生词本
func GetVocabulary(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var vocabulary []models.Vocabulary
	query := database.DB.Where("user_id = ?", userID)

	if c.Query("due") == "true" {
		now := time.Now()
		query = query.Where("is_learned = ? OR next_review_at IS NULL OR next_review_at <= ?", false, now)
	}

	if articleID := c.Query("article_id"); articleID != "" {
		query = query.Where("article_id = ?", articleID)
	}

	if c.Query("weak") == "true" {
		query = query.Where("forgotten_count > 0").
			Order("forgotten_count DESC, COALESCE(last_review, updated_at) DESC")
	} else {
		query = query.Order("COALESCE(next_review_at, created_at) ASC, created_at DESC")
	}

	if err := query.
		Find(&vocabulary).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": vocabulary})
}

// DeleteVocabulary 从生词本移除单词并清理知识图谱
func DeleteVocabulary(c *gin.Context) {
	userID, _ := c.Get("user_id")
	wordID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid word id"})
		return
	}

	var vocab models.Vocabulary
	if err := database.DB.Where("id = ? AND user_id = ?", wordID, userID).
		First(&vocab).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Word not found"})
		return
	}

	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND user_id = ?", vocab.ID, userID).Delete(&models.Vocabulary{}).Error; err != nil {
			return err
		}
		return services.NewKnowledgeGraphService(tx).RemoveVocabularyGraph(userID.(uint), vocab.ID)
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete word"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Word deleted"})
}

// GetVocabularyKnowledgeGraph 获取单个生词的局部知识图谱
func GetVocabularyKnowledgeGraph(c *gin.Context) {
	userID, _ := c.Get("user_id")
	wordID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid word id"})
		return
	}

	var vocab models.Vocabulary
	if err := database.DB.
		Preload("Article.Category").
		Where("id = ? AND user_id = ?", wordID, userID).
		First(&vocab).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Word not found"})
		return
	}

	graphService := services.NewKnowledgeGraphService(database.DB)
	if err := graphService.SyncVocabulary(userID.(uint), vocab); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sync knowledge graph"})
		return
	}

	graph, err := graphService.GetGraph(userID.(uint), services.KnowledgeGraphQuery{
		FocusType: services.KnowledgeNodeWord,
		FocusID:   vocab.ID,
		Depth:     2,
		Limit:     120,
	})
	if err != nil {
		if errors.Is(err, services.ErrKnowledgeGraphFocusNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Knowledge graph focus not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build knowledge graph"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": graph})
}

// GetKnowledgeGraphOverview 获取用户完整学习图谱概览
func GetKnowledgeGraphOverview(c *gin.Context) {
	userID, _ := c.Get("user_id")

	overview, err := services.NewKnowledgeGraphService(database.DB).GetOverview(userID.(uint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load knowledge graph overview"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": overview})
}

// RefreshKnowledgeGraph 手动刷新用户完整学习图谱
func RefreshKnowledgeGraph(c *gin.Context) {
	userID, _ := c.Get("user_id")

	graphService := services.NewKnowledgeGraphService(database.DB)
	if err := graphService.RefreshUserGraph(userID.(uint)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh knowledge graph"})
		return
	}

	overview, err := graphService.GetOverview(userID.(uint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load knowledge graph overview"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Knowledge graph refreshed", "data": overview})
}

// GetKnowledgeGraph 获取用户学习图谱
func GetKnowledgeGraph(c *gin.Context) {
	userID, _ := c.Get("user_id")

	depth := parseBoundedInt(c.DefaultQuery("depth", "2"), 1, 3, 2)
	limit := parseBoundedInt(c.DefaultQuery("limit", "160"), 20, 240, 160)
	focusID := parseOptionalUint(c.Query("focus_id"))

	query := services.KnowledgeGraphQuery{
		FocusType: strings.TrimSpace(c.Query("focus_type")),
		FocusID:   focusID,
		FocusKey:  strings.TrimSpace(c.Query("focus_key")),
		Depth:     depth,
		Limit:     limit,
		Search:    strings.TrimSpace(c.Query("search")),
		Types:     splitQueryCSV(c.Query("types")),
	}

	graph, err := services.NewKnowledgeGraphService(database.DB).GetGraph(userID.(uint), query)
	if err != nil {
		if errors.Is(err, services.ErrKnowledgeGraphFocusNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Knowledge graph focus not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load knowledge graph"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": graph})
}

// generateCacheKey 生成缓存 key
func generateCacheKey(text, targetLang string) string {
	hash := md5.Sum([]byte(text + ":" + targetLang))
	return "translate:" + hex.EncodeToString(hash[:])
}

// mockDictionary 模拟词典查询
func mockDictionary(word string) map[string]interface{} {
	// 实际应该调用词典 API
	return map[string]interface{}{
		"word":     word,
		"phonetic": "/wɜːrd/",
		"definitions": []map[string]interface{}{
			{
				"pos":        "noun",
				"definition": "A single unit of language",
				"example":    "He wrote a short word.",
			},
		},
		"translation": "单词；词",
		"examples": []string{
			"The word is on the tip of my tongue.",
		},
	}
}

func mockTranslate(text, targetLang string) string {
	dictionary := map[string]string{
		"data":         "数据",
		"energy":       "能源",
		"business":     "商业",
		"artificial":   "人工的",
		"intelligence": "智能",
		"technology":   "技术",
		"health":       "健康",
		"climate":      "气候",
		"power":        "电力；力量",
		"companies":    "公司",
		"customers":    "客户",
		"workers":      "工人；从业者",
		"outbreak":     "疫情暴发",
		"brain":        "大脑",
		"computer":     "计算机",
		"interface":    "接口",
	}

	if targetLang != "zh" {
		return text
	}

	if translation, ok := dictionary[text]; ok {
		return translation
	}

	return "模拟翻译：" + text
}

// MarkWordLearned 标记单词已掌握
func MarkWordLearned(c *gin.Context) {
	userID, _ := c.Get("user_id")
	wordID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid word id"})
		return
	}

	var vocab models.Vocabulary
	if err := database.DB.Where("id = ? AND user_id = ?", wordID, userID).
		First(&vocab).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Word not found"})
		return
	}

	vocab.IsLearned = true
	now := time.Now()
	vocab.LastReview = &now
	vocab.NextReviewAt = nil

	if err := database.DB.Save(&vocab).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update word"})
		return
	}
	if err := services.NewKnowledgeGraphService(database.DB).SyncVocabulary(userID.(uint), vocab); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sync knowledge graph"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Word marked as learned",
		"data":    vocab,
	})
}

func applyVocabularyReview(vocab *models.Vocabulary, rating string) error {
	now := time.Now()
	ease := vocab.ReviewEase
	if ease <= 0 {
		ease = 2.5
	}
	interval := vocab.ReviewInterval

	switch rating {
	case "forgot":
		interval = 1
		ease -= 0.2
		vocab.IsLearned = false
		vocab.ForgottenCount++
	case "hard":
		if interval < 1 {
			interval = 1
		} else {
			interval = maxInt(1, int(float64(interval)*1.4))
		}
		ease -= 0.05
		vocab.IsLearned = false
	case "good":
		if interval < 1 {
			interval = 2
		} else {
			interval = maxInt(interval+1, int(float64(interval)*ease))
		}
		ease += 0.05
		vocab.IsLearned = vocab.ReviewCount >= 2 || interval >= 7
	default:
		return fmt.Errorf("rating must be forgot, hard, or good")
	}

	if ease < 1.3 {
		ease = 1.3
	}
	nextReview := now.AddDate(0, 0, interval)
	vocab.ReviewCount++
	vocab.ReviewInterval = interval
	vocab.ReviewEase = ease
	vocab.LastReview = &now
	vocab.NextReviewAt = &nextReview
	return nil
}

// ReviewVocabulary 提交一次复习结果
func ReviewVocabulary(c *gin.Context) {
	userID, _ := c.Get("user_id")
	wordID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid word id"})
		return
	}

	var req struct {
		Rating string `json:"rating" binding:"required"` // forgot, hard, good
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var vocab models.Vocabulary
	if err := database.DB.Where("id = ? AND user_id = ?", wordID, userID).
		First(&vocab).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Word not found"})
		return
	}

	if err := applyVocabularyReview(&vocab, req.Rating); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := database.DB.Save(&vocab).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to review word"})
		return
	}
	if err := services.NewKnowledgeGraphService(database.DB).SyncVocabulary(userID.(uint), vocab); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sync knowledge graph"})
		return
	}

	addStudyReviewedWord(userID.(uint))

	c.JSON(http.StatusOK, gin.H{"message": "Review saved", "data": vocab})
}

// GetVocabularyReviewExercises 生成客观复习题
func GetVocabularyReviewExercises(c *gin.Context) {
	userID, _ := c.Get("user_id")

	limit := 20
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	var vocabulary []models.Vocabulary
	query := database.DB.Where("user_id = ?", userID)
	if c.Query("due") != "false" {
		now := time.Now()
		query = query.Where("is_learned = ? OR next_review_at IS NULL OR next_review_at <= ?", false, now)
	}
	if c.Query("weak") == "true" {
		query = query.Where("forgotten_count > 0")
	}

	if err := query.
		Order("COALESCE(next_review_at, created_at) ASC, forgotten_count DESC, created_at DESC").
		Limit(limit).
		Find(&vocabulary).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	exercises := make([]vocabularyExercise, 0, len(vocabulary))
	allVocabulary := make([]models.Vocabulary, 0, maxInt(len(vocabulary), 4))
	if len(vocabulary) > 0 {
		database.DB.Where("user_id = ?", userID).
			Order("RANDOM()").
			Limit(80).
			Find(&allVocabulary)
	}
	for index, vocab := range vocabulary {
		exercises = append(exercises, buildVocabularyExercise(vocab, allVocabulary, index))
	}

	c.JSON(http.StatusOK, gin.H{"data": exercises})
}

// SubmitVocabularyReviewAnswer 提交客观题答案并更新间隔复习
func SubmitVocabularyReviewAnswer(c *gin.Context) {
	userID, _ := c.Get("user_id")
	wordID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid word id"})
		return
	}

	var req struct {
		Type   string `json:"type" binding:"required"`
		Answer string `json:"answer" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var vocab models.Vocabulary
	if err := database.DB.Where("id = ? AND user_id = ?", wordID, userID).
		First(&vocab).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Word not found"})
		return
	}

	correctAnswer := expectedVocabularyAnswer(vocab, req.Type)
	if correctAnswer == "" {
		correctAnswer = vocab.Word
	}
	isCorrect := isVocabularyAnswerCorrect(req.Answer, correctAnswer, req.Type)
	rating := "forgot"
	if isCorrect {
		rating = "good"
	} else if req.Type == "zh_to_en_spelling" && closeSpellingAnswer(req.Answer, vocab.Word) {
		rating = "hard"
	}

	if err := applyVocabularyReview(&vocab, rating); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := database.DB.Save(&vocab).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to review word"})
		return
	}
	if err := services.NewKnowledgeGraphService(database.DB).SyncVocabulary(userID.(uint), vocab); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sync knowledge graph"})
		return
	}

	addStudyReviewedWord(userID.(uint))

	c.JSON(http.StatusOK, gin.H{
		"message":        "Review answer saved",
		"data":           vocab,
		"correct":        isCorrect,
		"rating":         rating,
		"correct_answer": correctAnswer,
	})
}

func getDictionaryCache(word string, dictMode string) (*services.DictionaryResult, bool) {
	// 仅缓存默认英中模式，英英模式每次都直查
	if dictMode != "en-cn" {
		return nil, false
	}

	var cache models.DictionaryCache
	if err := database.DB.Where("word = ?", word).First(&cache).Error; err != nil {
		return nil, false
	}

	// 不返回包含错误的缓存结果
	if cache.Error != "" {
		return nil, false
	}

	result := &services.DictionaryResult{
		Word:        cache.Word,
		Phonetic:    cache.Phonetic,
		UKPhonetic:  cache.UKPhonetic,
		USPhonetic:  cache.USPhonetic,
		SpeechURL:   cache.SpeechURL,
		UKSpeechURL: cache.UKSpeechURL,
		USSpeechURL: cache.USSpeechURL,
		Translation: cache.Translation,
		Error:       cache.Error,
	}
	_ = json.Unmarshal([]byte(cache.Definitions), &result.Definitions)
	_ = json.Unmarshal([]byte(cache.WebMeanings), &result.WebMeanings)
	ensureDictionarySpeechURLs(result)
	return result, true
}

func saveDictionaryCache(word, provider, dictMode string, result *services.DictionaryResult) {
	if result == nil || word == "" {
		return
	}
	// 仅缓存默认英中模式
	if dictMode != "en-cn" {
		return
	}
	// 不缓存包含错误的结果
	if result.Error != "" {
		return
	}
	ensureDictionarySpeechURLs(result)

	definitions, _ := json.Marshal(result.Definitions)
	webMeanings, _ := json.Marshal(result.WebMeanings)
	cache := models.DictionaryCache{
		Word:        word,
		Provider:    provider,
		Phonetic:    result.Phonetic,
		UKPhonetic:  result.UKPhonetic,
		USPhonetic:  result.USPhonetic,
		SpeechURL:   result.SpeechURL,
		UKSpeechURL: result.UKSpeechURL,
		USSpeechURL: result.USSpeechURL,
		Translation: result.Translation,
		Definitions: string(definitions),
		WebMeanings: string(webMeanings),
		Error:       result.Error,
	}

	var existing models.DictionaryCache
	if err := database.DB.Where("word = ?", word).First(&existing).Error; err == nil {
		cache.ID = existing.ID
		cache.CreatedAt = existing.CreatedAt
		database.DB.Save(&cache)
		return
	}
	database.DB.Create(&cache)
}

func ensureDictionarySpeechURLs(result *services.DictionaryResult) {
	if result == nil || result.Word == "" {
		return
	}
	if result.UKSpeechURL == "" {
		result.UKSpeechURL = services.DictionaryVoiceURL(result.Word, "1")
	}
	if result.USSpeechURL == "" {
		result.USSpeechURL = services.DictionaryVoiceURL(result.Word, "2")
	}
	if result.SpeechURL == "" {
		result.SpeechURL = result.USSpeechURL
	}
}

func dictionaryResultFromMap(data map[string]interface{}) *services.DictionaryResult {
	result := &services.DictionaryResult{}
	if value, ok := data["word"].(string); ok {
		result.Word = value
	}
	if value, ok := data["phonetic"].(string); ok {
		result.Phonetic = value
	}
	if value, ok := data["translation"].(string); ok {
		result.Translation = value
	}
	if values, ok := data["definitions"].([]map[string]string); ok {
		for _, item := range values {
			result.Definitions = append(result.Definitions, services.DefinitionItem{
				Pos:        item["pos"],
				Definition: item["definition"],
			})
		}
	}
	return result
}

func buildVocabularyExercise(vocab models.Vocabulary, allVocabulary []models.Vocabulary, index int) vocabularyExercise {
	exerciseType := chooseVocabularyExerciseType(vocab, index)
	exercise := vocabularyExercise{
		VocabularyID: vocab.ID,
		Word:         vocab.Word,
		Type:         exerciseType,
	}

	switch exerciseType {
	case "en_to_zh_choice":
		exercise.Prompt = "选择这个英文单词最贴近的中文释义"
		exercise.Options = buildTranslationOptions(vocab, allVocabulary)
	case "zh_to_en_spelling":
		exercise.Prompt = firstMeaning(vocab.Translation)
		if exercise.Prompt == "" {
			exercise.Prompt = "根据释义拼写英文单词"
		}
	case "context_fill_blank":
		exercise.Prompt = "根据原文语境补全空缺单词"
		exercise.Context = blankVocabularyContext(vocab.Context, vocab.Word)
		exercise.Placeholder = strings.Repeat("_", maxInt(4, len([]rune(vocab.Word))))
	case "audio_word_choice":
		exercise.Prompt = "听发音，选择对应的单词"
		exercise.AudioText = vocab.Word
		exercise.Options = buildWordOptions(vocab, allVocabulary)
	case "sentence_meaning_choice":
		exercise.Prompt = "结合例句，选择单词在句中的含义"
		exercise.Context = firstExample(vocab)
		exercise.Options = buildTranslationOptions(vocab, allVocabulary)
	default:
		exercise.Type = "en_to_zh_choice"
		exercise.Prompt = "选择这个英文单词最贴近的中文释义"
		exercise.Options = buildTranslationOptions(vocab, allVocabulary)
	}

	return exercise
}

func chooseVocabularyExerciseType(vocab models.Vocabulary, index int) string {
	candidates := []string{"en_to_zh_choice", "zh_to_en_spelling", "audio_word_choice"}
	if strings.TrimSpace(vocab.Context) != "" && containsWord(vocab.Context, vocab.Word) {
		candidates = append(candidates, "context_fill_blank")
	}
	if firstExample(vocab) != "" {
		candidates = append(candidates, "sentence_meaning_choice")
	}
	return candidates[index%len(candidates)]
}

func buildTranslationOptions(vocab models.Vocabulary, allVocabulary []models.Vocabulary) []string {
	correct := firstMeaning(vocab.Translation)
	if correct == "" {
		correct = firstMeaning(vocab.Definition)
	}
	if correct == "" {
		correct = vocab.Word
	}

	options := []string{correct}
	seen := map[string]bool{normalizeChoice(correct): true}
	for _, item := range allVocabulary {
		if item.ID == vocab.ID {
			continue
		}
		option := firstMeaning(item.Translation)
		if option == "" {
			option = firstMeaning(item.Definition)
		}
		key := normalizeChoice(option)
		if key == "" || seen[key] {
			continue
		}
		options = append(options, option)
		seen[key] = true
		if len(options) >= 4 {
			break
		}
	}

	fallbacks := []string{"事实；信息", "方法；途径", "变化；转变", "结果；影响", "能力；技能"}
	for _, fallback := range fallbacks {
		key := normalizeChoice(fallback)
		if !seen[key] {
			options = append(options, fallback)
			seen[key] = true
		}
		if len(options) >= 4 {
			break
		}
	}

	shuffleStable(options, vocab.ID)
	return options
}

func buildWordOptions(vocab models.Vocabulary, allVocabulary []models.Vocabulary) []string {
	options := []string{vocab.Word}
	seen := map[string]bool{normalizeLookupWord(vocab.Word): true}
	for _, item := range allVocabulary {
		key := normalizeLookupWord(item.Word)
		if key == "" || seen[key] {
			continue
		}
		options = append(options, item.Word)
		seen[key] = true
		if len(options) >= 4 {
			break
		}
	}

	fallbacks := []string{"article", "context", "meaning", "practice", "review"}
	for _, fallback := range fallbacks {
		key := normalizeLookupWord(fallback)
		if !seen[key] {
			options = append(options, fallback)
			seen[key] = true
		}
		if len(options) >= 4 {
			break
		}
	}

	shuffleStable(options, vocab.ID+17)
	return options
}

func expectedVocabularyAnswer(vocab models.Vocabulary, exerciseType string) string {
	switch exerciseType {
	case "en_to_zh_choice", "sentence_meaning_choice":
		answer := firstMeaning(vocab.Translation)
		if answer == "" {
			answer = firstMeaning(vocab.Definition)
		}
		return answer
	case "zh_to_en_spelling", "context_fill_blank", "audio_word_choice":
		return vocab.Word
	default:
		return vocab.Word
	}
}

func isVocabularyAnswerCorrect(answer, expected, exerciseType string) bool {
	answer = normalizeAnswer(answer)
	expected = normalizeAnswer(expected)
	if answer == "" || expected == "" {
		return false
	}
	if exerciseType == "en_to_zh_choice" || exerciseType == "sentence_meaning_choice" {
		return answer == expected
	}
	return normalizeLookupWord(answer) == normalizeLookupWord(expected)
}

func closeSpellingAnswer(answer, expected string) bool {
	answer = normalizeLookupWord(answer)
	expected = normalizeLookupWord(expected)
	if answer == "" || expected == "" {
		return false
	}
	if strings.HasPrefix(expected, answer) && len([]rune(expected))-len([]rune(answer)) <= 2 {
		return true
	}
	return levenshteinDistance(answer, expected) <= 1
}

func firstMeaning(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	var values []string
	if err := json.Unmarshal([]byte(value), &values); err == nil && len(values) > 0 {
		return strings.TrimSpace(values[0])
	}

	var definitionItems []services.DefinitionItem
	if err := json.Unmarshal([]byte(value), &definitionItems); err == nil && len(definitionItems) > 0 {
		if definitionItems[0].Definition != "" {
			return strings.TrimSpace(definitionItems[0].Definition)
		}
	}

	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == '\n' || r == ';' || r == '；' || r == '。'
	})
	if len(parts) == 0 {
		return value
	}
	return strings.TrimSpace(parts[0])
}

func firstExample(vocab models.Vocabulary) string {
	value := strings.TrimSpace(vocab.Examples)
	if value == "" {
		return ""
	}
	var examples []string
	if err := json.Unmarshal([]byte(value), &examples); err == nil {
		for _, example := range examples {
			if strings.TrimSpace(example) != "" {
				return strings.TrimSpace(example)
			}
		}
	}
	var items []map[string]string
	if err := json.Unmarshal([]byte(value), &items); err == nil {
		for _, item := range items {
			if strings.TrimSpace(item["example"]) != "" {
				return strings.TrimSpace(item["example"])
			}
		}
	}
	return value
}

func blankVocabularyContext(contextText, word string) string {
	contextText = strings.TrimSpace(contextText)
	if contextText == "" {
		return ""
	}
	pattern := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(word) + `\b`)
	return pattern.ReplaceAllString(contextText, "____")
}

func containsWord(text, word string) bool {
	pattern := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(word) + `\b`)
	return pattern.MatchString(text)
}

func normalizeChoice(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeAnswer(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	value = strings.Trim(value, " \t\r\n.,;:!?\"'()[]{}")
	return value
}

func shuffleStable(values []string, seed uint) {
	random := rand.New(rand.NewSource(int64(seed)))
	random.Shuffle(len(values), func(i, j int) {
		values[i], values[j] = values[j], values[i]
	})
}

func levenshteinDistance(a, b string) int {
	ar := []rune(a)
	br := []rune(b)
	dist := make([][]int, len(ar)+1)
	for i := range dist {
		dist[i] = make([]int, len(br)+1)
		dist[i][0] = i
	}
	for j := 0; j <= len(br); j++ {
		dist[0][j] = j
	}
	for i := 1; i <= len(ar); i++ {
		for j := 1; j <= len(br); j++ {
			cost := 0
			if ar[i-1] != br[j-1] {
				cost = 1
			}
			dist[i][j] = minVocabularyInt(
				dist[i-1][j]+1,
				minVocabularyInt(dist[i][j-1]+1, dist[i-1][j-1]+cost),
			)
		}
	}
	return dist[len(ar)][len(br)]
}

func normalizeLookupWord(word string) string {
	word = strings.TrimSpace(strings.ToLower(word))
	word = strings.Trim(word, " \t\r\n.,;:!?\"'()[]{}")
	return word
}

func parseBoundedInt(value string, minValue, maxValue, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	if parsed < minValue {
		return minValue
	}
	if parsed > maxValue {
		return maxValue
	}
	return parsed
}

func parseOptionalUint(value string) uint {
	parsed, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0
	}
	return uint(parsed)
}

func parseOptionalUintPointer(value string) *uint {
	parsed := parseOptionalUint(value)
	if parsed == 0 {
		return nil
	}
	return &parsed
}

func parsePathUint(c *gin.Context, name string) (uint, bool) {
	parsed, err := strconv.ParseUint(strings.TrimSpace(c.Param(name)), 10, 64)
	if err != nil || parsed == 0 {
		return 0, false
	}
	return uint(parsed), true
}

func splitQueryCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func minVocabularyInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

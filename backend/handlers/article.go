package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"gugudu-backend/database"
	"gugudu-backend/models"
	"gugudu-backend/services"
	"math"
	"math/rand"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var aiAnalysisService *services.AIAnalysisService

// InitAIAnalysisService 初始化 AI 精读服务
func InitAIAnalysisService(enabled bool, baseURL, apiKey, model string, timeoutSeconds int) {
	if !enabled {
		aiAnalysisService = nil
		return
	}

	aiAnalysisService = services.NewAIAnalysisService(baseURL, apiKey, model, timeoutSeconds)
	if aiAnalysisService.IsConfigured() {
		fmt.Printf("✓ AI 精读已初始化: %s\n", model)
	} else {
		fmt.Println("✗ AI 精读配置不完整")
	}
}

func GetAIAnalysisService() *services.AIAnalysisService {
	return aiAnalysisService
}

// GetArticles 获取文章列表
func GetArticles(c *gin.Context) {
	var articles []models.Article

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	categorySlug := c.Query("category")
	difficulty := c.Query("difficulty")
	source := strings.TrimSpace(c.Query("source"))
	search := c.Query("search")

	offset := (page - 1) * pageSize

	query := database.DB.Model(&models.Article{}).
		Preload("Category").
		Where("status = ?", "published")

	if categorySlug != "" {
		query = query.Joins("JOIN categories ON categories.id = articles.category_id").
			Where("categories.slug = ?", categorySlug)
	}

	if difficulty != "" {
		query = query.Where("difficulty_level = ?", difficulty)
	}

	if source != "" {
		query = query.Where("source = ?", source)
	}

	if search != "" {
		query = query.Where("title ILIKE ? OR summary ILIKE ?", "%"+search+"%", "%"+search+"%")
	}

	var total int64
	query.Count(&total)

	if err := query.Order("published_at DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&articles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": articles,
		"pagination": gin.H{
			"page":       page,
			"page_size":  pageSize,
			"total":      total,
			"total_page": (total + int64(pageSize) - 1) / int64(pageSize),
		},
	})
}

// GetArticleBySlug 根据 slug 获取文章详情
func GetArticleBySlug(c *gin.Context) {
	slug := c.Param("slug")

	var article models.Article
	if err := database.DB.Preload("Category").
		Where("slug = ? AND status = ?", slug, "published").
		First(&article).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
		return
	}

	// 增加浏览量
	database.DB.Model(&article).Update("view_count", article.ViewCount+1)

	// 如果用户已登录，记录阅读历史
	if userID, exists := c.Get("user_id"); exists {
		var history models.ReadHistory
		database.DB.Where("user_id = ? AND article_id = ?", userID, article.ID).
			FirstOrCreate(&history, models.ReadHistory{
				UserID:    userID.(uint),
				ArticleID: article.ID,
			})

		history.LastReadAt = time.Now()
		database.DB.Save(&history)
	}

	c.JSON(http.StatusOK, gin.H{"data": article})
}

// GetFeaturedArticles 获取精选文章
func GetFeaturedArticles(c *gin.Context) {
	var articles []models.Article

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "6"))

	if err := database.DB.Preload("Category").
		Where("status = ? AND is_featured = ?", "published", true).
		Order("published_at DESC").
		Limit(limit).
		Find(&articles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": articles})
}

// GetCategories 获取分类列表
func GetCategories(c *gin.Context) {
	var categories []models.Category

	if err := database.DB.Order("sort_order ASC, name ASC").Find(&categories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": categories})
}

// UpdateReadProgress 更新阅读进度
func UpdateReadProgress(c *gin.Context) {
	userID, _ := c.Get("user_id")
	articleID, _ := strconv.Atoi(c.Param("id"))

	var req struct {
		Progress float64 `json:"progress" binding:"required,min=0,max=100"`
		ReadTime int     `json:"read_time"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.ReadTime < 0 {
		req.ReadTime = 0
	}
	if req.ReadTime > 300 {
		req.ReadTime = 300
	}

	var history models.ReadHistory
	database.DB.Where("user_id = ? AND article_id = ?", userID, articleID).
		FirstOrCreate(&history, models.ReadHistory{
			UserID:    userID.(uint),
			ArticleID: uint(articleID),
		})

	wasCompleted := history.IsCompleted
	history.ReadProgress = req.Progress
	history.ReadTime += req.ReadTime
	history.LastReadAt = time.Now()

	if req.Progress >= 100 {
		history.IsCompleted = true
	}

	if err := database.DB.Save(&history).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.ReadTime > 0 {
		addedMinutes := (req.ReadTime + 59) / 60
		database.DB.Model(&models.User{}).Where("id = ?", userID).
			UpdateColumn("total_read_time", database.DB.Raw("total_read_time + ?", addedMinutes))
	}

	if history.IsCompleted && !wasCompleted {
		database.DB.Model(&models.User{}).Where("id = ?", userID).
			UpdateColumn("articles_read", database.DB.Raw("articles_read + 1"))
	}

	addStudyReadTime(userID.(uint), req.ReadTime, history.IsCompleted && !wasCompleted)

	c.JSON(http.StatusOK, gin.H{"message": "Progress updated", "data": history})
}

// GetArticleCompletion 获取文章阅读完成摘要
func GetArticleCompletion(c *gin.Context) {
	userID, _ := c.Get("user_id")
	articleID, _ := strconv.Atoi(c.Param("id"))

	var article models.Article
	if err := database.DB.Preload("Category").
		Where("id = ?", articleID).
		First(&article).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
		return
	}

	var history models.ReadHistory
	database.DB.Where("user_id = ? AND article_id = ?", userID, articleID).First(&history)

	var words []models.Vocabulary
	if err := database.DB.Where("user_id = ? AND article_id = ?", userID, articleID).
		Order("created_at DESC").
		Find(&words).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	learnedCount := 0
	dueCount := 0
	now := time.Now()
	for _, word := range words {
		if word.IsLearned {
			learnedCount++
		}
		if !word.IsLearned || word.NextReviewAt == nil || !word.NextReviewAt.After(now) {
			dueCount++
		}
	}

	nextArticle := models.Article{}
	database.DB.Preload("Category").
		Where("status = ? AND id <> ? AND difficulty_level = ?", "published", article.ID, article.DifficultyLevel).
		Order("published_at DESC").
		First(&nextArticle)

	var studyNote *services.ArticleStudyNoteResponse
	var aiDraft *services.ArticleStudyNoteResponse
	if aiAnalysisService != nil && aiAnalysisService.IsConfigured() {
		if draft, err := buildAIStudyNoteDraft(userID.(uint), article.ID); err == nil {
			aiDraft = draft
		} else {
			fmt.Printf("AI 精读笔记生成失败，回退规则生成: %v\n", err)
		}
	}
	if note, err := services.NewArticleStudyNoteService(database.DB).GenerateNoteWithDraft(userID.(uint), article.ID, false, aiDraft); err == nil {
		studyNote = note
	} else {
		fmt.Printf("生成精读笔记失败: %v\n", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"article": article,
			"history": history,
			"stats": gin.H{
				"read_time":        history.ReadTime,
				"read_progress":    history.ReadProgress,
				"is_completed":     history.IsCompleted,
				"new_words":        len(words),
				"learned_words":    learnedCount,
				"due_review_words": dueCount,
			},
			"words":        words,
			"study_note":   studyNote,
			"next_article": nextArticle,
		},
	})
}

// GetArticleStudyNote 获取用户文章精读笔记
func GetArticleStudyNote(c *gin.Context) {
	userID, _ := c.Get("user_id")
	articleID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid article id"})
		return
	}

	note, err := services.NewArticleStudyNoteService(database.DB).GetNote(userID.(uint), articleID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Study note not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load study note"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": note})
}

// GenerateArticleStudyNote 生成或刷新用户文章精读笔记
func GenerateArticleStudyNote(c *gin.Context) {
	userID, _ := c.Get("user_id")
	articleID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid article id"})
		return
	}

	var req struct {
		Force bool `json:"force"`
	}
	_ = c.ShouldBindJSON(&req)

	noteService := services.NewArticleStudyNoteService(database.DB)
	var aiDraft *services.ArticleStudyNoteResponse
	if aiAnalysisService != nil && aiAnalysisService.IsConfigured() {
		if draft, err := buildAIStudyNoteDraft(userID.(uint), articleID); err == nil {
			aiDraft = draft
		} else {
			fmt.Printf("AI 精读笔记生成失败，回退规则生成: %v\n", err)
		}
	}

	note, err := noteService.GenerateNoteWithDraft(userID.(uint), articleID, req.Force, aiDraft)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate study note"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": note})
}

type aiStudyNoteEventPayload struct {
	EventType  string `json:"event_type"`
	SourceText string `json:"source_text"`
	ResultText string `json:"result_text,omitempty"`
	Context    string `json:"context,omitempty"`
}

type aiStudyNoteVocabularyPayload struct {
	Word        string `json:"word"`
	Translation string `json:"translation,omitempty"`
	Context     string `json:"context,omitempty"`
}

func buildAIStudyNoteDraft(userID, articleID uint) (*services.ArticleStudyNoteResponse, error) {
	var article models.Article
	if err := database.DB.Where("id = ? AND status = ?", articleID, "published").First(&article).Error; err != nil {
		return nil, err
	}

	var events []models.ArticleStudyEvent
	if err := database.DB.
		Where("user_id = ? AND article_id = ?", userID, articleID).
		Order("created_at ASC").
		Limit(80).
		Find(&events).Error; err != nil {
		return nil, err
	}
	eventPayload := make([]aiStudyNoteEventPayload, 0, len(events))
	for _, event := range events {
		eventPayload = append(eventPayload, aiStudyNoteEventPayload{
			EventType:  event.EventType,
			SourceText: truncateRunes(event.SourceText, 1000),
			ResultText: truncateRunes(event.ResultText, 1200),
			Context:    truncateRunes(event.Context, 800),
		})
	}

	var words []models.Vocabulary
	if err := database.DB.
		Where("user_id = ? AND article_id = ?", userID, articleID).
		Order("created_at ASC").
		Limit(80).
		Find(&words).Error; err != nil {
		return nil, err
	}
	wordPayload := make([]aiStudyNoteVocabularyPayload, 0, len(words))
	for _, word := range words {
		wordPayload = append(wordPayload, aiStudyNoteVocabularyPayload{
			Word:        word.Word,
			Translation: word.Translation,
			Context:     truncateRunes(word.Context, 800),
		})
	}

	eventsJSON, _ := json.Marshal(eventPayload)
	wordsJSON, _ := json.Marshal(wordPayload)
	return aiAnalysisService.GenerateStudyNote(services.AIStudyNoteInput{
		ArticleTitle:   article.Title,
		ArticleSummary: firstNonEmptyString(article.SummaryCN, article.Summary),
		ArticleContent: truncateRunes(article.Content, 10000),
		EventsJSON:     string(eventsJSON),
		VocabularyJSON: string(wordsJSON),
	})
}

type articleQuizRequest struct {
	QuestionTypes []string `json:"question_types"` // 默认 ["single_choice"]
	Count         int       `json:"count"`          // 每种题型数量，默认 2
}

type articleQuizQuestionResponse struct {
	ID           uint     `json:"id"`
	QuestionType string   `json:"question_type"`
	Prompt       string   `json:"prompt"`
	Options      []string `json:"options"`
	SortOrder    int      `json:"sort_order"`
	CorrectIndex *int     `json:"correct_index,omitempty"`
	Explanation  string   `json:"explanation,omitempty"`
	UserAnswer   *int     `json:"user_answer,omitempty"`
	IsCorrect    *bool    `json:"is_correct,omitempty"`
}

type articleQuizAttemptResponse struct {
	ID          uint      `json:"id"`
	Score       int       `json:"score"`
	Total       int       `json:"total"`
	Percentage  int       `json:"percentage"`
	Answers     []int     `json:"answers"`
	CompletedAt time.Time `json:"completed_at"`
}

type articleQuizResponse struct {
	ID            uint                          `json:"id"`
	ArticleID     uint                          `json:"article_id"`
	Title         string                        `json:"title"`
	Questions     []articleQuizQuestionResponse `json:"questions"`
	LatestAttempt *articleQuizAttemptResponse   `json:"latest_attempt,omitempty"`
}

type articleKnowledgeGraphNode struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`
	Label       string                 `json:"label"`
	Description string                 `json:"description,omitempty"`
	Weight      int                    `json:"weight"`
	Mastery     *int                   `json:"mastery,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

type articleKnowledgeGraphEdge struct {
	ID       string `json:"id"`
	Source   string `json:"source"`
	Target   string `json:"target"`
	Relation string `json:"relation"`
	Label    string `json:"label"`
	Weight   int    `json:"weight"`
}

type articleKnowledgeGraphLane struct {
	ID          string                      `json:"id"`
	Title       string                      `json:"title"`
	Description string                      `json:"description"`
	NodeIDs     []string                    `json:"node_ids"`
	Nodes       []articleKnowledgeGraphNode `json:"nodes"`
}

type articleKnowledgeGraphAction struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Label       string `json:"label"`
	Href        string `json:"href,omitempty"`
	FocusNodeID string `json:"focus_node_id,omitempty"`
	Priority    int    `json:"priority"`
}

type articleKnowledgeGraphResponse struct {
	Article articleKnowledgeGraphNode     `json:"article"`
	Lanes   []articleKnowledgeGraphLane   `json:"lanes"`
	Edges   []articleKnowledgeGraphEdge   `json:"edges"`
	Actions []articleKnowledgeGraphAction `json:"actions"`
	Stats   gin.H                         `json:"stats"`
}

// GetArticleKnowledgeGraph 获取单篇文章的学习知识图谱
func GetArticleKnowledgeGraph(c *gin.Context) {
	userID, _ := c.Get("user_id")
	articleID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || articleID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid article id"})
		return
	}

	var article models.Article
	if err := database.DB.Preload("Category").
		Where("id = ? AND status = ?", articleID, "published").
		First(&article).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
		return
	}

	var vocabulary []models.Vocabulary
	if err := database.DB.
		Where("user_id = ? AND article_id = ?", userID, article.ID).
		Order("forgotten_count DESC, review_count ASC, created_at DESC").
		Find(&vocabulary).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load article vocabulary"})
		return
	}

	var history models.ReadHistory
	database.DB.Where("user_id = ? AND article_id = ?", userID, article.ID).First(&history)

	c.JSON(http.StatusOK, gin.H{"data": buildArticleKnowledgeGraph(article, vocabulary, history)})
}

func buildArticleKnowledgeGraph(article models.Article, vocabulary []models.Vocabulary, history models.ReadHistory) articleKnowledgeGraphResponse {
	paragraphs := splitArticleParagraphs(article.Content)
	articleNode := articleKnowledgeGraphNode{
		ID:          fmt.Sprintf("article:%d", article.ID),
		Type:        "article",
		Label:       article.Title,
		Description: firstNonEmptyString(article.SummaryCN, article.Summary, article.Category.Name),
		Weight:      100,
		Metadata: map[string]interface{}{
			"article_id":        article.ID,
			"slug":              article.Slug,
			"difficulty_level":  article.DifficultyLevel,
			"cefr_level":        article.CEFRLevel,
			"word_count":        article.WordCount,
			"reading_time":      article.ReadingTime,
			"read_progress":     history.ReadProgress,
			"completed":         history.IsCompleted,
			"paragraph_count":   len(paragraphs),
			"highlighted_words": len(vocabulary),
		},
	}

	nodes := []articleKnowledgeGraphNode{articleNode}
	edges := make([]articleKnowledgeGraphEdge, 0)
	laneMap := map[string][]articleKnowledgeGraphNode{
		"structure":  {},
		"vocabulary": {},
		"grammar":    {},
		"sentences":  {},
		"review":     {},
	}

	addNode := func(lane string, node articleKnowledgeGraphNode, relation, label string, weight int) {
		nodes = append(nodes, node)
		laneMap[lane] = append(laneMap[lane], node)
		edges = append(edges, articleKnowledgeGraphEdge{
			ID:       fmt.Sprintf("edge:%s:%s", articleNode.ID, node.ID),
			Source:   articleNode.ID,
			Target:   node.ID,
			Relation: relation,
			Label:    label,
			Weight:   weight,
		})
	}

	for index, value := range articleKnowledgeTopics(article) {
		node := articleKnowledgeGraphNode{
			ID:          fmt.Sprintf("topic:%d:%s", article.ID, normalizeKnowledgeID(value)),
			Type:        "topic",
			Label:       value,
			Description: "文章主题和阅读方向",
			Weight:      72 - index*3,
		}
		addNode("structure", node, "has_topic", "主题", 70)
	}

	for index, paragraph := range paragraphs {
		if index >= 4 {
			break
		}
		node := articleKnowledgeGraphNode{
			ID:          fmt.Sprintf("paragraph:%d:%d", article.ID, index+1),
			Type:        "structure",
			Label:       fmt.Sprintf("第 %d 段", index+1),
			Description: truncateKnowledgeText(firstSentence(paragraph), 150),
			Weight:      68 - index*3,
			Metadata: map[string]interface{}{
				"paragraph_index": index,
			},
		}
		addNode("structure", node, "has_part", "段落", 64)
	}

	for index, vocab := range vocabulary {
		if index >= 16 {
			break
		}
		mastery := articleVocabularyMastery(vocab)
		node := articleKnowledgeGraphNode{
			ID:          fmt.Sprintf("word:%d", vocab.ID),
			Type:        "word",
			Label:       vocab.Word,
			Description: firstNonEmptyString(firstMeaningText(vocab.Translation), firstMeaningText(vocab.Definition), vocab.Context),
			Weight:      90 - minInt(index*2, 32),
			Mastery:     &mastery,
			Metadata: map[string]interface{}{
				"vocabulary_id":   vocab.ID,
				"is_learned":      vocab.IsLearned,
				"review_count":    vocab.ReviewCount,
				"forgotten_count": vocab.ForgottenCount,
				"next_review_at":  vocab.NextReviewAt,
				"context":         vocab.Context,
			},
		}
		addNode("vocabulary", node, "contains_word", "词汇", 86)
		if vocab.ForgottenCount > 0 || !vocab.IsLearned {
			reviewNode := articleKnowledgeGraphNode{
				ID:          fmt.Sprintf("review:%d", vocab.ID),
				Type:        "review",
				Label:       vocab.Word,
				Description: articleReviewDescription(vocab),
				Weight:      82 + minInt(vocab.ForgottenCount*4, 14),
				Mastery:     &mastery,
				Metadata: map[string]interface{}{
					"vocabulary_id": vocab.ID,
					"word":          vocab.Word,
				},
			}
			addNode("review", reviewNode, "needs_review", "复习", 92)
		}
	}

	grammarNames := articleGrammarPoints(article.Content)
	for index, name := range grammarNames {
		node := articleKnowledgeGraphNode{
			ID:          fmt.Sprintf("grammar:%d:%s", article.ID, normalizeKnowledgeID(name)),
			Type:        "grammar",
			Label:       name,
			Description: articleGrammarDescription(name),
			Weight:      84 - index*5,
		}
		addNode("grammar", node, "has_grammar", "语法", 78)
	}

	for index, sentence := range articleDifficultSentences(paragraphs) {
		node := articleKnowledgeGraphNode{
			ID:          fmt.Sprintf("sentence:%d:%d", article.ID, index+1),
			Type:        "sentence",
			Label:       fmt.Sprintf("长难句 %d", index+1),
			Description: truncateKnowledgeText(sentence, 220),
			Weight:      80 - index*4,
			Metadata: map[string]interface{}{
				"sentence": sentence,
			},
		}
		addNode("sentences", node, "has_sentence", "长难句", 76)
	}

	lanes := []articleKnowledgeGraphLane{
		buildArticleKnowledgeLane("structure", "文章结构", "主题、段落和阅读框架", laneMap["structure"]),
		buildArticleKnowledgeLane("vocabulary", "重点词汇", "这篇文章里的已保存词和高价值词", laneMap["vocabulary"]),
		buildArticleKnowledgeLane("grammar", "语法结构", "从原文规则识别出的语法点", laneMap["grammar"]),
		buildArticleKnowledgeLane("sentences", "长难句/语境", "适合精读和拆句的句子", laneMap["sentences"]),
		buildArticleKnowledgeLane("review", "复习动作", "围绕本文需要优先处理的薄弱词", laneMap["review"]),
	}

	actions := buildArticleKnowledgeActions(article, laneMap)
	return articleKnowledgeGraphResponse{
		Article: articleNode,
		Lanes:   lanes,
		Edges:   edges,
		Actions: actions,
		Stats: gin.H{
			"total_nodes":      len(nodes),
			"total_edges":      len(edges),
			"vocabulary_count": len(laneMap["vocabulary"]),
			"grammar_count":    len(laneMap["grammar"]),
			"sentence_count":   len(laneMap["sentences"]),
			"review_count":     len(laneMap["review"]),
		},
	}
}

func buildArticleKnowledgeLane(id, title, description string, nodes []articleKnowledgeGraphNode) articleKnowledgeGraphLane {
	nodeIDs := make([]string, 0, len(nodes))
	for _, node := range nodes {
		nodeIDs = append(nodeIDs, node.ID)
	}
	return articleKnowledgeGraphLane{
		ID:          id,
		Title:       title,
		Description: description,
		NodeIDs:     nodeIDs,
		Nodes:       nodes,
	}
}

func buildArticleKnowledgeActions(article models.Article, lanes map[string][]articleKnowledgeGraphNode) []articleKnowledgeGraphAction {
	actions := []articleKnowledgeGraphAction{
		{
			ID:          "read-structure",
			Type:        "structure",
			Title:       "先看文章结构",
			Description: "用主题和段落框架快速建立阅读地图。",
			Label:       "查看结构",
			FocusNodeID: firstArticleKnowledgeNodeID(lanes["structure"]),
			Priority:    90,
		},
	}
	if len(lanes["review"]) > 0 {
		actions = append(actions, articleKnowledgeGraphAction{
			ID:          "review-words",
			Type:        "review",
			Title:       "复习本文薄弱词",
			Description: fmt.Sprintf("本文有 %d 个词需要优先复习。", len(lanes["review"])),
			Label:       "开始复习",
			Href:        "/vocabulary?mode=review",
			FocusNodeID: firstArticleKnowledgeNodeID(lanes["review"]),
			Priority:    100,
		})
	}
	if len(lanes["grammar"]) > 0 {
		actions = append(actions, articleKnowledgeGraphAction{
			ID:          "grammar-review",
			Type:        "grammar",
			Title:       "拆解本文语法",
			Description: "按语法点回到原文句子做精读。",
			Label:       "看语法",
			FocusNodeID: firstArticleKnowledgeNodeID(lanes["grammar"]),
			Priority:    82,
		})
	}
	if len(lanes["sentences"]) > 0 {
		actions = append(actions, articleKnowledgeGraphAction{
			ID:          "sentence-intensive",
			Type:        "sentence",
			Title:       "精读长难句",
			Description: "选择长句做结构拆解、翻译和仿写。",
			Label:       "看长难句",
			FocusNodeID: firstArticleKnowledgeNodeID(lanes["sentences"]),
			Priority:    78,
		})
	}
	sort.SliceStable(actions, func(i, j int) bool {
		return actions[i].Priority > actions[j].Priority
	})
	_ = article
	return actions
}

func firstArticleKnowledgeNodeID(nodes []articleKnowledgeGraphNode) string {
	if len(nodes) == 0 {
		return ""
	}
	return nodes[0].ID
}

func articleKnowledgeTopics(article models.Article) []string {
	values := []string{}
	for _, value := range []string{article.Category.Name, article.Category.NameEN, article.Tags, article.Keywords} {
		for _, part := range strings.FieldsFunc(value, func(r rune) bool {
			return r == ',' || r == '，' || r == ';' || r == '；' || r == '|'
		}) {
			part = strings.TrimSpace(part)
			if part != "" {
				values = append(values, part)
			}
		}
	}
	if article.DifficultyLevel != "" {
		values = append(values, "难度 "+article.DifficultyLevel)
	}
	if article.CEFRLevel != "" {
		values = append(values, "CEFR "+article.CEFRLevel)
	}
	return uniqueArticleKnowledgeValues(values, 8)
}

func articleGrammarPoints(text string) []string {
	rules := []struct {
		name    string
		pattern string
	}{
		{"定语从句", `(?i)\b(who|whom|whose|which|that)\b`},
		{"条件句", `(?i)\bif\b.+\b(would|could|might|will|can)\b`},
		{"完成时", `(?i)\b(has|have|had)\s+\w+(ed|en)\b`},
		{"被动语态", `(?i)\b(am|is|are|was|were|be|been|being)\s+\w+(ed|en)\b`},
		{"非谓语结构", `(?i)\b(to\s+\w+|\w+ing)\b`},
		{"比较结构", `(?i)\b(more|less|better|worse|than|as\s+\w+\s+as)\b`},
		{"转折连接", `(?i)\b(however|although|though|whereas|while)\b`},
		{"因果连接", `(?i)\b(because|since|therefore|thus|so that|as a result)\b`},
	}
	points := []string{}
	for _, rule := range rules {
		if regexp.MustCompile(rule.pattern).MatchString(text) {
			points = append(points, rule.name)
		}
	}
	return uniqueArticleKnowledgeValues(points, 8)
}

func articleGrammarDescription(name string) string {
	descriptions := map[string]string{
		"定语从句":  "修饰名词或代词，阅读时先找先行词。",
		"条件句":   "表达条件与结果，先理解 if/条件部分。",
		"完成时":   "强调完成、经验或持续影响。",
		"被动语态":  "突出动作承受者，注意真正动作发出者可能被省略。",
		"非谓语结构": "压缩信息的动词形式，适合拆成长句成分。",
		"比较结构":  "比较程度、数量或性质，注意比较对象。",
		"转折连接":  "让步或转折，主句通常是作者重点。",
		"因果连接":  "原因、结果或推论关系，是理解论证链的关键。",
	}
	return descriptions[name]
}

func articleDifficultSentences(paragraphs []string) []string {
	type scoredSentence struct {
		text  string
		score int
	}
	items := []scoredSentence{}
	for _, paragraph := range paragraphs {
		for _, sentence := range regexp.MustCompile(`[^.!?]+[.!?]+["')\]]*|[^.!?]+$`).FindAllString(paragraph, -1) {
			sentence = strings.TrimSpace(sentence)
			words := regexp.MustCompile(`[A-Za-z]+(?:['’][A-Za-z]+)?`).FindAllString(sentence, -1)
			if len(words) < 14 {
				continue
			}
			score := len(words)
			if strings.Contains(sentence, ",") {
				score += 8
			}
			lower := strings.ToLower(sentence)
			for _, marker := range []string{"although", "because", "which", "that", "while", "however", "therefore"} {
				if strings.Contains(lower, marker) {
					score += 5
				}
			}
			items = append(items, scoredSentence{text: sentence, score: score})
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].text < items[j].text
		}
		return items[i].score > items[j].score
	})
	result := []string{}
	for _, item := range items {
		result = append(result, item.text)
		if len(result) >= 6 {
			break
		}
	}
	return result
}

func articleVocabularyMastery(vocab models.Vocabulary) int {
	score := 35 + vocab.ReviewCount*12 - vocab.ForgottenCount*20
	if vocab.IsLearned {
		score += 30
	}
	if vocab.NextReviewAt != nil && !vocab.NextReviewAt.After(time.Now()) {
		score -= 10
	}
	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

func articleReviewDescription(vocab models.Vocabulary) string {
	if vocab.ForgottenCount > 0 {
		return fmt.Sprintf("忘记 %d 次，建议回到原文语境复习。", vocab.ForgottenCount)
	}
	if !vocab.IsLearned {
		return "尚未掌握，建议结合本文语境复习。"
	}
	return "建议复盘一次，巩固文章语境。"
}

func firstMeaningText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var values []string
	if err := json.Unmarshal([]byte(value), &values); err == nil && len(values) > 0 {
		return strings.TrimSpace(values[0])
	}
	var items []map[string]string
	if err := json.Unmarshal([]byte(value), &items); err == nil && len(items) > 0 {
		return firstNonEmptyString(items[0]["definition"], items[0]["translation"])
	}
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == '\n' || r == ';' || r == '；' || r == '。'
	})
	if len(parts) > 0 {
		return strings.TrimSpace(parts[0])
	}
	return value
}

func uniqueArticleKnowledgeValues(values []string, limit int) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
		if len(result) >= limit {
			break
		}
	}
	return result
}

func normalizeKnowledgeID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = regexp.MustCompile(`[^a-z0-9\p{Han}]+`).ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	if value == "" {
		return "item"
	}
	return value
}

func truncateKnowledgeText(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes]) + "..."
}

// GetArticleQuiz 获取或生成文章读后测验
func GetArticleQuiz(c *gin.Context) {
	userID, _ := c.Get("user_id")
	articleID, _ := strconv.Atoi(c.Param("id"))

	quiz, err := ensureArticleQuiz(uint(articleID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
		return
	}

	var latestAttempt models.ArticleQuizAttempt
	hasAttempt := database.DB.
		Where("user_id = ? AND quiz_id = ?", userID, quiz.ID).
		Order("created_at DESC").
		First(&latestAttempt).Error == nil

	var attempt *models.ArticleQuizAttempt
	if hasAttempt {
		attempt = &latestAttempt
	}

	c.JSON(http.StatusOK, gin.H{"data": buildArticleQuizResponse(quiz, attempt, hasAttempt)})
}

// SubmitArticleQuiz 提交文章读后测验答案
func SubmitArticleQuiz(c *gin.Context) {
	userID, _ := c.Get("user_id")
	articleID, _ := strconv.Atoi(c.Param("id"))

	var req struct {
		Answers []int `json:"answers" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	quiz, err := ensureArticleQuiz(uint(articleID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
		return
	}

	if len(req.Answers) != len(quiz.Questions) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Answer count does not match question count"})
		return
	}

	score := 0
	for index, question := range quiz.Questions {
		answer := req.Answers[index]
		if answer < 0 || answer >= len(decodeStringSlice(question.Options)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid answer index"})
			return
		}
		if answer == question.CorrectIndex {
			score++
		}
	}

	answersJSON, _ := json.Marshal(req.Answers)
	total := len(quiz.Questions)
	percentage := 0
	if total > 0 {
		percentage = int(math.Round(float64(score) / float64(total) * 100))
	}

	attempt := models.ArticleQuizAttempt{
		UserID:      userID.(uint),
		QuizID:      quiz.ID,
		Answers:     string(answersJSON),
		Score:       score,
		Total:       total,
		Percentage:  percentage,
		CompletedAt: time.Now(),
	}
	if err := database.DB.Create(&attempt).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save quiz attempt"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": buildArticleQuizResponse(quiz, &attempt, true)})
}

func ensureArticleQuiz(articleID uint) (models.ArticleQuiz, error) {
	var quiz models.ArticleQuiz
	if err := database.DB.
		Preload("Questions", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		Where("article_id = ?", articleID).
		First(&quiz).Error; err == nil && len(quiz.Questions) > 0 {
		return quiz, nil
	}

	var article models.Article
	if err := database.DB.Preload("Category").
		Where("id = ? AND status = ?", articleID, "published").
		First(&article).Error; err != nil {
		return quiz, err
	}

	quiz = models.ArticleQuiz{
		ArticleID: article.ID,
		Title:     "读后理解测验",
	}
	if err := database.DB.Where("article_id = ?", article.ID).
		Attrs(quiz).
		FirstOrCreate(&quiz).Error; err != nil {
		return quiz, err
	}

	var count int64
	if err := database.DB.Model(&models.ArticleQuizQuestion{}).
		Where("quiz_id = ?", quiz.ID).
		Count(&count).Error; err != nil {
		return quiz, err
	}
	if count == 0 {
		questions := buildMultiTypeQuizQuestions(article, quiz.ID, []string{"single_choice"}, 2)
		if len(questions) > 0 {
			if err := database.DB.Create(&questions).Error; err != nil {
				return quiz, err
			}
		}
	}

	if err := database.DB.
		Preload("Questions", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		First(&quiz, quiz.ID).Error; err != nil {
		return quiz, err
	}
	return quiz, nil
}

func buildArticleQuizResponse(quiz models.ArticleQuiz, attempt *models.ArticleQuizAttempt, reveal bool) articleQuizResponse {
	answers := []int{}
	attemptResponse := (*articleQuizAttemptResponse)(nil)
	if attempt != nil {
		answers = decodeIntSlice(attempt.Answers)
		attemptResponse = &articleQuizAttemptResponse{
			ID:          attempt.ID,
			Score:       attempt.Score,
			Total:       attempt.Total,
			Percentage:  attempt.Percentage,
			Answers:     answers,
			CompletedAt: attempt.CompletedAt,
		}
	}

	questions := make([]articleQuizQuestionResponse, 0, len(quiz.Questions))
	for index, question := range quiz.Questions {
		item := articleQuizQuestionResponse{
			ID:           question.ID,
			QuestionType: question.QuestionType,
			Prompt:       question.Prompt,
			Options:      decodeStringSlice(question.Options),
			SortOrder:    question.SortOrder,
		}
		if reveal {
			correctIndex := question.CorrectIndex
			item.CorrectIndex = &correctIndex
			item.Explanation = question.Explanation
			if index < len(answers) {
				userAnswer := answers[index]
				item.UserAnswer = &userAnswer
				isCorrect := userAnswer == question.CorrectIndex
				item.IsCorrect = &isCorrect
			}
		}
		questions = append(questions, item)
	}

	return articleQuizResponse{
		ID:            quiz.ID,
		ArticleID:     quiz.ArticleID,
		Title:         quiz.Title,
		Questions:     questions,
		LatestAttempt: attemptResponse,
	}
}

// GenerateArticleQuiz 生成指定题型的文章测验
func GenerateArticleQuiz(c *gin.Context) {
	userID, _ := c.Get("user_id")
	articleID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid article ID"})
		return
	}

	var req articleQuizRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		req = articleQuizRequest{
			QuestionTypes: []string{"single_choice"},
			Count:         2,
		}
	}

	if len(req.QuestionTypes) == 0 {
		req.QuestionTypes = []string{"single_choice"}
	}
	if req.Count <= 0 || req.Count > 10 {
		req.Count = 2
	}

	validTypes := map[string]bool{
		"single_choice": true,
		"true_false":    true,
		"main_idea":     true,
		"word_meaning":  true,
	}
	questionTypes := []string{}
	for _, qt := range req.QuestionTypes {
		if validTypes[qt] {
			questionTypes = append(questionTypes, qt)
		}
	}
	if len(questionTypes) == 0 {
		questionTypes = []string{"single_choice"}
	}

	quiz, err := generateQuizWithTypes(uint(articleID), questionTypes, req.Count)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
		return
	}

	var latestAttempt models.ArticleQuizAttempt
	hasAttempt := database.DB.
		Where("user_id = ? AND quiz_id = ?", userID, quiz.ID).
		Order("created_at DESC").
		First(&latestAttempt).Error == nil

	var attempt *models.ArticleQuizAttempt
	if hasAttempt {
		attempt = &latestAttempt
	}

	c.JSON(http.StatusOK, gin.H{"data": buildArticleQuizResponse(quiz, attempt, hasAttempt)})
}

func generateQuizWithTypes(articleID uint, questionTypes []string, countPerType int) (models.ArticleQuiz, error) {
	var quiz models.ArticleQuiz
	var article models.Article
	if err := database.DB.Preload("Category").
		Where("id = ? AND status = ?", articleID, "published").
		First(&article).Error; err != nil {
		return quiz, err
	}

	quiz = models.ArticleQuiz{
		ArticleID: article.ID,
		Title:     "读后理���测验",
	}
	if err := database.DB.Where("article_id = ?", article.ID).
		Attrs(quiz).
		FirstOrCreate(&quiz).Error; err != nil {
		return quiz, err
	}

	var attemptCount int64
	database.DB.Model(&models.ArticleQuizAttempt{}).Where("quiz_id = ?", quiz.ID).Count(&attemptCount)
	if attemptCount == 0 {
		database.DB.Where("quiz_id = ?", quiz.ID).Delete(&models.ArticleQuizQuestion{})
	}

	questions := buildMultiTypeQuizQuestions(article, quiz.ID, questionTypes, countPerType)
	if len(questions) > 0 {
		if err := database.DB.Create(&questions).Error; err != nil {
			return quiz, err
		}
	}

	if err := database.DB.
		Preload("Questions", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC, id ASC")
		}).
		First(&quiz, quiz.ID).Error; err != nil {
		return quiz, err
	}
	return quiz, nil
}

func buildMultiTypeQuizQuestions(article models.Article, quizID uint, questionTypes []string, countPerType int) []models.ArticleQuizQuestion {
	questions := []models.ArticleQuizQuestion{}
	sortOrder := 1

	for _, qt := range questionTypes {
		switch qt {
		case "single_choice":
			qs := generateSingleChoiceQuestions(article, quizID, sortOrder, countPerType)
			questions = append(questions, qs...)
			sortOrder += len(qs)
		case "true_false":
			qs := generateTrueFalseQuestions(article, quizID, sortOrder, countPerType)
			questions = append(questions, qs...)
			sortOrder += len(qs)
		case "main_idea":
			qs := generateMainIdeaQuestions(article, quizID, sortOrder, countPerType)
			questions = append(questions, qs...)
			sortOrder += len(qs)
		case "word_meaning":
			qs := generateWordMeaningQuestions(article, quizID, sortOrder, countPerType)
			questions = append(questions, qs...)
			sortOrder += len(qs)
		}
	}

	for i := range questions {
		questions[i].SortOrder = i + 1
	}
	return questions
}

func generateSingleChoiceQuestions(article models.Article, quizID uint, startOrder int, count int) []models.ArticleQuizQuestion {
	paragraphs := splitArticleParagraphs(article.Content)
	if len(paragraphs) == 0 {
		paragraphs = []string{article.Summary}
	}

	summary := firstNonEmptyString(strings.TrimSpace(article.Summary), firstSentence(paragraphs[0]))
	categoryName := article.Category.Name
	if categoryName == "" {
		categoryName = "这类话题"
	}

	keywords := extractQuizKeywords(article)
	keyword := "key concept"
	if len(keywords) > 0 {
		keyword = keywords[rand.Intn(len(keywords))]
	}

	detailParagraph := paragraphs[minArticleInt(1, len(paragraphs)-1)]
	questions := []models.ArticleQuizQuestion{}

	if count >= 1 {
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder, "single_choice",
			"Which statement best captures the main idea of the article?",
			uniqueOptions([]string{
				summary,
				fmt.Sprintf("文章主要介绍 %s 领域的一项新闻或趋势。", categoryName),
				"文章主要比较多个无关事件的时间顺序。",
				"文章主要讲述作者的个人学习经历。",
			}),
			0,
			"���旨题可以先看标题、摘要和每段首句；正确选项应覆盖全文，而不是只抓一个局部细节。"))
	}

	if count >= 2 && len(paragraphs) > 1 {
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder+len(questions), "single_choice",
			"According to the article, which detail is explicitly mentioned?",
			uniqueOptions([]string{
				firstSentence(detailParagraph),
				"The article says the trend has already solved every related problem.",
				"The article argues that no further rules or oversight are needed.",
				"The article focuses only on entertainment and personal stories.",
			}),
			0,
			"细节题要回到原文定位。正确选项来自文章中的具体句子。"))
	}

	if count >= 3 && len(keywords) > 0 {
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder+len(questions), "single_choice",
			fmt.Sprintf("In this article, what role does \"%s\" most likely play?", keyword),
			[]string{
				"It names an important concept or actor in the article.",
				"It is used as a time marker only.",
				"It signals a direct quotation from a speaker.",
				"It is unrelated to the article's topic.",
			},
			0,
			"词义语境题不只看中文意思，还要判断该词在文章论述中承担的作用。"))
	}

	return questions
}

func generateTrueFalseQuestions(article models.Article, quizID uint, startOrder int, count int) []models.ArticleQuizQuestion {
	paragraphs := splitArticleParagraphs(article.Content)
	if len(paragraphs) == 0 {
		return []models.ArticleQuizQuestion{}
	}

	categoryName := article.Category.Name
	if categoryName == "" {
		categoryName = "该领域"
	}

	questions := []models.ArticleQuizQuestion{}

	if count >= 1 {
		correctIsTrue := rand.Intn(2) == 0
		prompt1 := fmt.Sprintf("The article is primarily about %s.", categoryName)
		if !correctIsTrue {
			prompt1 = fmt.Sprintf("The article has nothing to do with %s.", categoryName)
		}
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder, "true_false",
			prompt1,
			[]string{"True", "False"},
			map[bool]int{true: 0, false: 1}[correctIsTrue],
			"根据文章标题和摘要，判断陈述是否与文章内容一致。"))
	}

	if count >= 2 && len(paragraphs) > 1 {
		firstPara := firstSentence(paragraphs[0])
		correctIsTrue2 := rand.Intn(2) == 0
		prompt2 := fmt.Sprintf("The article begins with: \"%s\" This statement is accurate based on the article.",
			truncateRunes(firstPara, 100))
		if !correctIsTrue2 {
			prompt2 = fmt.Sprintf("The article begins by discussing something completely unrelated to: \"%s\"",
				truncateRunes(firstPara, 100))
		}
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder+len(questions), "true_false",
			prompt2,
			[]string{"True", "False"},
			map[bool]int{true: 0, false: 1}[correctIsTrue2],
			"文章开头通常是概括性陈述，与后文内容一致。"))
	}

	if count >= 3 {
		correctIsTrue3 := rand.Intn(2) == 0
		prompt3 := "The article presents multiple perspectives and acknowledges remaining challenges."
		if !correctIsTrue3 {
			prompt3 = "The article only presents a single viewpoint and claims everything is already resolved."
		}
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder+len(questions), "true_false",
			prompt3,
			[]string{"True", "False"},
			map[bool]int{true: 0, false: 1}[correctIsTrue3],
			"多数新闻文章会呈现问题的复杂性，承认挑战和未解决的问题。"))
	}

	return questions
}

func generateMainIdeaQuestions(article models.Article, quizID uint, startOrder int, count int) []models.ArticleQuizQuestion {
	paragraphs := splitArticleParagraphs(article.Content)
	if len(paragraphs) == 0 {
		paragraphs = []string{article.Summary}
	}

	summary := firstNonEmptyString(strings.TrimSpace(article.Summary), firstSentence(paragraphs[0]))
	categoryName := article.Category.Name
	if categoryName == "" {
		categoryName = "this topic"
	}

	questions := []models.ArticleQuizQuestion{}

	if count >= 1 {
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder, "main_idea",
			"What is the main purpose of this article?",
			[]string{
				fmt.Sprintf("To inform readers about recent developments in %s.", categoryName),
				"To persuade readers to take immediate action.",
				"To entertain readers with a personal story.",
				"To criticize existing policies without alternatives.",
			},
			0,
			"大多数新闻和科普文章的写作目的是提供信息，让读者了解最新发展。"))
	}

	if count >= 2 {
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder+len(questions), "main_idea",
			"Which of the following best summarizes the article's central message?",
			uniqueOptions([]string{
				summary,
				"The article argues that the topic is irrelevant to most readers.",
				"The article claims the issue has been completely solved.",
				"The article focuses only on historical background without current relevance.",
			}),
			0,
			"文章主旨通常可以从摘要中准确提炼，要包含文章的核心里度。"))
	}

	return questions
}

func generateWordMeaningQuestions(article models.Article, quizID uint, startOrder int, count int) []models.ArticleQuizQuestion {
	paragraphs := splitArticleParagraphs(article.Content)
	if len(paragraphs) == 0 {
		return []models.ArticleQuizQuestion{}
	}

	keywords := extractQuizKeywords(article)
	if len(keywords) == 0 {
		keywords = []string{"significant", "approach", "develop", "impact", "effect"}
	}

	questions := []models.ArticleQuizQuestion{}

	if count >= 1 {
		keyword := keywords[rand.Intn(len(keywords))]
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder, "word_meaning",
			fmt.Sprintf("In the context of this article, what does \"%s\" most likely mean?", keyword),
			[]string{
				"An important concept related to the article's topic.",
				"A time marker indicating when events occurred.",
				"The name of the article's author.",
				"An unrelated technical term.",
			},
			0,
			"根据上下文，关键词在文章中通常承担着论述核心概念的作用。"))
	}

	if count >= 2 && len(paragraphs) > 1 {
		keyword := keywords[rand.Intn(len(keywords))]
		questions = append(questions, newQuizQuestionWithType(quizID, startOrder+len(questions), "word_meaning",
			fmt.Sprintf("The author uses \"%s\" primarily to:", keyword),
			[]string{
				"Introduce a key concept that supports the article's argument.",
				"Fill space and make the article appear longer.",
				"Quote another source without attribution.",
				"Transition to a completely different topic.",
			},
			0,
			"重要概念在文章中用于支撑论点，而不是为了填充篇幅。"))
	}

	return questions
}

func newQuizQuestionWithType(quizID uint, sortOrder int, questionType, prompt string, options []string, correctIndex int, explanation string) models.ArticleQuizQuestion {
	options, correctIndex = shuffleQuizOptions(options, correctIndex, int64(quizID)*100+int64(sortOrder))
	optionsJSON, _ := json.Marshal(options)
	return models.ArticleQuizQuestion{
		QuizID:       quizID,
		SortOrder:    sortOrder,
		QuestionType: questionType,
		Prompt:       prompt,
		Options:      string(optionsJSON),
		CorrectIndex: correctIndex,
		Explanation:  explanation,
}
}



func shuffleQuizOptions(options []string, correctIndex int, seed int64) ([]string, int) {
	if correctIndex < 0 || correctIndex >= len(options) {
		return options, correctIndex
	}

	type optionItem struct {
		Text    string
		Correct bool
	}
	items := make([]optionItem, 0, len(options))
	for index, option := range options {
		items = append(items, optionItem{
			Text:    option,
			Correct: index == correctIndex,
		})
	}

	random := rand.New(rand.NewSource(seed))
	random.Shuffle(len(items), func(i, j int) {
		items[i], items[j] = items[j], items[i]
	})

	shuffled := make([]string, 0, len(items))
	nextCorrectIndex := correctIndex
	for index, item := range items {
		shuffled = append(shuffled, item.Text)
		if item.Correct {
			nextCorrectIndex = index
		}
	}
	return shuffled, nextCorrectIndex
}

func splitArticleParagraphs(content string) []string {
	parts := strings.Split(content, "\n\n")
	paragraphs := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			paragraphs = append(paragraphs, part)
		}
	}
	return paragraphs
}

func firstSentence(text string) string {
	sentences := regexp.MustCompile(`[^.!?]+[.!?]+["')\]]*|[^.!?]+$`).FindAllString(strings.TrimSpace(text), -1)
	if len(sentences) == 0 {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(sentences[0])
}

func extractQuizKeywords(article models.Article) []string {
	text := strings.ToLower(article.Title + " " + article.Summary + " " + article.Tags)
	words := regexp.MustCompile(`[a-z]+(?:-[a-z]+)?`).FindAllString(text, -1)
	stop := map[string]bool{
		"the": true, "and": true, "for": true, "with": true, "that": true, "this": true,
		"from": true, "into": true, "could": true, "would": true, "should": true, "have": true,
		"has": true, "are": true, "was": true, "were": true, "how": true, "why": true,
		"can": true, "its": true, "new": true, "first": true,
	}
	counts := make(map[string]int)
	for _, word := range words {
		if len(word) < 4 || stop[word] {
			continue
		}
		counts[word]++
	}
	keywords := make([]string, 0, len(counts))
	for word := range counts {
		keywords = append(keywords, word)
	}
	sort.Slice(keywords, func(i, j int) bool {
		if counts[keywords[i]] == counts[keywords[j]] {
			return keywords[i] < keywords[j]
		}
		return counts[keywords[i]] > counts[keywords[j]]
	})
	if len(keywords) > 5 {
		return keywords[:5]
	}
	return keywords
}

func uniqueOptions(options []string) []string {
	fallbacks := []string{
		"The article presents a broad background rather than a specific claim.",
		"The article says the issue has no practical importance.",
		"The article mainly lists unrelated facts.",
		"The article focuses only on personal opinion.",
	}
	seen := make(map[string]bool)
	result := make([]string, 0, len(options))
	for _, option := range append(options, fallbacks...) {
		option = strings.TrimSpace(option)
		if option == "" || seen[option] {
			continue
		}
		seen[option] = true
		result = append(result, option)
		if len(result) == 4 {
			break
		}
	}
	return result
}

func decodeStringSlice(raw string) []string {
	values := []string{}
	_ = json.Unmarshal([]byte(raw), &values)
	return values
}

func decodeIntSlice(raw string) []int {
	values := []int{}
	_ = json.Unmarshal([]byte(raw), &values)
	return values
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func minArticleInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// DiscussArticleWithAssistant 围绕文章和 AI 助手对话
func DiscussArticleWithAssistant(c *gin.Context) {
	articleID, _ := strconv.Atoi(c.Param("id"))

	var req struct {
		Messages []services.ArticleAssistantMessage `json:"messages" binding:"required,min=1,max=12"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if aiAnalysisService == nil || !aiAnalysisService.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 文章助手未配置"})
		return
	}

	messages := normalizeArticleAssistantMessages(req.Messages)
	if len(messages) == 0 || messages[len(messages)-1].Role != "user" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请发送有效问题"})
		return
	}

	var article models.Article
	if err := database.DB.Preload("Category").
		Where("id = ? AND status = ?", articleID, "published").
		First(&article).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
		return
	}

	summary := article.Summary
	if article.SummaryCN != "" {
		summary += "\n中文摘要：" + article.SummaryCN
	}

	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "当前服务器不支持流式输出"})
		return
	}

	assistantAnswer := strings.Builder{}
	err := aiAnalysisService.DiscussArticleStream(
		article.Title,
		truncateRunes(summary, 1200),
		truncateRunes(article.Content, 12000),
		messages,
		func(delta string) error {
			assistantAnswer.WriteString(delta)
			payload, err := json.Marshal(gin.H{"delta": delta})
			if err != nil {
				return err
			}
			if _, err := fmt.Fprintf(c.Writer, "data: %s\n\n", payload); err != nil {
				return err
			}
			flusher.Flush()
			return nil
		},
	)
	if err != nil {
		fmt.Printf("AI 文章助手失败: %v\n", err)
		payload, _ := json.Marshal(gin.H{"error": "AI 文章助手暂时不可用"})
		fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", payload)
		flusher.Flush()
		return
	}

	if userID, exists := c.Get("user_id"); exists && len(messages) > 0 {
		recordArticleStudyEvent(c, services.StudyEventAssistant, &article.ID, messages[len(messages)-1].Content, assistantAnswer.String(), "", map[string]any{
			"user_id": userID,
		})
	}

	fmt.Fprint(c.Writer, "data: [DONE]\n\n")
	flusher.Flush()
}

func normalizeArticleAssistantMessages(messages []services.ArticleAssistantMessage) []services.ArticleAssistantMessage {
	normalized := make([]services.ArticleAssistantMessage, 0, len(messages))
	for _, message := range messages {
		role := strings.ToLower(strings.TrimSpace(message.Role))
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		if role != "user" && role != "assistant" {
			continue
		}
		normalized = append(normalized, services.ArticleAssistantMessage{
			Role:    role,
			Content: truncateRunes(content, 1600),
		})
	}

	if len(normalized) > 12 {
		normalized = normalized[len(normalized)-12:]
	}
	return normalized
}

func truncateRunes(text string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max]) + "\n\n[内容已截断]"
}

type sentenceAnalysis struct {
	Sentence       string   `json:"sentence"`
	Translation    string   `json:"translation"`
	WordCount      int      `json:"word_count"`
	Structure      []string `json:"structure"`
	KeyPhrases     []string `json:"key_phrases"`
	DifficultyTips []string `json:"difficulty_tips"`
	Provider       string   `json:"provider"`
}

// AnalyzeSentence 句子级精读
func AnalyzeSentence(c *gin.Context) {
	var req struct {
		Text      string `json:"text" binding:"required"`
		ArticleID *uint  `json:"article_id"`
		Context   string `json:"context"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	text := strings.TrimSpace(req.Text)
	if aiAnalysisService != nil && aiAnalysisService.IsConfigured() {
		if result, err := aiAnalysisService.AnalyzeSentence(text); err == nil {
			recordArticleStudyEvent(c, services.StudyEventSentenceAnalysis, req.ArticleID, text, result.Translation, req.Context, map[string]any{
				"provider":        result.Provider,
				"structure":       result.Structure,
				"key_phrases":     result.KeyPhrases,
				"difficulty_tips": result.DifficultyTips,
				"word_count":      result.WordCount,
			})
			c.JSON(http.StatusOK, gin.H{"data": result})
			return
		} else {
			fmt.Printf("AI 精读失败，回退规则解析: %v\n", err)
		}
	}

	translation := mockTranslate(text, "zh")
	if translationService != nil {
		if result, _, err := translationService.Translate(text, "en", "zh"); err == nil && result != "" {
			translation = result
		}
	}

	analysis := buildSentenceAnalysis(text, translation)
	recordArticleStudyEvent(c, services.StudyEventSentenceAnalysis, req.ArticleID, text, analysis.Translation, req.Context, map[string]any{
		"provider":        analysis.Provider,
		"structure":       analysis.Structure,
		"key_phrases":     analysis.KeyPhrases,
		"difficulty_tips": analysis.DifficultyTips,
		"word_count":      analysis.WordCount,
	})

	c.JSON(http.StatusOK, gin.H{"data": analysis})
}

func buildSentenceAnalysis(text, translation string) sentenceAnalysis {
	words := regexp.MustCompile(`[A-Za-z]+(?:['’][A-Za-z]+)?`).FindAllString(text, -1)
	structure := []string{"主干：先找谓语动词，再回看谓语前的主语和谓语后的宾语/补语。"}

	if strings.Contains(text, ",") {
		structure = append(structure, "逗号分隔了插入信息或并列分句，阅读时可以先跳过逗号内的信息。")
	}
	lower := strings.ToLower(text)
	for _, marker := range []string{"because", "when", "while", "if", "although", "that", "which", "who"} {
		if strings.Contains(lower, " "+marker+" ") {
			structure = append(structure, fmtClauseTip(marker))
		}
	}

	keyPhrases := extractKeyPhrases(words)
	tips := make([]string, 0)
	if len(words) >= 24 {
		tips = append(tips, "句子较长，可以按逗号、连词和介词短语切成几个信息块。")
	}
	if strings.Contains(lower, "not ") || strings.Contains(lower, " no ") {
		tips = append(tips, "注意否定词，它会改变整句判断方向。")
	}
	if strings.Contains(lower, "can ") || strings.Contains(lower, "could ") || strings.Contains(lower, "may ") || strings.Contains(lower, "might ") {
		tips = append(tips, "情态动词表达可能性、能力或建议，不等于事实已经发生。")
	}
	if len(tips) == 0 {
		tips = append(tips, "先理解主谓宾，再处理修饰成分。")
	}

	return sentenceAnalysis{
		Sentence:       text,
		Translation:    translation,
		WordCount:      len(words),
		Structure:      structure,
		KeyPhrases:     keyPhrases,
		DifficultyTips: tips,
		Provider:       "rules",
	}
}

func fmtClauseTip(marker string) string {
	switch marker {
	case "because":
		return "because 引导原因，从句解释主句为什么成立。"
	case "when", "while":
		return marker + " 引导时间/背景，从句提供动作发生的条件或场景。"
	case "if":
		return "if 引导条件，先理解条件，再看主句结果。"
	case "although":
		return "although 引导让步，主句通常表达转折后的重点。"
	case "that", "which", "who":
		return marker + " 可能引导从句，通常修饰前面的名词或补充说明。"
	default:
		return marker + " 引导从句，建议拆开理解。"
	}
}

func extractKeyPhrases(words []string) []string {
	stop := map[string]bool{
		"the": true, "a": true, "an": true, "and": true, "or": true, "but": true,
		"to": true, "of": true, "in": true, "on": true, "for": true, "with": true,
		"is": true, "are": true, "was": true, "were": true, "be": true, "been": true,
	}
	phrases := make([]string, 0)
	for i := 0; i < len(words)-1 && len(phrases) < 6; i++ {
		left := strings.ToLower(words[i])
		right := strings.ToLower(words[i+1])
		if stop[left] || stop[right] || len(left) < 4 || len(right) < 4 {
			continue
		}
		phrase := left + " " + right
		duplicate := false
		for _, existing := range phrases {
			if existing == phrase {
				duplicate = true
				break
			}
		}
		if !duplicate {
			phrases = append(phrases, phrase)
		}
	}
	if len(phrases) == 0 && len(words) > 0 {
		phrases = append(phrases, strings.ToLower(words[0]))
	}
	return phrases
}

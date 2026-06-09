package handlers

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"gugudu-backend/database"
	"gugudu-backend/models"
	"gugudu-backend/services"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type adminArticleRequest struct {
	Title           string `json:"title" binding:"required"`
	TitleCN         string `json:"title_cn"`
	Slug            string `json:"slug"`
	Summary         string `json:"summary"`
	SummaryCN       string `json:"summary_cn"`
	Content         string `json:"content" binding:"required"`
	ContentCN       string `json:"content_cn"`
	CoverImage      string `json:"cover_image"`
	CategoryID      uint   `json:"category_id" binding:"required"`
	Tags            string `json:"tags"`
	Source          string `json:"source"`
	SourceURL       string `json:"source_url"`
	Author          string `json:"author"`
	PublishedAt     string `json:"published_at"`
	DifficultyLevel string `json:"difficulty_level"`
	Status          string `json:"status"`
	IsFeatured      bool   `json:"is_featured"`
}

type adminArticleStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

type adminArticleFeaturedRequest struct {
	IsFeatured bool `json:"is_featured"`
}

func AdminListArticles(c *gin.Context) {
	var articles []models.Article

	page := positiveInt(c.DefaultQuery("page", "1"), 1)
	pageSize := positiveInt(c.DefaultQuery("page_size", "20"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	status := strings.TrimSpace(c.Query("status"))
	categorySlug := strings.TrimSpace(c.Query("category"))
	source := strings.TrimSpace(c.Query("source"))
	search := strings.TrimSpace(c.Query("search"))

	query := database.DB.Model(&models.Article{}).Preload("Category")
	if status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}
	if source != "" {
		query = query.Where("source = ?", source)
	}
	if categorySlug != "" {
		query = query.Joins("JOIN categories ON categories.id = articles.category_id").
			Where("categories.slug = ?", categorySlug)
	}
	if search != "" {
		keyword := "%" + search + "%"
		query = query.Where("title ILIKE ? OR title_cn ILIKE ? OR summary ILIKE ? OR source ILIKE ?", keyword, keyword, keyword, keyword)
	}

	var total int64
	query.Count(&total)

	if err := query.Order("updated_at DESC").
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

func AdminGetArticle(c *gin.Context) {
	article, ok := findArticleByID(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": article})
}

func AdminCreateArticle(c *gin.Context) {
	var req adminArticleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	article, err := buildAdminArticle(req, models.Article{})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if article.Slug == "" {
		article.Slug = adminArticleSlug(article.Title, article.SourceURL)
	}

	if err := database.DB.Create(&article).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	database.DB.Preload("Category").First(&article, article.ID)
	c.JSON(http.StatusCreated, gin.H{"data": article})
}

func AdminUpdateArticle(c *gin.Context) {
	existing, ok := findArticleByID(c)
	if !ok {
		return
	}

	var req adminArticleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	article, err := buildAdminArticle(req, existing)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if article.Slug == "" {
		article.Slug = adminArticleSlug(article.Title, article.SourceURL)
	}

	if err := database.DB.Omit("Category").Save(&article).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	database.DB.Preload("Category").First(&article, article.ID)
	c.JSON(http.StatusOK, gin.H{"data": article})
}

func AdminDeleteArticle(c *gin.Context) {
	article, ok := findArticleByID(c)
	if !ok {
		return
	}

	if err := database.DB.Delete(&article).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Article deleted"})
}

func AdminUpdateArticleStatus(c *gin.Context) {
	article, ok := findArticleByID(c)
	if !ok {
		return
	}

	var req adminArticleStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	status := normalizeArticleStatus(req.Status)
	if status == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid article status"})
		return
	}

	if err := database.DB.Model(&models.Article{}).
		Where("id = ?", article.ID).
		Update("status", status).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	article.Status = status
	c.JSON(http.StatusOK, gin.H{"data": article})
}

func AdminUpdateArticleFeatured(c *gin.Context) {
	article, ok := findArticleByID(c)
	if !ok {
		return
	}

	var req adminArticleFeaturedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := database.DB.Model(&models.Article{}).
		Where("id = ?", article.ID).
		Update("is_featured", req.IsFeatured).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	article.IsFeatured = req.IsFeatured
	c.JSON(http.StatusOK, gin.H{"data": article})
}

func buildAdminArticle(req adminArticleRequest, article models.Article) (models.Article, error) {
	status := normalizeArticleStatus(req.Status)
	if status == "" {
		status = "draft"
	}
	publishedAt, err := parseAdminPublishedAt(req.PublishedAt)
	if err != nil {
		return article, err
	}
	if publishedAt.IsZero() {
		publishedAt = time.Now()
	}

	article.Title = strings.TrimSpace(req.Title)
	article.TitleCN = strings.TrimSpace(req.TitleCN)
	article.Slug = strings.TrimSpace(req.Slug)
	article.Summary = strings.TrimSpace(req.Summary)
	article.SummaryCN = strings.TrimSpace(req.SummaryCN)
	article.Content = strings.TrimSpace(req.Content)
	article.ContentCN = strings.TrimSpace(req.ContentCN)
	article.CoverImage = strings.TrimSpace(req.CoverImage)
	article.CategoryID = req.CategoryID
	article.Tags = strings.TrimSpace(req.Tags)
	article.Source = strings.TrimSpace(req.Source)
	article.SourceURL = strings.TrimSpace(req.SourceURL)
	article.Author = strings.TrimSpace(req.Author)
	article.PublishedAt = publishedAt
	article.Status = status
	article.IsFeatured = req.IsFeatured

	if article.Title == "" || article.Content == "" {
		return article, errors.New("title and content are required")
	}

	analysis := services.AnalyzeArticleText(article.Title, article.Summary, article.Content)
	article.WordCount = analysis.WordCount
	article.ReadingTime = analysis.ReadingTime
	article.DifficultyLevel = analysis.DifficultyLevel
	if manualDifficulty := services.NormalizeDifficultyLevel(req.DifficultyLevel); manualDifficulty != "" {
		article.DifficultyLevel = manualDifficulty
	}
	article.Keywords = services.KeywordsToString(analysis.Keywords)
	article.CEFRLevel = analysis.CEFRLevel

	var category models.Category
	if err := database.DB.First(&category, article.CategoryID).Error; err != nil {
		return article, errors.New("category not found")
	}

	return article, nil
}

func findArticleByID(c *gin.Context) (models.Article, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid article id"})
		return models.Article{}, false
	}

	var article models.Article
	if err := database.DB.Preload("Category").First(&article, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
			return models.Article{}, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return models.Article{}, false
	}
	return article, true
}

func normalizeArticleStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "draft":
		return "draft"
	case "published":
		return "published"
	case "archived":
		return "archived"
	default:
		return ""
	}
}

func parseAdminPublishedAt(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02", "2006-01-02 15:04"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, errors.New("invalid published_at")
}

func positiveInt(value string, fallback int) int {
	number, err := strconv.Atoi(value)
	if err != nil || number <= 0 {
		return fallback
	}
	return number
}

func adminArticleSlug(title, sourceURL string) string {
	base := strings.ToLower(title)
	base = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "article"
	}
	if len(base) > 150 {
		base = strings.Trim(base[:150], "-")
	}

	hashSource := strings.TrimSpace(sourceURL)
	if hashSource == "" {
		hashSource = title
	}
	sum := sha1.Sum([]byte(hashSource))
	return base + "-" + hex.EncodeToString(sum[:])[:8]
}

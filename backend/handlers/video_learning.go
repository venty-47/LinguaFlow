package handlers

import (
	"errors"
	"fmt"
	"gugudu-backend/config"
	"gugudu-backend/services"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var videoLearningService *services.VideoLearningService

func InitVideoLearningService(db *gorm.DB, cfg config.VideoLearningConfig) {
	videoLearningService = services.NewVideoLearningService(db, cfg)
	if videoLearningService.IsConfigured() {
		fmt.Printf("✓ 视频学习已初始化: %s / %s\n", cfg.TranscriptionProvider, cfg.TranscriptionModel)
	} else {
		fmt.Println("✗ 视频学习未启用")
	}
}

func CreateVideoLesson(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}

	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择视频或音频文件"})
		return
	}

	lesson, err := service.CreateLesson(c.Request.Context(), services.VideoLessonCreateRequest{
		UserID:      userID,
		Title:       c.PostForm("title"),
		Description: c.PostForm("description"),
		Language:    c.DefaultPostForm("language", "en"),
		File:        file,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": lesson})
}

func ListVideoLessons(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}
	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	lessons, total, err := service.ListLessons(c.Request.Context(), userID, c.Query("status"), page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "视频列表加载失败"})
		return
	}

	totalPage := int((total + int64(pageSize) - 1) / int64(pageSize))
	c.JSON(http.StatusOK, gin.H{
		"data": lessons,
		"pagination": gin.H{
			"page":       page,
			"page_size":  pageSize,
			"total":      total,
			"total_page": totalPage,
		},
	})
}

func GetVideoLesson(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	lessonID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}

	lesson, err := service.GetLesson(c.Request.Context(), userID, lessonID)
	if err != nil {
		handleVideoNotFound(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": lesson})
}

func DeleteVideoLesson(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	lessonID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}

	if err := service.DeleteLesson(c.Request.Context(), userID, lessonID); err != nil {
		handleVideoNotFound(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "视频已删除"})
}

func RegenerateVideoSubtitles(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	lessonID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}

	lesson, err := service.RegenerateSubtitles(c.Request.Context(), userID, lessonID)
	if err != nil {
		if errors.Is(err, services.ErrVideoLessonProcessing) {
			c.JSON(http.StatusConflict, gin.H{"error": "字幕正在生成中，请稍后再试"})
			return
		}
		handleVideoNotFound(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": lesson})
}

func GetVideoSubtitles(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	lessonID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}

	subtitles, err := service.GetSubtitles(c.Request.Context(), userID, lessonID)
	if err != nil {
		handleVideoNotFound(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": subtitles})
}

func GetVideoSubtitlesVTT(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	lessonID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}

	vtt, err := service.VTT(c.Request.Context(), userID, lessonID)
	if err != nil {
		handleVideoNotFound(c, err)
		return
	}

	c.Header("Content-Type", "text/vtt; charset=utf-8")
	c.String(http.StatusOK, vtt)
}

func UpdateVideoProgress(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	lessonID, ok := parseUintParam(c, "id")
	if !ok {
		return
	}

	var req services.VideoProgressRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的播放进度"})
		return
	}

	lesson, err := service.UpdateProgress(c.Request.Context(), userID, lessonID, req)
	if err != nil {
		handleVideoNotFound(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": lesson})
}

func requireVideoLearningService(c *gin.Context) (*services.VideoLearningService, bool) {
	if videoLearningService == nil || !videoLearningService.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频学习服务未启用"})
		return nil, false
	}
	return videoLearningService, true
}

func currentUserID(c *gin.Context) (uint, bool) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return 0, false
	}
	userID, ok := userIDValue.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user context"})
		return 0, false
	}
	return userID, true
}

func parseUintParam(c *gin.Context, name string) (uint, bool) {
	value, err := strconv.ParseUint(c.Param(name), 10, 64)
	if err != nil || value == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的资源 ID"})
		return 0, false
	}
	return uint(value), true
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func handleVideoNotFound(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "视频不存在"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "视频数据加载失败"})
}

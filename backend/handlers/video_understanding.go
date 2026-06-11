package handlers

import (
	"encoding/json"
	"gugudu-backend/database"
	"gugudu-backend/models"
	"gugudu-backend/services"
	"net/http"

	"github.com/gin-gonic/gin"
)

var videoUnderstandingService *services.VideoUnderstandingService

type videoUnderstandingResponse struct {
	ID            uint                      `json:"id"`
	VideoLessonID uint                      `json:"video_lesson_id"`
	UserID        uint                      `json:"user_id"`
	SummaryEN     string                    `json:"summary_en"`
	SummaryCN     string                    `json:"summary_cn"`
	KeyPoints     []services.KeyPoint       `json:"key_points"`
	Vocabulary    []services.VocabItem      `json:"vocabulary"`
	Topics        []string                  `json:"topics"`
	StudyGuide    string                    `json:"study_guide"`
	Provider      string                    `json:"provider"`
	Model         string                    `json:"model"`
	GeneratedAt   string                    `json:"generated_at"`
	RefreshedAt   *string                   `json:"refreshed_at"`
	TokensUsed    int                       `json:"tokens_used"`
}

func toUnderstandingResponse(u *models.VideoUnderstanding) *videoUnderstandingResponse {
	resp := &videoUnderstandingResponse{
		ID:            u.ID,
		VideoLessonID: u.VideoLessonID,
		UserID:        u.UserID,
		SummaryEN:     u.SummaryEN,
		SummaryCN:     u.SummaryCN,
		StudyGuide:    u.StudyGuide,
		Provider:      u.Provider,
		Model:         u.Model,
		GeneratedAt:   u.GeneratedAt.Format("2006-01-02T15:04:05Z07:00"),
		TokensUsed:    u.TokensUsed,
	}
	if u.RefreshedAt != nil {
		t := u.RefreshedAt.Format("2006-01-02T15:04:05Z07:00")
		resp.RefreshedAt = &t
	}
	json.Unmarshal([]byte(u.KeyPoints), &resp.KeyPoints)
	json.Unmarshal([]byte(u.Vocabulary), &resp.Vocabulary)
	json.Unmarshal([]byte(u.Topics), &resp.Topics)
	return resp
}

func InitVideoUnderstandingService(aiService *services.AIAnalysisService) {
	if aiService != nil {
		videoUnderstandingService = services.NewVideoUnderstandingService(database.DB, aiService)
	}
}

func GenerateVideoUnderstanding(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}
	if videoUnderstandingService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频理解服务未启用"})
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

	var req struct {
		Force             bool `json:"force"`
		IncludeVocabulary bool `json:"include_vocabulary"`
		IncludeKeyPoints  bool `json:"include_key_points"`
	}
	_ = c.ShouldBindJSON(&req)

	lesson, err := service.GetLesson(c.Request.Context(), userID, lessonID)
	if err != nil {
		handleVideoNotFound(c, err)
		return
	}

	if lesson.Status != "ready" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "视频尚未准备就绪"})
		return
	}

	subtitles, err := service.GetSubtitles(c.Request.Context(), userID, lessonID)
	if err != nil || len(subtitles) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "视频暂无字幕"})
		return
	}

	understanding, err := videoUnderstandingService.GenerateUnderstanding(
		c.Request.Context(),
		lesson,
		subtitles,
		userID,
		services.GenerateOptions{
			Force:             req.Force,
			IncludeVocabulary: req.IncludeVocabulary,
			IncludeKeyPoints:  req.IncludeKeyPoints,
		},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": toUnderstandingResponse(understanding)})
}

func GetVideoUnderstanding(c *gin.Context) {
	if videoUnderstandingService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频理解服务未启用"})
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

	understanding, err := videoUnderstandingService.GetUnderstanding(c.Request.Context(), lessonID, userID)
	if err != nil {
		handleVideoNotFound(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": toUnderstandingResponse(understanding)})
}

func ChatWithVideo(c *gin.Context) {
	service, ok := requireVideoLearningService(c)
	if !ok {
		return
	}
	if videoUnderstandingService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频理解服务未启用"})
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

	var req struct {
		Messages []services.ChatMessage `json:"messages"`
		Stream   bool                   `json:"stream"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求"})
		return
	}

	lesson, err := service.GetLesson(c.Request.Context(), userID, lessonID)
	if err != nil {
		handleVideoNotFound(c, err)
		return
	}

	understanding, err := videoUnderstandingService.GetUnderstanding(c.Request.Context(), lessonID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "请先生成视频理解"})
		return
	}

	if req.Stream {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")

		c.Status(http.StatusOK)
		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "流式响应不支持"})
			return
		}

		err := videoUnderstandingService.ChatWithVideoStream(
			c.Request.Context(),
			lesson,
			understanding,
			req.Messages,
			userID,
			func(delta string) error {
				c.SSEvent("message", delta)
				flusher.Flush()
				return nil
			},
		)

		if err != nil {
			c.SSEvent("error", err.Error())
			flusher.Flush()
		}
	} else {
		response, err := videoUnderstandingService.ChatWithVideo(
			c.Request.Context(),
			lesson,
			understanding,
			req.Messages,
			userID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"content": response}})
	}
}

func GetVideoConversations(c *gin.Context) {
	if videoUnderstandingService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频理解服务未启用"})
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

	limit := parsePositiveInt(c.Query("limit"), 50)
	if limit > 200 {
		limit = 200
	}

	conversations, err := videoUnderstandingService.GetConversations(c.Request.Context(), lessonID, userID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载对话历史失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": conversations})
}

func ClearVideoConversations(c *gin.Context) {
	if videoUnderstandingService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "视频理解服务未启用"})
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

	if err := videoUnderstandingService.ClearConversations(c.Request.Context(), lessonID, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "清空对话失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "对话历史已清空"})
}

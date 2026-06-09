package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"gugudu-backend/config"
	"gugudu-backend/database"
	"gugudu-backend/models"
	"gugudu-backend/services"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	videoStatusUploaded        = "uploaded"
	videoStatusExtractingAudio = "extracting_audio"
	videoStatusTranscribing    = "transcribing"
	videoStatusSegmenting      = "segmenting"
	videoStatusReady           = "ready"
	videoStatusFailed          = "failed"
	videoStatusCancelled       = "cancelled"

	subtitleSourceAuto     = "auto"
	subtitleSourceManual   = "manual"
	subtitleSourceEdited   = "edited"
	subtitleSourceImported = "imported"
)

var videoLearningCfg config.VideoLearningConfig
var videoMediaProcessor *services.MediaProcessor
var videoTranscriber services.VideoTranscriber

func InitVideoLearningService(cfg config.VideoLearningConfig, fallbackAPIKey string) {
	videoLearningCfg = cfg
	if strings.TrimSpace(videoLearningCfg.StorageDir) == "" {
		videoLearningCfg.StorageDir = "storage/videos"
	}
	if strings.TrimSpace(videoLearningCfg.AudioDir) == "" {
		videoLearningCfg.AudioDir = "storage/video-audio"
	}
	if strings.TrimSpace(videoLearningCfg.TranscriptDir) == "" {
		videoLearningCfg.TranscriptDir = "storage/video-transcripts"
	}
	if videoLearningCfg.MaxUploadMB <= 0 {
		videoLearningCfg.MaxUploadMB = 300
	}
	if videoLearningCfg.MaxDurationSeconds <= 0 {
		videoLearningCfg.MaxDurationSeconds = 3600
	}
	if strings.TrimSpace(videoLearningCfg.AllowedExtensions) == "" {
		videoLearningCfg.AllowedExtensions = ".mp4,.mov,.m4v,.webm,.mp3,.m4a"
	}
	if videoLearningCfg.ProcessingTimeoutSeconds <= 0 {
		videoLearningCfg.ProcessingTimeoutSeconds = 1800
	}

	provider := strings.TrimSpace(strings.ToLower(videoLearningCfg.TranscriptionProvider))
	if provider == "" {
		provider = "funasr"
		videoLearningCfg.TranscriptionProvider = provider
	}
	if strings.TrimSpace(videoLearningCfg.TranscriptionBaseURL) == "" {
		if provider == "funasr" || provider == "local" {
			videoLearningCfg.TranscriptionBaseURL = "http://localhost:8000/v1"
		} else {
			videoLearningCfg.TranscriptionBaseURL = "https://api.openai.com/v1"
		}
	}
	if strings.TrimSpace(videoLearningCfg.TranscriptionModel) == "" {
		if provider == "funasr" || provider == "local" {
			videoLearningCfg.TranscriptionModel = "sensevoice"
		} else {
			videoLearningCfg.TranscriptionModel = "whisper-1"
		}
	}
	if videoLearningCfg.MaxAudioUploadMB <= 0 {
		if provider == "funasr" || provider == "local" {
			videoLearningCfg.MaxAudioUploadMB = 500
		} else {
			videoLearningCfg.MaxAudioUploadMB = 25
		}
	}

	apiKey := strings.TrimSpace(videoLearningCfg.TranscriptionAPIKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(fallbackAPIKey)
	}

	videoMediaProcessor = services.NewMediaProcessor(videoLearningCfg.ProcessingTimeoutSeconds)
	videoTranscriber = services.NewOpenAITranscriber(
		videoLearningCfg.TranscriptionBaseURL,
		apiKey,
		videoLearningCfg.TranscriptionModel,
		videoLearningCfg.ProcessingTimeoutSeconds,
		videoLearningCfg.MaxAudioUploadMB,
	)
}

func ListVideoLessons(c *gin.Context) {
	userID := currentUserID(c)
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	if pageSize > 50 {
		pageSize = 50
	}

	query := database.DB.Model(&models.VideoLesson{}).Where("user_id = ?", userID)
	status := strings.TrimSpace(c.Query("status"))
	if status != "" {
		query = query.Where("status = ?", status)
	}
	search := strings.TrimSpace(c.Query("search"))
	if search != "" {
		query = query.Where("title ILIKE ?", "%"+search+"%")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count video lessons"})
		return
	}

	var lessons []models.VideoLesson
	if err := query.Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&lessons).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load video lessons"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": lessons,
		"pagination": gin.H{
			"page":       page,
			"page_size":  pageSize,
			"total":      total,
			"total_page": int((total + int64(pageSize) - 1) / int64(pageSize)),
		},
	})
}

func CreateVideoLesson(c *gin.Context) {
	if !videoLearningCfg.Enabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "Video learning is disabled"})
		return
	}

	userID := currentUserID(c)
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Video or audio file is required"})
		return
	}
	if err := validateVideoUpload(file); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	relativePath, absolutePath, err := buildUserStoragePath(videoLearningCfg.StorageDir, userID, filepath.Ext(file.Filename))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare storage path"})
		return
	}
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create storage directory"})
		return
	}
	if err := c.SaveUploadedFile(file, absolutePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save uploaded file"})
		return
	}

	title := strings.TrimSpace(c.PostForm("title"))
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(file.Filename), filepath.Ext(file.Filename))
	}
	if title == "" {
		title = "Untitled video"
	}

	lesson := models.VideoLesson{
		UserID:           userID,
		Title:            title,
		Description:      strings.TrimSpace(c.PostForm("description")),
		Source:           strings.TrimSpace(c.PostForm("source")),
		SourceURL:        strings.TrimSpace(c.PostForm("source_url")),
		OriginalFilename: file.Filename,
		VideoPath:        storageURL(relativePath),
		FileSizeBytes:    file.Size,
		MimeType:         file.Header.Get("Content-Type"),
		Language:         firstNonEmptyVideoValue(strings.TrimSpace(c.PostForm("language")), "en"),
		Status:           videoStatusUploaded,
		Progress:         0,
	}

	if err := database.DB.Create(&lesson).Error; err != nil {
		_ = os.Remove(absolutePath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create video lesson"})
		return
	}

	if formBool(c.PostForm("auto_process"), true) {
		job := models.VideoProcessingJob{VideoLessonID: lesson.ID, Status: "queued"}
		if err := database.DB.Create(&job).Error; err == nil {
			go processVideoLessonJob(lesson.ID, job.ID)
		}
	}

	c.JSON(http.StatusCreated, gin.H{"data": lesson})
}

func GetVideoLesson(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": lesson})
}

func DeleteVideoLesson(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}

	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("video_lesson_id = ?", lesson.ID).Delete(&models.VideoSubtitle{}).Error; err != nil {
			return err
		}
		if err := tx.Where("video_lesson_id = ?", lesson.ID).Delete(&models.VideoProcessingJob{}).Error; err != nil {
			return err
		}
		return tx.Delete(&lesson).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete video lesson"})
		return
	}

	removeStoredFile(lesson.VideoPath)
	removeStoredFile(lesson.AudioPath)
	removeStoredFile(lesson.TranscriptPath)

	c.JSON(http.StatusOK, gin.H{"message": "Video lesson deleted"})
}

func ProcessVideoLesson(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}
	if lesson.Status == videoStatusExtractingAudio || lesson.Status == videoStatusTranscribing || lesson.Status == videoStatusSegmenting {
		c.JSON(http.StatusConflict, gin.H{"error": "Video lesson is already processing"})
		return
	}

	job := models.VideoProcessingJob{VideoLessonID: lesson.ID, Status: "queued"}
	if err := database.DB.Create(&job).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create processing job"})
		return
	}
	go processVideoLessonJob(lesson.ID, job.ID)

	lesson.Status = videoStatusUploaded
	lesson.Progress = 0
	lesson.Error = ""
	c.JSON(http.StatusOK, gin.H{"data": lesson})
}

func ListVideoSubtitles(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}

	var subtitles []models.VideoSubtitle
	if err := database.DB.Where("video_lesson_id = ?", lesson.ID).
		Order("sort_order ASC").
		Find(&subtitles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load subtitles"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": subtitles})
}

func ImportVideoSubtitles(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Subtitle file is required"})
		return
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".srt" && ext != ".vtt" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only .srt and .vtt subtitle files are supported"})
		return
	}
	if file.Size > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Subtitle file must be 5 MB or smaller"})
		return
	}

	content, err := readMultipartFile(file, 5*1024*1024)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read subtitle file"})
		return
	}

	segments, err := services.ParseSubtitleFile(file.Filename, content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := replaceVideoSubtitles(lesson.ID, segments, subtitleSourceImported); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to import subtitles"})
		return
	}

	lesson.Status = videoStatusReady
	lesson.Progress = 100
	lesson.Error = ""
	if err := database.DB.Save(&lesson).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update video lesson"})
		return
	}

	var subtitles []models.VideoSubtitle
	_ = database.DB.Where("video_lesson_id = ?", lesson.ID).Order("sort_order ASC").Find(&subtitles).Error
	c.JSON(http.StatusOK, gin.H{"data": subtitles})
}

func CreateVideoSubtitle(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}

	var req struct {
		StartSeconds float64 `json:"start_seconds" binding:"required,min=0"`
		EndSeconds   float64 `json:"end_seconds" binding:"required,min=0"`
		Text         string  `json:"text" binding:"required"`
		Translation  string  `json:"translation"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.EndSeconds <= req.StartSeconds {
		c.JSON(http.StatusBadRequest, gin.H{"error": "end_seconds must be greater than start_seconds"})
		return
	}

	var maxOrder int
	_ = database.DB.Model(&models.VideoSubtitle{}).
		Where("video_lesson_id = ?", lesson.ID).
		Select("COALESCE(MAX(sort_order), 0)").
		Scan(&maxOrder).Error

	subtitle := models.VideoSubtitle{
		VideoLessonID: lesson.ID,
		SortOrder:     maxOrder + 1,
		StartSeconds:  req.StartSeconds,
		EndSeconds:    req.EndSeconds,
		Text:          strings.TrimSpace(req.Text),
		Translation:   strings.TrimSpace(req.Translation),
		Source:        subtitleSourceManual,
	}
	if err := database.DB.Create(&subtitle).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create subtitle"})
		return
	}
	reorderVideoSubtitles(lesson.ID)
	c.JSON(http.StatusCreated, gin.H{"data": subtitle})
}

func UpdateVideoSubtitle(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}
	subtitleID, err := strconv.ParseUint(c.Param("subtitle_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid subtitle id"})
		return
	}

	var subtitle models.VideoSubtitle
	if err := database.DB.Where("id = ? AND video_lesson_id = ?", subtitleID, lesson.ID).First(&subtitle).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subtitle not found"})
		return
	}

	var req struct {
		StartSeconds *float64 `json:"start_seconds"`
		EndSeconds   *float64 `json:"end_seconds"`
		Text         *string  `json:"text"`
		Translation  *string  `json:"translation"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.StartSeconds != nil {
		subtitle.StartSeconds = *req.StartSeconds
	}
	if req.EndSeconds != nil {
		subtitle.EndSeconds = *req.EndSeconds
	}
	if subtitle.EndSeconds <= subtitle.StartSeconds {
		c.JSON(http.StatusBadRequest, gin.H{"error": "end_seconds must be greater than start_seconds"})
		return
	}
	if req.Text != nil {
		subtitle.Text = strings.TrimSpace(*req.Text)
	}
	if subtitle.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "text is required"})
		return
	}
	if req.Translation != nil {
		subtitle.Translation = strings.TrimSpace(*req.Translation)
	}
	subtitle.Source = subtitleSourceEdited

	if err := database.DB.Save(&subtitle).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update subtitle"})
		return
	}
	reorderVideoSubtitles(lesson.ID)
	c.JSON(http.StatusOK, gin.H{"data": subtitle})
}

func DeleteVideoSubtitle(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}
	subtitleID, err := strconv.ParseUint(c.Param("subtitle_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid subtitle id"})
		return
	}

	result := database.DB.Where("id = ? AND video_lesson_id = ?", subtitleID, lesson.ID).Delete(&models.VideoSubtitle{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete subtitle"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subtitle not found"})
		return
	}
	reorderVideoSubtitles(lesson.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Subtitle deleted"})
}

func ReorderVideoSubtitles(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}
	if err := reorderVideoSubtitles(lesson.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reorder subtitles"})
		return
	}
	var subtitles []models.VideoSubtitle
	_ = database.DB.Where("video_lesson_id = ?", lesson.ID).Order("sort_order ASC").Find(&subtitles).Error
	c.JSON(http.StatusOK, gin.H{"data": subtitles})
}

func UpdateVideoLessonProgress(c *gin.Context) {
	lesson, ok := loadOwnedVideoLesson(c)
	if !ok {
		return
	}

	var req struct {
		LastPositionSeconds float64 `json:"last_position_seconds" binding:"min=0"`
		Completed           bool    `json:"completed"`
		WatchedSeconds      int     `json:"watched_seconds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	lesson.LastPositionSeconds = req.LastPositionSeconds
	completedNow := false
	if req.Completed && lesson.CompletedAt == nil {
		now := time.Now()
		lesson.CompletedAt = &now
		completedNow = true
	}

	if err := database.DB.Save(&lesson).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update progress"})
		return
	}
	if req.WatchedSeconds > 0 || completedNow {
		addStudyReadTime(lesson.UserID, req.WatchedSeconds, completedNow)
	}

	c.JSON(http.StatusOK, gin.H{"data": lesson})
}

func processVideoLessonJob(lessonID, jobID uint) {
	now := time.Now()
	database.DB.Model(&models.VideoProcessingJob{}).Where("id = ?", jobID).Updates(map[string]interface{}{
		"status":     "running",
		"attempts":   gorm.Expr("attempts + 1"),
		"started_at": &now,
	})

	var lesson models.VideoLesson
	if err := database.DB.First(&lesson, lessonID).Error; err != nil {
		failVideoJob(jobID, nil, "Video lesson not found")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(videoLearningCfg.ProcessingTimeoutSeconds)*time.Second)
	defer cancel()

	absoluteVideoPath, err := storageAbsolutePath(lesson.VideoPath)
	if err != nil {
		failVideoJob(jobID, &lesson, err.Error())
		return
	}

	updateVideoLessonStatus(lesson.ID, videoStatusExtractingAudio, 10, "")
	probe, err := videoMediaProcessor.Probe(ctx, absoluteVideoPath)
	if err != nil {
		failVideoJob(jobID, &lesson, err.Error())
		return
	}
	if probe.DurationSeconds > float64(videoLearningCfg.MaxDurationSeconds) {
		failVideoJob(jobID, &lesson, fmt.Sprintf("Video duration %.0f seconds exceeds limit %d seconds", probe.DurationSeconds, videoLearningCfg.MaxDurationSeconds))
		return
	}

	_, absoluteAudioPath, err := buildUserStoragePath(videoLearningCfg.AudioDir, lesson.UserID, ".mp3")
	if err != nil {
		failVideoJob(jobID, &lesson, "Failed to prepare audio path")
		return
	}
	if err := videoMediaProcessor.ExtractAudio(ctx, absoluteVideoPath, absoluteAudioPath); err != nil {
		failVideoJob(jobID, &lesson, err.Error())
		return
	}

	audioStorageURL := storageURL(toSlashRelative(absoluteAudioPath))
	updateVideoLessonStatus(lesson.ID, videoStatusTranscribing, 35, "")

	result, err := videoTranscriber.Transcribe(ctx, absoluteAudioPath, services.TranscribeOptions{
		Language: lesson.Language,
		Model:    videoLearningCfg.TranscriptionModel,
	})
	if err != nil {
		failVideoJob(jobID, &lesson, err.Error())
		return
	}
	if len(result.Segments) == 0 {
		failVideoJob(jobID, &lesson, "No speech segments were found")
		return
	}

	updateVideoLessonStatus(lesson.ID, videoStatusSegmenting, 80, "")
	transcriptURL := ""
	if len(result.RawJSON) > 0 {
		transcriptURL, _ = saveRawTranscript(lesson.UserID, result.RawJSON)
	}

	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("video_lesson_id = ?", lesson.ID).Delete(&models.VideoSubtitle{}).Error; err != nil {
			return err
		}
		subtitles := buildSubtitleModels(lesson.ID, result.Segments, subtitleSourceAuto)
		if err := tx.Create(&subtitles).Error; err != nil {
			return err
		}
		updates := map[string]interface{}{
			"status":           videoStatusReady,
			"progress":         100,
			"error":            "",
			"duration_seconds": firstPositiveFloat(probe.DurationSeconds, result.Duration),
			"audio_path":       audioStorageURL,
			"transcript_path":  transcriptURL,
		}
		if result.Language != "" {
			updates["language"] = result.Language
		}
		if err := tx.Model(&models.VideoLesson{}).Where("id = ?", lesson.ID).Updates(updates).Error; err != nil {
			return err
		}
		finishedAt := time.Now()
		return tx.Model(&models.VideoProcessingJob{}).Where("id = ?", jobID).Updates(map[string]interface{}{
			"status":      "succeeded",
			"last_error":  "",
			"finished_at": &finishedAt,
		}).Error
	}); err != nil {
		failVideoJob(jobID, &lesson, "Failed to save subtitles")
		return
	}
}

func validateVideoUpload(file *multipart.FileHeader) error {
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if !allowedVideoExtension(ext) {
		return fmt.Errorf("unsupported file type")
	}
	if file.Size <= 0 {
		return fmt.Errorf("empty file is not allowed")
	}
	maxBytes := int64(videoLearningCfg.MaxUploadMB) * 1024 * 1024
	if file.Size > maxBytes {
		return fmt.Errorf("file must be %d MB or smaller", videoLearningCfg.MaxUploadMB)
	}
	return nil
}

func allowedVideoExtension(ext string) bool {
	for _, allowed := range strings.Split(videoLearningCfg.AllowedExtensions, ",") {
		if strings.EqualFold(strings.TrimSpace(allowed), ext) {
			return true
		}
	}
	return false
}

func loadOwnedVideoLesson(c *gin.Context) (models.VideoLesson, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid video lesson id"})
		return models.VideoLesson{}, false
	}
	userID := currentUserID(c)
	var lesson models.VideoLesson
	if err := database.DB.Where("id = ? AND user_id = ?", id, userID).First(&lesson).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Video lesson not found"})
			return models.VideoLesson{}, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load video lesson"})
		return models.VideoLesson{}, false
	}
	return lesson, true
}

func currentUserID(c *gin.Context) uint {
	userID, _ := c.Get("user_id")
	return userID.(uint)
}

func buildUserStoragePath(root string, userID uint, ext string) (string, string, error) {
	token, err := randomHex(16)
	if err != nil {
		return "", "", err
	}
	relative := filepath.Join(root, strconv.FormatUint(uint64(userID), 10), token+strings.ToLower(ext))
	absolute := filepath.Clean(relative)
	return toSlashRelative(relative), absolute, nil
}

func storageURL(relative string) string {
	relative = strings.TrimPrefix(toSlashRelative(relative), "/")
	return "/" + relative
}

func storageAbsolutePath(storagePath string) (string, error) {
	path := strings.TrimPrefix(storagePath, "/")
	path = filepath.Clean(path)
	if !strings.HasPrefix(path, "storage"+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid storage path")
	}
	return path, nil
}

func toSlashRelative(path string) string {
	return filepath.ToSlash(strings.TrimPrefix(path, "./"))
}

func removeStoredFile(storagePath string) {
	if strings.TrimSpace(storagePath) == "" {
		return
	}
	path, err := storageAbsolutePath(storagePath)
	if err != nil {
		return
	}
	_ = os.Remove(path)
}

func formBool(value string, defaultValue bool) bool {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return defaultValue
	}
	return value == "true" || value == "1" || value == "yes"
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func readMultipartFile(file *multipart.FileHeader, limit int64) ([]byte, error) {
	opened, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer opened.Close()
	return io.ReadAll(io.LimitReader(opened, limit+1))
}

func replaceVideoSubtitles(lessonID uint, segments []services.TranscriptionSegment, source string) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("video_lesson_id = ?", lessonID).Delete(&models.VideoSubtitle{}).Error; err != nil {
			return err
		}
		subtitles := buildSubtitleModels(lessonID, segments, source)
		if len(subtitles) == 0 {
			return fmt.Errorf("no subtitles to save")
		}
		return tx.Create(&subtitles).Error
	})
}

func buildSubtitleModels(lessonID uint, segments []services.TranscriptionSegment, source string) []models.VideoSubtitle {
	cleaned := services.CleanTranscriptionSegments(segments)
	subtitles := make([]models.VideoSubtitle, 0, len(cleaned))
	for index, segment := range cleaned {
		subtitles = append(subtitles, models.VideoSubtitle{
			VideoLessonID: lessonID,
			SortOrder:     index + 1,
			StartSeconds:  segment.StartSeconds,
			EndSeconds:    segment.EndSeconds,
			Text:          segment.Text,
			Confidence:    segment.Confidence,
			Source:        source,
		})
	}
	return subtitles
}

func reorderVideoSubtitles(lessonID uint) error {
	var subtitles []models.VideoSubtitle
	if err := database.DB.Where("video_lesson_id = ?", lessonID).
		Order("start_seconds ASC, id ASC").
		Find(&subtitles).Error; err != nil {
		return err
	}
	return database.DB.Transaction(func(tx *gorm.DB) error {
		for index := range subtitles {
			if subtitles[index].SortOrder == index+1 {
				continue
			}
			if err := tx.Model(&subtitles[index]).Update("sort_order", index+1).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func updateVideoLessonStatus(lessonID uint, status string, progress int, errText string) {
	database.DB.Model(&models.VideoLesson{}).Where("id = ?", lessonID).Updates(map[string]interface{}{
		"status":   status,
		"progress": progress,
		"error":    errText,
	})
}

func failVideoJob(jobID uint, lesson *models.VideoLesson, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "Video processing failed"
	}
	finishedAt := time.Now()
	database.DB.Model(&models.VideoProcessingJob{}).Where("id = ?", jobID).Updates(map[string]interface{}{
		"status":      "failed",
		"last_error":  message,
		"finished_at": &finishedAt,
	})
	if lesson != nil {
		updateVideoLessonStatus(lesson.ID, videoStatusFailed, 0, message)
	}
}

func saveRawTranscript(userID uint, raw []byte) (string, error) {
	if !json.Valid(raw) {
		return "", nil
	}
	relative, absolute, err := buildUserStoragePath(videoLearningCfg.TranscriptDir, userID, ".json")
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0755); err != nil {
		return "", err
	}
	if err := os.WriteFile(absolute, raw, 0644); err != nil {
		return "", err
	}
	return storageURL(relative), nil
}

func firstPositiveFloat(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func firstNonEmptyVideoValue(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

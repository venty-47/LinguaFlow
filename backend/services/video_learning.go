package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"gugudu-backend/config"
	"gugudu-backend/models"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

var ErrVideoLessonProcessing = errors.New("video lesson is already processing")
var processingLessons sync.Map

type VideoLearningService struct {
	db                 *gorm.DB
	cfg                config.VideoLearningConfig
	client             *http.Client
	translationService *TranslationService
}

type VideoLessonCreateRequest struct {
	UserID      uint
	Title       string
	Description string
	Language    string
	File        *multipart.FileHeader
}

type VideoProgressRequest struct {
	PositionSeconds float64 `json:"position_seconds"`
	Completed       bool    `json:"completed"`
}

type VideoSubtitleTranslateRequest struct {
	TargetLang string `json:"target_lang"`
	SourceLang string `json:"source_lang"`
	Force      bool   `json:"force"`
}

type VideoSubtitleTranslateResult struct {
	Translated int `json:"translated"`
	Skipped    int `json:"skipped"`
	Failed     int `json:"failed"`
}

type VideoSubtitleUpdateRequest struct {
	StartSeconds *float64 `json:"start_seconds"`
	EndSeconds   *float64 `json:"end_seconds"`
	Text         *string  `json:"text"`
	Translation  *string  `json:"translation"`
}

type Transcript struct {
	Task     string              `json:"task,omitempty"`
	Language string              `json:"language,omitempty"`
	Duration float64             `json:"duration,omitempty"`
	Text     string              `json:"text"`
	Segments []TranscriptSegment `json:"segments"`
}

type TranscriptSegment struct {
	Start            float64 `json:"start"`
	End              float64 `json:"end"`
	Text             string  `json:"text"`
	Confidence       float64 `json:"confidence,omitempty"`
	AvgLogprob       float64 `json:"avg_logprob,omitempty"`
	NoSpeechProb     float64 `json:"no_speech_prob,omitempty"`
	CompressionRatio float64 `json:"compression_ratio,omitempty"`
}

type openAITranscriptionResponse struct {
	Task     string  `json:"task"`
	Language string  `json:"language"`
	Duration float64 `json:"duration"`
	Text     string  `json:"text"`
	Segments []struct {
		ID               int     `json:"id"`
		Start            float64 `json:"start"`
		End              float64 `json:"end"`
		Text             string  `json:"text"`
		AvgLogprob       float64 `json:"avg_logprob"`
		NoSpeechProb     float64 `json:"no_speech_prob"`
		CompressionRatio float64 `json:"compression_ratio"`
	} `json:"segments"`
}

func NewVideoLearningService(db *gorm.DB, cfg config.VideoLearningConfig) *VideoLearningService {
	if cfg.StorageDir == "" {
		cfg.StorageDir = "storage/videos"
	}
	if cfg.AudioDir == "" {
		cfg.AudioDir = "storage/video-audio"
	}
	if cfg.TranscriptDir == "" {
		cfg.TranscriptDir = "storage/video-transcripts"
	}
	if cfg.MaxUploadMB <= 0 {
		cfg.MaxUploadMB = 300
	}
	if cfg.MaxDurationSeconds <= 0 {
		cfg.MaxDurationSeconds = 3600
	}
	if cfg.AllowedExtensions == "" {
		cfg.AllowedExtensions = ".mp4,.mov,.m4v,.webm,.mp3,.m4a"
	}
	if cfg.ProcessingTimeoutSeconds <= 0 {
		cfg.ProcessingTimeoutSeconds = 1800
	}
	if cfg.TranscriptionBaseURL == "" {
		cfg.TranscriptionBaseURL = "http://localhost:8899/v1"
	}
	if cfg.TranscriptionModel == "" {
		cfg.TranscriptionModel = "faster-whisper-large-v3"
	}

	return &VideoLearningService{
		db:                 db,
		cfg:                cfg,
		translationService: nil,
		client: &http.Client{
			Timeout: time.Duration(cfg.ProcessingTimeoutSeconds) * time.Second,
		},
	}
}

func (s *VideoLearningService) SetTranslationService(ts *TranslationService) {
	s.translationService = ts
}

func (s *VideoLearningService) IsConfigured() bool {
	return s != nil && s.cfg.Enabled
}

func (s *VideoLearningService) CreateLesson(ctx context.Context, req VideoLessonCreateRequest) (*models.VideoLesson, error) {
	if !s.IsConfigured() {
		return nil, fmt.Errorf("视频学习服务未启用")
	}
	if req.File == nil {
		return nil, fmt.Errorf("请选择视频或音频文件")
	}
	if req.File.Size <= 0 {
		return nil, fmt.Errorf("文件为空")
	}
	if req.File.Size > int64(s.cfg.MaxUploadMB)*1024*1024 {
		return nil, fmt.Errorf("文件过大，最多 %d MB", s.cfg.MaxUploadMB)
	}

	ext := strings.ToLower(filepath.Ext(req.File.Filename))
	if !s.isAllowedExtension(ext) {
		return nil, fmt.Errorf("不支持的文件格式")
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(req.File.Filename), ext)
	}
	if len([]rune(title)) > 300 {
		title = string([]rune(title)[:300])
	}
	language := strings.TrimSpace(req.Language)
	if language == "" {
		language = "en"
	}

	userDir := filepath.Join(s.cfg.StorageDir, strconv.FormatUint(uint64(req.UserID), 10))
	if err := os.MkdirAll(userDir, 0755); err != nil {
		return nil, fmt.Errorf("创建视频目录失败: %w", err)
	}

	id := stableUploadID(req.UserID, req.File.Filename, req.File.Size, time.Now())
	videoPath := filepath.Join(userDir, id+ext)
	if err := saveMultipartFile(req.File, videoPath); err != nil {
		return nil, fmt.Errorf("保存视频失败: %w", err)
	}

	duration := 0.0
	if probed, err := probeDuration(ctx, videoPath, 20*time.Second); err == nil {
		duration = roundMillis(probed)
		if s.cfg.MaxDurationSeconds > 0 && duration > float64(s.cfg.MaxDurationSeconds) {
			_ = os.Remove(videoPath)
			return nil, fmt.Errorf("视频过长，最多 %d 秒", s.cfg.MaxDurationSeconds)
		}
	}

	lesson := models.VideoLesson{
		UserID:           req.UserID,
		Title:            title,
		Description:      strings.TrimSpace(req.Description),
		Source:           "upload",
		OriginalFilename: filepath.Base(req.File.Filename),
		VideoPath:        filepath.ToSlash(videoPath),
		DurationSeconds:  duration,
		FileSizeBytes:    req.File.Size,
		MimeType:         req.File.Header.Get("Content-Type"),
		Language:         language,
		Status:           "uploaded",
		Progress:         0,
	}

	if err := s.db.WithContext(ctx).Create(&lesson).Error; err != nil {
		_ = os.Remove(videoPath)
		return nil, fmt.Errorf("创建视频记录失败: %w", err)
	}

	go s.ProcessLesson(context.Background(), lesson.ID)
	return &lesson, nil
}

func (s *VideoLearningService) ProcessLesson(ctx context.Context, lessonID uint) {
	if s == nil {
		return
	}
	if _, loaded := processingLessons.LoadOrStore(lessonID, true); loaded {
		return
	}
	defer processingLessons.Delete(lessonID)

	ctx, cancel := context.WithTimeout(ctx, time.Duration(s.cfg.ProcessingTimeoutSeconds)*time.Second)
	defer cancel()

	var lesson models.VideoLesson
	if err := s.db.WithContext(ctx).First(&lesson, lessonID).Error; err != nil {
		return
	}
	if lesson.Status == "cancelled" || lesson.Status == "ready" {
		return
	}

	fail := func(format string, args ...interface{}) {
		msg := fmt.Sprintf(format, args...)
		_ = s.db.Model(&models.VideoLesson{}).Where("id = ?", lessonID).Updates(map[string]interface{}{
			"status": "failed",
			"error":  msg,
		}).Error
	}

	s.updateLessonState(lessonID, "extracting_audio", 10, "")
	audioPath, err := s.extractAudio(ctx, lesson)
	if err != nil {
		fail("抽取音频失败: %v", err)
		return
	}

	s.updateLessonState(lessonID, "transcribing", 35, "")
	transcript, err := s.transcribe(ctx, audioPath, lesson.Language)
	if err != nil {
		fail("字幕识别失败: %v", err)
		return
	}
	transcriptPath, err := s.saveTranscript(lesson.UserID, lessonID, transcript)
	if err != nil {
		fail("保存识别结果失败: %v", err)
		return
	}

	s.updateLessonState(lessonID, "segmenting", 80, "")
	subtitles := BuildVideoSubtitles(lessonID, transcript, lesson.DurationSeconds)
	if len(subtitles) == 0 {
		fail("没有识别到可用字幕")
		return
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Where("video_lesson_id = ? AND source = ?", lessonID, "auto").Delete(&models.VideoSubtitle{}).Error; err != nil {
			return err
		}
		if err := tx.Create(&subtitles).Error; err != nil {
			return err
		}
		return tx.Model(&models.VideoLesson{}).Where("id = ?", lessonID).Updates(map[string]interface{}{
			"audio_path":       filepath.ToSlash(audioPath),
			"transcript_path":  filepath.ToSlash(transcriptPath),
			"duration_seconds": maxFloat64(lesson.DurationSeconds, roundMillis(transcript.Duration)),
			"status":           "ready",
			"progress":         100,
			"error":            "",
		}).Error
	})
	if err != nil {
		fail("保存字幕失败: %v", err)
	}
}

func (s *VideoLearningService) ListLessons(ctx context.Context, userID uint, status string, page, pageSize int) ([]models.VideoLesson, int64, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 50 {
		pageSize = 50
	}

	query := s.db.WithContext(ctx).Model(&models.VideoLesson{}).Where("user_id = ?", userID)
	if status = strings.TrimSpace(status); status != "" {
		query = query.Where("status = ?", status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var lessons []models.VideoLesson
	err := query.Order("updated_at DESC").
		Limit(pageSize).
		Offset((page - 1) * pageSize).
		Find(&lessons).Error
	return lessons, total, err
}

func (s *VideoLearningService) GetLesson(ctx context.Context, userID, lessonID uint) (*models.VideoLesson, error) {
	var lesson models.VideoLesson
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", lessonID, userID).First(&lesson).Error; err != nil {
		return nil, err
	}
	return &lesson, nil
}

func (s *VideoLearningService) DeleteLesson(ctx context.Context, userID, lessonID uint) error {
	var lesson models.VideoLesson
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", lessonID, userID).First(&lesson).Error; err != nil {
		return err
	}

	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Where("video_lesson_id = ?", lesson.ID).Delete(&models.VideoSubtitle{}).Error; err != nil {
			return err
		}
		return tx.Delete(&lesson).Error
	}); err != nil {
		return err
	}

	s.removeLessonFiles(lesson)
	return nil
}

func (s *VideoLearningService) RegenerateSubtitles(ctx context.Context, userID, lessonID uint) (*models.VideoLesson, error) {
	var lesson models.VideoLesson
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", lessonID, userID).First(&lesson).Error; err != nil {
		return nil, err
	}
	if isVideoLessonProcessing(lesson.Status) {
		return nil, ErrVideoLessonProcessing
	}

	if err := s.db.WithContext(ctx).Model(&lesson).Updates(map[string]interface{}{
		"status":   "uploaded",
		"progress": 0,
		"error":    "",
	}).Error; err != nil {
		return nil, err
	}

	go s.ProcessLesson(context.Background(), lesson.ID)
	return s.GetLesson(ctx, userID, lessonID)
}

func (s *VideoLearningService) GetSubtitles(ctx context.Context, userID, lessonID uint) ([]models.VideoSubtitle, error) {
	if _, err := s.GetLesson(ctx, userID, lessonID); err != nil {
		return nil, err
	}

	var subtitles []models.VideoSubtitle
	err := s.db.WithContext(ctx).
		Where("video_lesson_id = ?", lessonID).
		Order("sort_order ASC, start_seconds ASC").
		Find(&subtitles).Error
	return subtitles, err
}

func (s *VideoLearningService) UpdateProgress(ctx context.Context, userID, lessonID uint, req VideoProgressRequest) (*models.VideoLesson, error) {
	lesson, err := s.GetLesson(ctx, userID, lessonID)
	if err != nil {
		return nil, err
	}

	if req.PositionSeconds < 0 {
		req.PositionSeconds = 0
	}
	updates := map[string]interface{}{
		"last_position_seconds": req.PositionSeconds,
	}
	if req.Completed {
		now := time.Now()
		updates["completed_at"] = &now
	}

	if err := s.db.WithContext(ctx).Model(lesson).Updates(updates).Error; err != nil {
		return nil, err
	}
	return s.GetLesson(ctx, userID, lessonID)
}

func (s *VideoLearningService) VTT(ctx context.Context, userID, lessonID uint, track string) (string, error) {
	subtitles, err := s.GetSubtitles(ctx, userID, lessonID)
	if err != nil {
		return "", err
	}
	return SubtitlesToVTT(subtitles, track), nil
}

func (s *VideoLearningService) TranslateSubtitles(ctx context.Context, userID, lessonID uint, req VideoSubtitleTranslateRequest) (*VideoSubtitleTranslateResult, error) {
	if s.translationService == nil || len(s.translationService.providers) == 0 {
		return nil, fmt.Errorf("翻译服务未配置")
	}

	lesson, err := s.GetLesson(ctx, userID, lessonID)
	if err != nil {
		return nil, err
	}

	if req.SourceLang == "" {
		req.SourceLang = lesson.Language
		if req.SourceLang == "" {
			req.SourceLang = "en"
		}
	}

	var subtitles []models.VideoSubtitle
	query := s.db.WithContext(ctx).Where("video_lesson_id = ?", lessonID).Order("sort_order ASC")
	if !req.Force {
		query = query.Where("(translation = ? OR translation IS NULL)", "")
	}
	if err := query.Find(&subtitles).Error; err != nil {
		return nil, err
	}

	result := &VideoSubtitleTranslateResult{}
	batchSize := 20
	for i := 0; i < len(subtitles); i += batchSize {
		if err := ctx.Err(); err != nil {
			break
		}
		end := i + batchSize
		if end > len(subtitles) {
			end = len(subtitles)
		}
		batch := subtitles[i:end]

		for j := range batch {
			if err := ctx.Err(); err != nil {
				break
			}
			if strings.TrimSpace(batch[j].Text) == "" {
				result.Skipped++
				continue
			}

			translation, _, err := s.translationService.Translate(batch[j].Text, req.SourceLang, req.TargetLang)
			if err != nil {
				result.Failed++
				continue
			}

			if err := s.db.WithContext(ctx).Model(&batch[j]).Update("translation", translation).Error; err != nil {
				result.Failed++
			} else {
				result.Translated++
			}
		}
	}

	return result, nil
}

func (s *VideoLearningService) UpdateSubtitle(ctx context.Context, userID, lessonID, subtitleID uint, req VideoSubtitleUpdateRequest) (*models.VideoSubtitle, error) {
	if _, err := s.GetLesson(ctx, userID, lessonID); err != nil {
		return nil, err
	}

	var subtitle models.VideoSubtitle
	if err := s.db.WithContext(ctx).Where("id = ? AND video_lesson_id = ?", subtitleID, lessonID).First(&subtitle).Error; err != nil {
		return nil, err
	}

	updates := make(map[string]interface{})
	if req.StartSeconds != nil {
		if *req.StartSeconds < 0 {
			return nil, fmt.Errorf("开始时间不能小于0")
		}
		updates["start_seconds"] = *req.StartSeconds
	}
	if req.EndSeconds != nil {
		if *req.EndSeconds <= 0 {
			return nil, fmt.Errorf("结束时间必须大于0")
		}
		updates["end_seconds"] = *req.EndSeconds
	}
	if req.StartSeconds != nil && req.EndSeconds != nil && *req.EndSeconds <= *req.StartSeconds {
		return nil, fmt.Errorf("结束时间必须大于开始时间")
	}
	if req.Text != nil {
		text := strings.TrimSpace(*req.Text)
		if text == "" {
			return nil, fmt.Errorf("字幕文本不能为空")
		}
		updates["text"] = text
		updates["source"] = "edited"
	}
	if req.Translation != nil {
		updates["translation"] = strings.TrimSpace(*req.Translation)
		if subtitle.Source != "edited" {
			updates["source"] = "edited"
		}
	}

	if len(updates) > 0 {
		if err := s.db.WithContext(ctx).Model(&subtitle).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	if err := s.db.WithContext(ctx).First(&subtitle, subtitleID).Error; err != nil {
		return nil, err
	}
	return &subtitle, nil
}

func (s *VideoLearningService) updateLessonState(lessonID uint, status string, progress int, errorText string) {
	updates := map[string]interface{}{
		"status":   status,
		"progress": progress,
	}
	if errorText != "" {
		updates["error"] = errorText
	}
	_ = s.db.Model(&models.VideoLesson{}).Where("id = ?", lessonID).Updates(updates).Error
}

func isVideoLessonProcessing(status string) bool {
	switch status {
	case "uploaded", "extracting_audio", "transcribing", "segmenting":
		return true
	default:
		return false
	}
}

func (s *VideoLearningService) removeLessonFiles(lesson models.VideoLesson) {
	roots := []string{s.cfg.StorageDir, s.cfg.AudioDir, s.cfg.TranscriptDir}
	removeManagedFile(lesson.VideoPath, roots...)
	removeManagedFile(lesson.AudioPath, roots...)
	removeManagedFile(lesson.TranscriptPath, roots...)
}

func (s *VideoLearningService) extractAudio(ctx context.Context, lesson models.VideoLesson) (string, error) {
	userDir := filepath.Join(s.cfg.AudioDir, strconv.FormatUint(uint64(lesson.UserID), 10))
	if err := os.MkdirAll(userDir, 0755); err != nil {
		return "", err
	}
	audioPath := filepath.Join(userDir, hashString(fmt.Sprintf("%d:%s", lesson.ID, lesson.VideoPath))+".wav")
	if _, err := os.Stat(audioPath); err == nil {
		return audioPath, nil
	}

	cmd := exec.CommandContext(ctx, "ffmpeg", "-y", "-i", lesson.VideoPath, "-vn", "-ac", "1", "-ar", "16000", audioPath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		_ = os.Remove(audioPath)
		return "", fmt.Errorf("%w: %s", err, trimForLog(stderr.String(), 500))
	}
	return audioPath, nil
}

func (s *VideoLearningService) transcribe(ctx context.Context, audioPath, language string) (*Transcript, error) {
	if s.cfg.TranscriptionBaseURL == "" {
		return nil, fmt.Errorf("ASR 服务地址未配置")
	}

	file, err := os.Open(audioPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filepath.Base(audioPath))
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, err
	}
	_ = writer.WriteField("model", s.cfg.TranscriptionModel)
	_ = writer.WriteField("response_format", "verbose_json")
	if language != "" {
		_ = writer.WriteField("language", language)
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}

	url := strings.TrimRight(s.cfg.TranscriptionBaseURL, "/") + "/audio/transcriptions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if s.cfg.TranscriptionAPIKey != "" {
		req.Header.Set("Authorization", "Bearer "+s.cfg.TranscriptionAPIKey)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ASR HTTP %d: %s", resp.StatusCode, trimForLog(string(data), 500))
	}

	var raw openAITranscriptionResponse
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("解析 ASR 响应失败: %w", err)
	}

	transcript := &Transcript{
		Task:     raw.Task,
		Language: firstNonEmptyString(raw.Language, language),
		Duration: raw.Duration,
		Text:     strings.TrimSpace(raw.Text),
		Segments: make([]TranscriptSegment, 0, len(raw.Segments)),
	}
	for _, segment := range raw.Segments {
		text := strings.TrimSpace(segment.Text)
		if text == "" || segment.End <= segment.Start {
			continue
		}
		confidence := 0.0
		if segment.AvgLogprob != 0 {
			confidence = 1 / (1 + (-segment.AvgLogprob))
		}
		transcript.Segments = append(transcript.Segments, TranscriptSegment{
			Start:            segment.Start,
			End:              segment.End,
			Text:             text,
			Confidence:       confidence,
			AvgLogprob:       segment.AvgLogprob,
			NoSpeechProb:     segment.NoSpeechProb,
			CompressionRatio: segment.CompressionRatio,
		})
	}
	return transcript, nil
}

func (s *VideoLearningService) saveTranscript(userID, lessonID uint, transcript *Transcript) (string, error) {
	userDir := filepath.Join(s.cfg.TranscriptDir, strconv.FormatUint(uint64(userID), 10))
	if err := os.MkdirAll(userDir, 0755); err != nil {
		return "", err
	}
	path := filepath.Join(userDir, hashString(fmt.Sprintf("%d:%d", userID, lessonID))+".json")
	data, err := json.MarshalIndent(transcript, "", "  ")
	if err != nil {
		return "", err
	}
	return path, os.WriteFile(path, data, 0644)
}

func (s *VideoLearningService) isAllowedExtension(ext string) bool {
	for _, item := range strings.Split(s.cfg.AllowedExtensions, ",") {
		if strings.EqualFold(strings.TrimSpace(item), ext) {
			return true
		}
	}
	return false
}

func BuildVideoSubtitles(lessonID uint, transcript *Transcript, duration float64) []models.VideoSubtitle {
	if transcript == nil {
		return nil
	}

	segments := filterTranscriptHallucinations(transcript.Segments)
	if len(segments) == 0 && strings.TrimSpace(transcript.Text) != "" {
		segments = splitTranscriptText(transcript.Text, duration)
	}

	subtitles := make([]models.VideoSubtitle, 0, len(segments))
	for _, segment := range segments {
		text := cleanSubtitleText(segment.Text)
		if text == "" {
			continue
		}
		if segment.Start < 0 {
			segment.Start = 0
		}
		if segment.End <= segment.Start {
			segment.End = segment.Start + estimateCueDuration(text)
		}
		subtitles = append(subtitles, models.VideoSubtitle{
			VideoLessonID: lessonID,
			StartSeconds:  roundMillis(segment.Start),
			EndSeconds:    roundMillis(segment.End),
			Text:          text,
			Confidence:    segment.Confidence,
			Source:        "auto",
		})
	}

	sort.Slice(subtitles, func(i, j int) bool {
		return subtitles[i].StartSeconds < subtitles[j].StartSeconds
	})
	for i := range subtitles {
		if i > 0 && subtitles[i].StartSeconds < subtitles[i-1].EndSeconds {
			subtitles[i].StartSeconds = roundMillis(subtitles[i-1].EndSeconds + 0.02)
		}
		if subtitles[i].EndSeconds <= subtitles[i].StartSeconds {
			subtitles[i].EndSeconds = roundMillis(subtitles[i].StartSeconds + estimateCueDuration(subtitles[i].Text))
		}
		subtitles[i].SortOrder = i + 1
	}
	return subtitles
}

func filterTranscriptHallucinations(segments []TranscriptSegment) []TranscriptSegment {
	if len(segments) == 0 {
		return nil
	}

	filtered := make([]TranscriptSegment, 0, len(segments))
	lastKey := ""
	repeatCount := 0

	for _, segment := range segments {
		text := cleanSubtitleText(segment.Text)
		if text == "" {
			continue
		}

		key := normalizeSubtitleDedupeKey(text)
		if key == "" {
			continue
		}
		if key == lastKey {
			repeatCount++
		} else {
			lastKey = key
			repeatCount = 1
		}

		// Whisper may hallucinate by repeating the previous sentence across
		// long low-speech regions. Consecutive exact repeats are not useful
		// subtitles, so keep only the first occurrence.
		if repeatCount > 1 {
			continue
		}
		if segment.NoSpeechProb >= 0.85 && segment.AvgLogprob < -0.5 {
			continue
		}
		if segment.CompressionRatio > 3.0 {
			continue
		}

		segment.Text = text
		filtered = append(filtered, segment)
	}

	return filtered
}

func SubtitlesToVTT(subtitles []models.VideoSubtitle, track string) string {
	var b strings.Builder
	b.WriteString("WEBVTT\n\n")
	for _, subtitle := range subtitles {
		var text string
		switch track {
		case "zh":
			text = strings.TrimSpace(subtitle.Translation)
			if text == "" {
				text = strings.ReplaceAll(subtitle.Text, "\n", " ")
			}
		case "bilingual":
			text = strings.ReplaceAll(subtitle.Text, "\n", " ")
			if trans := strings.TrimSpace(subtitle.Translation); trans != "" {
				text += "\n" + trans
			}
		default: // "en"
			text = strings.ReplaceAll(subtitle.Text, "\n", " ")
		}
		b.WriteString(formatVTTTime(subtitle.StartSeconds))
		b.WriteString(" --> ")
		b.WriteString(formatVTTTime(subtitle.EndSeconds))
		b.WriteString("\n")
		b.WriteString(text)
		b.WriteString("\n\n")
	}
	return b.String()
}

func saveMultipartFile(header *multipart.FileHeader, dst string) error {
	src, err := header.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, src)
	return err
}

func removeManagedFile(path string, roots ...string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}

	absPath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return
	}
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		absRoot, err := filepath.Abs(filepath.Clean(root))
		if err != nil {
			continue
		}
		if absPath == absRoot || strings.HasPrefix(absPath, absRoot+string(os.PathSeparator)) {
			_ = os.Remove(absPath)
			return
		}
	}
}

func probeDuration(ctx context.Context, path string, timeout time.Duration) (float64, error) {
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path)
	out, err := cmd.Output()
	if err != nil {
		return 0, err
	}
	return strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
}

func splitTranscriptText(text string, duration float64) []TranscriptSegment {
	sentences := splitSentences(text)
	if len(sentences) == 0 {
		return nil
	}
	if duration <= 0 {
		duration = 4 * float64(len(sentences))
	}
	totalChars := 0
	for _, sentence := range sentences {
		totalChars += len([]rune(sentence))
	}
	if totalChars == 0 {
		totalChars = len(sentences)
	}

	segments := make([]TranscriptSegment, 0, len(sentences))
	cursor := 0.0
	for _, sentence := range sentences {
		share := float64(len([]rune(sentence))) / float64(totalChars)
		length := duration * share
		if length < 1.5 {
			length = 1.5
		}
		segments = append(segments, TranscriptSegment{
			Start:      cursor,
			End:        cursor + length,
			Text:       sentence,
			Confidence: 0,
		})
		cursor += length
	}
	return segments
}

func splitSentences(text string) []string {
	text = strings.TrimSpace(regexp.MustCompile(`\s+`).ReplaceAllString(text, " "))
	if text == "" {
		return nil
	}
	re := regexp.MustCompile(`[^.!?。！？]+[.!?。！？]?`)
	matches := re.FindAllString(text, -1)
	sentences := make([]string, 0, len(matches))
	for _, match := range matches {
		if cleaned := strings.TrimSpace(match); cleaned != "" {
			sentences = append(sentences, cleaned)
		}
	}
	if len(sentences) == 0 {
		return []string{text}
	}
	return sentences
}

func cleanSubtitleText(text string) string {
	text = strings.TrimSpace(text)
	text = regexp.MustCompile(`\s+`).ReplaceAllString(text, " ")
	return text
}

func normalizeSubtitleDedupeKey(text string) string {
	text = strings.ToLower(cleanSubtitleText(text))
	text = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

func estimateCueDuration(text string) float64 {
	duration := float64(len([]rune(text))) / 16
	if duration < 1.5 {
		return 1.5
	}
	if duration > 7 {
		return 7
	}
	return duration
}

func formatVTTTime(seconds float64) string {
	if seconds < 0 {
		seconds = 0
	}
	totalMillis := int64(seconds*1000 + 0.5)
	millis := totalMillis % 1000
	totalSeconds := totalMillis / 1000
	sec := totalSeconds % 60
	totalMinutes := totalSeconds / 60
	min := totalMinutes % 60
	hour := totalMinutes / 60
	return fmt.Sprintf("%02d:%02d:%02d.%03d", hour, min, sec, millis)
}

func stableUploadID(userID uint, filename string, size int64, now time.Time) string {
	return hashString(fmt.Sprintf("%d:%s:%d:%d", userID, filename, size, now.UnixNano()))
}

func hashString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func roundMillis(value float64) float64 {
	return float64(int64(value*1000+0.5)) / 1000
}

func trimForLog(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func maxFloat64(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

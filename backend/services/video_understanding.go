package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"gugudu-backend/models"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
)

type VideoUnderstandingService struct {
	db        *gorm.DB
	aiService *AIAnalysisService
}

type GenerateOptions struct {
	Force              bool
	IncludeVocabulary  bool
	IncludeKeyPoints   bool
}

type UnderstandingResult struct {
	SummaryEN   string          `json:"summary_en"`
	SummaryCN   string          `json:"summary_cn"`
	KeyPoints   []KeyPoint      `json:"key_points"`
	Vocabulary  []VocabItem     `json:"vocabulary"`
	Topics      []string        `json:"topics"`
	StudyGuide  string          `json:"study_guide"`
}

type KeyPoint struct {
	Timestamp float64 `json:"timestamp"`
	Title     string  `json:"title"`
	Content   string  `json:"content"`
}

type VocabItem struct {
	Word        string  `json:"word"`
	Translation string  `json:"translation"`
	Context     string  `json:"context"`
	Timestamp   float64 `json:"timestamp"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func NewVideoUnderstandingService(db *gorm.DB, aiService *AIAnalysisService) *VideoUnderstandingService {
	return &VideoUnderstandingService{
		db:        db,
		aiService: aiService,
	}
}

func (s *VideoUnderstandingService) GenerateUnderstanding(
	ctx context.Context,
	lesson *models.VideoLesson,
	subtitles []models.VideoSubtitle,
	userID uint,
	options GenerateOptions,
) (*models.VideoUnderstanding, error) {
	if s.aiService == nil {
		return nil, fmt.Errorf("AI 服务未启用")
	}

	var existing models.VideoUnderstanding
	err := s.db.WithContext(ctx).Where("video_lesson_id = ? AND user_id = ?", lesson.ID, userID).First(&existing).Error
	if err == nil && !options.Force {
		if time.Since(existing.GeneratedAt) < 7*24*time.Hour {
			return &existing, nil
		}
	}

	transcript := s.buildTranscript(subtitles)
	if len(transcript) > 50000 {
		return nil, fmt.Errorf("视频过长，暂不支持理解")
	}

	prompt := s.buildUnderstandingPrompt(transcript, options)
	response, err := s.callAI(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("AI 理解失败: %w", err)
	}

	result, err := s.parseUnderstandingResult(response)
	if err != nil {
		return nil, fmt.Errorf("解析结果失败: %w", err)
	}

	keyPointsJSON, _ := json.Marshal(result.KeyPoints)
	vocabularyJSON, _ := json.Marshal(result.Vocabulary)
	topicsJSON, _ := json.Marshal(result.Topics)

	now := time.Now()
	understanding := models.VideoUnderstanding{
		VideoLessonID: lesson.ID,
		UserID:        userID,
		SummaryEN:     result.SummaryEN,
		SummaryCN:     result.SummaryCN,
		KeyPoints:     string(keyPointsJSON),
		Vocabulary:    string(vocabularyJSON),
		Topics:        string(topicsJSON),
		StudyGuide:    result.StudyGuide,
		Provider:      "openai",
		Model:         s.aiService.Model,
		GeneratedAt:   now,
		TokensUsed:    estimateTokens(prompt + response),
	}

	if err == nil {
		understanding.ID = existing.ID
		understanding.RefreshedAt = &now
		if err := s.db.WithContext(ctx).Save(&understanding).Error; err != nil {
			return nil, err
		}
	} else {
		if err := s.db.WithContext(ctx).Create(&understanding).Error; err != nil {
			return nil, err
		}
	}

	return &understanding, nil
}

func (s *VideoUnderstandingService) GetUnderstanding(ctx context.Context, lessonID, userID uint) (*models.VideoUnderstanding, error) {
	var understanding models.VideoUnderstanding
	err := s.db.WithContext(ctx).Where("video_lesson_id = ? AND user_id = ?", lessonID, userID).First(&understanding).Error
	return &understanding, err
}

func (s *VideoUnderstandingService) ChatWithVideo(
	ctx context.Context,
	lesson *models.VideoLesson,
	understanding *models.VideoUnderstanding,
	messages []ChatMessage,
	userID uint,
) (string, error) {
	if s.aiService == nil {
		return "", fmt.Errorf("AI 服务未启用")
	}

	systemPrompt := s.buildChatSystemPrompt(understanding)
	fullPrompt := systemPrompt + "\n\nConversation:\n"
	for _, msg := range messages {
		fullPrompt += fmt.Sprintf("%s: %s\n", msg.Role, msg.Content)
	}

	response, err := s.callAI(ctx, fullPrompt)
	if err != nil {
		return "", err
	}

	for _, msg := range messages {
		s.db.WithContext(ctx).Create(&models.VideoConversation{
			VideoLessonID: lesson.ID,
			UserID:        userID,
			Role:          msg.Role,
			Content:       msg.Content,
			TokensUsed:    estimateTokens(msg.Content),
		})
	}

	s.db.WithContext(ctx).Create(&models.VideoConversation{
		VideoLessonID: lesson.ID,
		UserID:        userID,
		Role:          "assistant",
		Content:       response,
		TokensUsed:    estimateTokens(response),
	})

	return response, nil
}

func (s *VideoUnderstandingService) ChatWithVideoStream(
	ctx context.Context,
	lesson *models.VideoLesson,
	understanding *models.VideoUnderstanding,
	messages []ChatMessage,
	userID uint,
	onDelta func(string) error,
) error {
	if s.aiService == nil {
		return fmt.Errorf("AI 服务未启用")
	}

	chatMessages := s.buildChatMessages(understanding, messages)
	fullResponse := ""

	err := s.aiService.DiscussArticleStream(
		understanding.SummaryEN,
		understanding.SummaryCN,
		"",
		chatMessages,
		func(delta string) error {
			fullResponse += delta
			return onDelta(delta)
		},
	)

	if err != nil {
		return err
	}

	for _, msg := range messages {
		if msg.Role == "user" {
			s.db.WithContext(ctx).Create(&models.VideoConversation{
				VideoLessonID: lesson.ID,
				UserID:        userID,
				Role:          msg.Role,
				Content:       msg.Content,
				TokensUsed:    estimateTokens(msg.Content),
			})
		}
	}

	s.db.WithContext(ctx).Create(&models.VideoConversation{
		VideoLessonID: lesson.ID,
		UserID:        userID,
		Role:          "assistant",
		Content:       fullResponse,
		TokensUsed:    estimateTokens(fullResponse),
	})

	return nil
}

func (s *VideoUnderstandingService) buildChatMessages(understanding *models.VideoUnderstanding, messages []ChatMessage) []ArticleAssistantMessage {
	result := []ArticleAssistantMessage{
		{Role: "assistant", Content: "我已了解这个视频的内容。你可以问我视频观点、语言学习点或相关问题。"},
	}

	for _, msg := range messages {
		if msg.Role == "user" || msg.Role == "assistant" {
			result = append(result, ArticleAssistantMessage{
				Role:    msg.Role,
				Content: msg.Content,
			})
		}
	}

	return result
}

func (s *VideoUnderstandingService) GetConversations(ctx context.Context, lessonID, userID uint, limit int) ([]models.VideoConversation, error) {
	var conversations []models.VideoConversation
	err := s.db.WithContext(ctx).
		Where("video_lesson_id = ? AND user_id = ?", lessonID, userID).
		Order("created_at ASC").
		Limit(limit).
		Find(&conversations).Error
	return conversations, err
}

func (s *VideoUnderstandingService) ClearConversations(ctx context.Context, lessonID, userID uint) error {
	return s.db.WithContext(ctx).
		Where("video_lesson_id = ? AND user_id = ?", lessonID, userID).
		Delete(&models.VideoConversation{}).Error
}

func (s *VideoUnderstandingService) buildTranscript(subtitles []models.VideoSubtitle) string {
	var builder strings.Builder
	for _, sub := range subtitles {
		builder.WriteString(fmt.Sprintf("[%02d:%02d] %s\n",
			int(sub.StartSeconds)/60,
			int(sub.StartSeconds)%60,
			sub.Text,
		))
	}
	return builder.String()
}

func (s *VideoUnderstandingService) buildUnderstandingPrompt(transcript string, options GenerateOptions) string {
	return fmt.Sprintf(`You are an English learning assistant. Analyze the following video transcript and provide:

1. **Summary (English)**: A concise summary of the video content (100-150 words)
2. **Summary (Chinese)**: 中文摘要（100-150字）
3. **Key Points**: 3-5 key points with timestamps (format: MM:SS in transcript)
4. **Vocabulary**: 10-15 important words for English learners
5. **Topics**: 3-5 main topics covered
6. **Study Guide**: Learning recommendations (in Chinese, 50-100 words)

Video Transcript:
%s

Respond in JSON format:
{
  "summary_en": "...",
  "summary_cn": "...",
  "key_points": [{"timestamp": 12.5, "title": "...", "content": "..."}],
  "vocabulary": [{"word": "...", "translation": "...", "context": "...", "timestamp": 12.5}],
  "topics": ["topic1", "topic2"],
  "study_guide": "..."
}`, transcript)
}

func (s *VideoUnderstandingService) buildChatSystemPrompt(understanding *models.VideoUnderstanding) string {
	return fmt.Sprintf(`You are an English learning assistant helping a student understand a video.

Video Summary (English):
%s

Video Summary (Chinese):
%s

Key Points:
%s

Topics: %s

Answer the student's questions about the video clearly and educationally. Reference specific content when relevant. Respond in the same language as the user's question.`,
		understanding.SummaryEN,
		understanding.SummaryCN,
		understanding.KeyPoints,
		understanding.Topics,
	)
}

func (s *VideoUnderstandingService) parseUnderstandingResult(response string) (*UnderstandingResult, error) {
	response = strings.TrimSpace(response)
	if strings.HasPrefix(response, "```json") {
		response = strings.TrimPrefix(response, "```json")
		response = strings.TrimSuffix(response, "```")
		response = strings.TrimSpace(response)
	}

	var result UnderstandingResult
	if err := json.Unmarshal([]byte(response), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func estimateTokens(text string) int {
	return len(text) / 4
}

func (s *VideoUnderstandingService) callAI(ctx context.Context, prompt string) (string, error) {
	type chatMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type chatRequest struct {
		Model    string        `json:"model"`
		Messages []chatMessage `json:"messages"`
	}
	type chatResponse struct {
		Choices []struct {
			Message chatMessage `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	reqBody := chatRequest{
		Model: s.aiService.Model,
		Messages: []chatMessage{
			{Role: "user", Content: prompt},
		},
	}

	jsonData, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, "POST", s.aiService.BaseURL+"/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.aiService.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if result.Error != nil {
		return "", fmt.Errorf("AI API error: %s", result.Error.Message)
	}

	if len(result.Choices) == 0 {
		return "", fmt.Errorf("no response from AI")
	}

	return result.Choices[0].Message.Content, nil
}

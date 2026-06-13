package services

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type SentenceAnalysisResult struct {
	Sentence       string   `json:"sentence"`
	Translation    string   `json:"translation"`
	WordCount      int      `json:"word_count"`
	Structure      []string `json:"structure"`
	KeyPhrases     []string `json:"key_phrases"`
	DifficultyTips []string `json:"difficulty_tips"`
	Provider       string   `json:"provider"`
}

type DailySentenceResult struct {
	Sentence    string `json:"sentence"`
	Translation string `json:"translation"`
	Topic       string `json:"topic"`
}

type ArticleAssistantMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ArticleAssistantResult struct {
	Message  ArticleAssistantMessage `json:"message"`
	Provider string                  `json:"provider"`
}

type AIStudyNoteInput struct {
	ArticleTitle   string
	ArticleSummary string
	ArticleContent string
	EventsJSON     string
	VocabularyJSON string
}

type AIAnalysisService struct {
	BaseURL string
	APIKey  string
	Model   string
	client  *http.Client
}

type chatCompletionRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature *float64      `json:"temperature,omitempty"`
	MaxTokens   int           `json:"max_tokens"`
	Stream      bool          `json:"stream,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatCompletionResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    any    `json:"code"`
	} `json:"error"`
}

type chatCompletionStreamResponse struct {
	Choices []struct {
		Delta   chatMessage `json:"delta"`
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    any    `json:"code"`
	} `json:"error"`
}

func NewAIAnalysisService(baseURL, apiKey, model string, timeoutSeconds int) *AIAnalysisService {
	if timeoutSeconds <= 0 {
		timeoutSeconds = 20
	}

	return &AIAnalysisService{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		Model:   model,
		client: &http.Client{
			Timeout: time.Duration(timeoutSeconds) * time.Second,
		},
	}
}

func (s *AIAnalysisService) IsConfigured() bool {
	return s != nil && s.BaseURL != "" && s.APIKey != "" && s.Model != ""
}

func (s *AIAnalysisService) AnalyzeSentence(text string) (*SentenceAnalysisResult, error) {
	if !s.IsConfigured() {
		return nil, fmt.Errorf("AI 精读服务未配置")
	}

	payload := chatCompletionRequest{
		Model: s.Model,
		Messages: []chatMessage{
			{
				Role: "system",
				Content: strings.TrimSpace(`你是一个面向中文英语学习者的精读老师。
请只返回 JSON，不要使用 Markdown，不要输出额外解释。
JSON 字段必须是：
sentence: 原英文句子
translation: 自然准确的中文翻译
word_count: 英文词数
structure: 字符串数组，2-5 条，拆解主干、从句、修饰成分、逻辑关系
key_phrases: 字符串数组，3-8 条，列出值得学习的短语或搭配
difficulty_tips: 字符串数组，2-5 条，指出阅读难点和理解方法`),
			},
			{
				Role:    "user",
				Content: fmt.Sprintf("请精读解析下面英文：\n%s", text),
			},
		},
		Temperature: temperatureForModel(s.Model, 0.2),
		MaxTokens:   1200,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("构建 AI 请求失败: %w", err)
	}

	endpoint := s.BaseURL + "/chat/completions"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("构建 AI 请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("AI 精读请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 AI 响应失败: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("AI 精读 HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var completion chatCompletionResponse
	if err := json.Unmarshal(respBody, &completion); err != nil {
		return nil, fmt.Errorf("解析 AI 响应失败: %w", err)
	}
	if completion.Error != nil {
		return nil, fmt.Errorf("AI 精读错误: %s", completion.Error.Message)
	}
	if len(completion.Choices) == 0 || strings.TrimSpace(completion.Choices[0].Message.Content) == "" {
		return nil, fmt.Errorf("AI 精读结果为空")
	}

	content := cleanJSONContent(completion.Choices[0].Message.Content)
	var analysis SentenceAnalysisResult
	if err := json.Unmarshal([]byte(content), &analysis); err != nil {
		return nil, fmt.Errorf("解析 AI 精读 JSON 失败: %w", err)
	}

	if analysis.Sentence == "" {
		analysis.Sentence = text
	}
	if analysis.WordCount == 0 {
		analysis.WordCount = len(strings.Fields(text))
	}
	if len(analysis.Structure) == 0 || analysis.Translation == "" {
		return nil, fmt.Errorf("AI 精读结果缺少必要字段")
	}
	analysis.Provider = "ai"

	return &analysis, nil
}

func (s *AIAnalysisService) DiscussArticle(title, summary, content string, history []ArticleAssistantMessage) (*ArticleAssistantResult, error) {
	if !s.IsConfigured() {
		return nil, fmt.Errorf("AI 文章助手未配置")
	}

	payload := chatCompletionRequest{
		Model:       s.Model,
		Messages:    buildArticleAssistantMessages(title, summary, content, history),
		Temperature: temperatureForModel(s.Model, 0.4),
		MaxTokens:   1200,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("构建 AI 助手请求失败: %w", err)
	}

	endpoint := s.BaseURL + "/chat/completions"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("构建 AI 助手请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("AI 助手请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 AI 助手响应失败: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("AI 助手 HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var completion chatCompletionResponse
	if err := json.Unmarshal(respBody, &completion); err != nil {
		return nil, fmt.Errorf("解析 AI 助手响应失败: %w", err)
	}
	if completion.Error != nil {
		return nil, fmt.Errorf("AI 助手错误: %s", completion.Error.Message)
	}
	if len(completion.Choices) == 0 || strings.TrimSpace(completion.Choices[0].Message.Content) == "" {
		return nil, fmt.Errorf("AI 助手结果为空")
	}

	return &ArticleAssistantResult{
		Message: ArticleAssistantMessage{
			Role:    "assistant",
			Content: strings.TrimSpace(completion.Choices[0].Message.Content),
		},
		Provider: "ai",
	}, nil
}

func (s *AIAnalysisService) DiscussArticleStream(title, summary, content string, history []ArticleAssistantMessage, onDelta func(string) error) error {
	if !s.IsConfigured() {
		return fmt.Errorf("AI 文章助手未配置")
	}
	if onDelta == nil {
		return fmt.Errorf("AI 文章助手流式回调未配置")
	}

	payload := chatCompletionRequest{
		Model:       s.Model,
		Messages:    buildArticleAssistantMessages(title, summary, content, history),
		Temperature: temperatureForModel(s.Model, 0.4),
		MaxTokens:   1200,
		Stream:      true,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("构建 AI 助手请求失败: %w", err)
	}

	endpoint := s.BaseURL + "/chat/completions"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("构建 AI 助手请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)

	streamClient := *s.client
	streamClient.Timeout = 0
	resp, err := streamClient.Do(req)
	if err != nil {
		return fmt.Errorf("AI 助手请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("AI 助手 HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	received := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}

		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}

		var chunk chatCompletionStreamResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return fmt.Errorf("解析 AI 助手流式响应失败: %w", err)
		}
		if chunk.Error != nil {
			return fmt.Errorf("AI 助手错误: %s", chunk.Error.Message)
		}

		for _, choice := range chunk.Choices {
			delta := firstNonEmptyAIContent(choice.Delta.Content, choice.Message.Content)
			if delta == "" {
				continue
			}
			received = true
			if err := onDelta(delta); err != nil {
				return err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("读取 AI 助手流式响应失败: %w", err)
	}
	if !received {
		return fmt.Errorf("AI 助手结果为空")
	}

	return nil
}

func (s *AIAnalysisService) GenerateStudyNote(input AIStudyNoteInput) (*ArticleStudyNoteResponse, error) {
	if !s.IsConfigured() {
		return nil, fmt.Errorf("AI 精读笔记服务未配置")
	}

	payload := chatCompletionRequest{
		Model: s.Model,
		Messages: []chatMessage{
			{
				Role: "system",
				Content: strings.TrimSpace(`你是一个面向中文英语学习者的精读笔记整理助手。
请只返回 JSON，不要使用 Markdown，不要输出额外解释。
JSON 字段必须是：
summary: 字符串，中文，概括文章内容和本次学习行为
keywords: 字符串数组，精确 5 个关键词
difficult_sentences: 数组，精确 2 项，每项包含 text, translation, reason, tips。tips 是字符串数组
grammar_points: 数组，每项包含 title, description, examples。examples 是字符串数组
expression_replacements: 数组，精确 3 项，每项包含 original, alternative, note
review_plan: 字符串数组，3-5 条复习动作
要求：
1. 优先使用用户查过、翻译过、精读过、问过 AI 的内容。
2. 不编造文章没有出现的细节。
3. 输出适合读后复习，简洁但可执行。`),
			},
			{
				Role: "user",
				Content: fmt.Sprintf(strings.TrimSpace(`文章标题：
%s

文章摘要：
%s

文章正文节选：
%s

用户学习事件 JSON：
%s

本篇生词 JSON：
%s`), input.ArticleTitle, input.ArticleSummary, input.ArticleContent, input.EventsJSON, input.VocabularyJSON),
			},
		},
		Temperature: temperatureForModel(s.Model, 0.25),
		MaxTokens:   1800,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("构建 AI 精读笔记请求失败: %w", err)
	}

	endpoint := s.BaseURL + "/chat/completions"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("构建 AI 精读笔记请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("AI 精读笔记请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 AI 精读笔记响应失败: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("AI 精读笔记 HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var completion chatCompletionResponse
	if err := json.Unmarshal(respBody, &completion); err != nil {
		return nil, fmt.Errorf("解析 AI 精读笔记响应失败: %w", err)
	}
	if completion.Error != nil {
		return nil, fmt.Errorf("AI 精读笔记错误: %s", completion.Error.Message)
	}
	if len(completion.Choices) == 0 || strings.TrimSpace(completion.Choices[0].Message.Content) == "" {
		return nil, fmt.Errorf("AI 精读笔记结果为空")
	}

	content := cleanJSONContent(completion.Choices[0].Message.Content)
	var note ArticleStudyNoteResponse
	if err := json.Unmarshal([]byte(content), &note); err != nil {
		return nil, fmt.Errorf("解析 AI 精读笔记 JSON 失败: %w", err)
	}
	if strings.TrimSpace(note.Summary) == "" {
		return nil, fmt.Errorf("AI 精读笔记缺少摘要")
	}
	note.Provider = "ai"
	return &note, nil
}

func buildArticleAssistantMessages(title, summary, content string, history []ArticleAssistantMessage) []chatMessage {
	messages := []chatMessage{
		{
			Role: "system",
			Content: strings.TrimSpace(`你是一个面向中文英语学习者的文章阅读 AI 助手。
你需要围绕用户正在阅读的英文文章回答问题、解释观点、拆解语言点、引导思考。
回答要求：
1. 主要使用中文，必要时保留英文原句或关键词。
2. 所有解释必须基于给定文章内容；如果用户问到文章外事实，请明确说明并区分推断。
3. 不要编造文章没有出现的细节。
4. 用户问语言学习问题时，给出简洁例句、词组或句式拆解。
5. 回答保持清晰、自然，避免 Markdown 表格。`),
		},
		{
			Role: "user",
			Content: fmt.Sprintf(strings.TrimSpace(`文章标题：
%s

文章摘要：
%s

文章正文：
%s`), title, summary, content),
		},
		{
			Role:    "assistant",
			Content: "我已阅读这篇文章。你可以问我文章观点、段落逻辑、词句理解、背景推断或学习建议。",
		},
	}

	for _, item := range history {
		role := strings.ToLower(strings.TrimSpace(item.Role))
		content := strings.TrimSpace(item.Content)
		if content == "" {
			continue
		}
		if role != "user" && role != "assistant" {
			continue
		}
		messages = append(messages, chatMessage{
			Role:    role,
			Content: content,
		})
	}

	return messages
}

// GenerateDailySentence 生成每日一句英文句子及其中文翻译
func (s *AIAnalysisService) GenerateDailySentence() (*DailySentenceResult, error) {
	if !s.IsConfigured() {
		return nil, fmt.Errorf("AI 服务未配置")
	}

	payload := chatCompletionRequest{
		Model: s.Model,
		Messages: []chatMessage{
			{
				Role: "system",
				Content: strings.TrimSpace(`你是一个面向中文英语学习者的每日英文精选老师。
请生成一句有趣的英文句子，适合中高级英语学习者（CET-4 水平）。
要求：
1. 句子内容应包含有用的词汇或地道表达
2. 涉及科技、文化、生活方式、自然等话题
3. 句子要有一定深度和可讨论性，但不要太长（15-30 词）
4. 每天的句子不要重复主题

请只返回 JSON，不要使用 Markdown，不要输出额外解释。
JSON 字段必须是：
sentence: 英文句子
translation: 自然准确的中文翻译
topic: 话题分类（如：科技、文化、生活方式、自然、教育等）`),
			},
			{
				Role:    "user",
				Content: "请生成今天的每日一句。",
			},
		},
		Temperature: temperatureForModel(s.Model, 0.8),
		MaxTokens:   300,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("构建每日一句请求失败: %w", err)
	}

	endpoint := s.BaseURL + "/chat/completions"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("构建每日一句请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("每日一句请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取每日一句响应失败: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("每日一句 HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var completion chatCompletionResponse
	if err := json.Unmarshal(respBody, &completion); err != nil {
		return nil, fmt.Errorf("解析 AI 响应失败: %w", err)
	}
	if completion.Error != nil {
		return nil, fmt.Errorf("每日一句错误: %s", completion.Error.Message)
	}
	if len(completion.Choices) == 0 || strings.TrimSpace(completion.Choices[0].Message.Content) == "" {
		return nil, fmt.Errorf("每日一句结果为空")
	}

	content := cleanJSONContent(completion.Choices[0].Message.Content)
	var result DailySentenceResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("解析每日一句 JSON 失败: %w", err)
	}

	if result.Sentence == "" || result.Translation == "" {
		return nil, fmt.Errorf("每日一句结果缺少必要字段")
	}

	return &result, nil
}

func temperatureForModel(model string, value float64) *float64 {
	normalized := strings.ToLower(strings.TrimSpace(model))
	if strings.HasPrefix(normalized, "mimo-v2.5") {
		return nil
	}
	return &value
}

func firstNonEmptyAIContent(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func cleanJSONContent(content string) string {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	return strings.TrimSpace(content)
}

package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"gugudu-backend/database"
	"gugudu-backend/models"
	"gugudu-backend/services"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ---------- AI 助记 ----------

type mnemonicResponse struct {
	Mnemonic string `json:"mnemonic"`
	Cached   bool   `json:"cached"`
}

func GetVocabMnemonic(c *gin.Context) {
	userID, _ := c.Get("user_id")
	wordID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid word id"})
		return
	}

	var vocab models.Vocabulary
	if err := database.DB.Where("id = ? AND user_id = ?", wordID, userID).First(&vocab).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Word not found"})
		return
	}

	if vocab.Mnemonic != "" {
		c.JSON(http.StatusOK, mnemonicResponse{Mnemonic: vocab.Mnemonic, Cached: true})
		return
	}

	ai := GetAIAnalysisService()
	if ai == nil || !ai.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 服务未启用"})
		return
	}

	prompt := fmt.Sprintf(`你是一个英语学习助记专家。请为以下单词生成一个简洁有趣的中文助记方法。

单词: %s
音标: %s
释义: %s

要求:
1. 用谐音法、拆词法、联想法或词根词缀法中的一种或多种
2. 50-100字，简洁易记
3. 只输出助记内容，不要标题和多余解释`, vocab.Word, vocab.Phonetic, vocabFirstMeaning(vocab))

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	mnemonic, err := simpleAIChat(ctx, ai, prompt, 0.7, 300)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 生成失败"})
		return
	}

	database.DB.Model(&vocab).Update("mnemonic", mnemonic)
	c.JSON(http.StatusOK, mnemonicResponse{Mnemonic: mnemonic, Cached: false})
}

// ---------- AI 例句 ----------

type aiExamplesResponse struct {
	Examples []aiExampleItem `json:"examples"`
	Cached   bool            `json:"cached"`
}

type aiExampleItem struct {
	Sentence    string `json:"sentence"`
	Translation string `json:"translation"`
	Difficulty  string `json:"difficulty"`
}

func GetVocabAIExamples(c *gin.Context) {
	userID, _ := c.Get("user_id")
	wordID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid word id"})
		return
	}

	var vocab models.Vocabulary
	if err := database.DB.Where("id = ? AND user_id = ?", wordID, userID).First(&vocab).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Word not found"})
		return
	}

	if vocab.AIExamples != "" {
		var examples []aiExampleItem
		if json.Unmarshal([]byte(vocab.AIExamples), &examples) == nil && len(examples) > 0 {
			c.JSON(http.StatusOK, aiExamplesResponse{Examples: examples, Cached: true})
			return
		}
	}

	ai := GetAIAnalysisService()
	if ai == nil || !ai.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 服务未启用"})
		return
	}

	contextHint := ""
	if vocab.Context != "" {
		contextHint = fmt.Sprintf("\n用户在以下语境中遇到过这个词: %s", vocab.Context)
	}

	prompt := fmt.Sprintf(`你是英语教学专家。请为单词 "%s" 生成 3 个英文例句，附中文翻译。

释义: %s%s

要求:
1. 三个例句难度递进: 简单/中等/较难
2. 贴近日常使用场景
3. 只返回 JSON 数组，格式: [{"sentence":"...","translation":"...","difficulty":"easy|medium|hard"}]
4. 不要输出其他内容`, vocab.Word, vocabFirstMeaning(vocab), contextHint)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	response, err := simpleAIChat(ctx, ai, prompt, 0.7, 800)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 生成失败"})
		return
	}

	var examples []aiExampleItem
	cleaned := strings.TrimSpace(response)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)
	if err := json.Unmarshal([]byte(cleaned), &examples); err != nil || len(examples) == 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 响应解析失败"})
		return
	}

	examplesJSON, _ := json.Marshal(examples)
	database.DB.Model(&vocab).Update("ai_examples", string(examplesJSON))
	c.JSON(http.StatusOK, aiExamplesResponse{Examples: examples, Cached: false})
}

// ---------- AI 单词问答 ----------

type vocabChatRequest struct {
	Messages []vocabChatMsg `json:"messages" binding:"required"`
	Stream   bool           `json:"stream"`
}

type vocabChatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func ChatWithVocab(c *gin.Context) {
	userID, _ := c.Get("user_id")
	wordID, ok := parsePathUint(c, "id")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid word id"})
		return
	}

	var vocab models.Vocabulary
	if err := database.DB.Where("id = ? AND user_id = ?", wordID, userID).First(&vocab).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Word not found"})
		return
	}

	ai := GetAIAnalysisService()
	if ai == nil || !ai.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 服务未启用"})
		return
	}

	var req vocabChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求"})
		return
	}

	systemPrompt := fmt.Sprintf(`你是英语学习助手，正在帮助学生学习单词 "%s"。

单词信息:
- 音标: %s
- 释义: %s
- 例句: %s
- 用户笔记: %s

请围绕这个单词回答学生的问题。可以讨论用法、搭配、近义词、词源、记忆技巧等。
回答简洁有用，用中文回答（除非学生用英文提问）。`, vocab.Word, vocab.Phonetic,
		vocabFirstMeaning(vocab),
		vocabFirstExample(vocab), vocab.Notes)

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

		err := streamAIChat(c.Request.Context(), ai, systemPrompt, req.Messages, 0.7, 1000, func(delta string) error {
			c.SSEvent("message", delta)
			flusher.Flush()
			return nil
		})
		if err != nil {
			c.SSEvent("error", err.Error())
			flusher.Flush()
		}
	} else {
		fullPrompt := systemPrompt + "\n\n对话历史:\n"
		for _, msg := range req.Messages {
			role := "用户"
			if msg.Role == "assistant" {
				role = "助手"
			}
			fullPrompt += fmt.Sprintf("%s: %s\n", role, msg.Content)
		}
		fullPrompt += "\n请回答用户最后一个问题。"

		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()

		response, err := simpleAIChat(ctx, ai, fullPrompt, 0.7, 1000)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 回复失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"content": response}})
	}
}

// ---------- 内部工具函数 ----------

type chatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func simpleAIChat(ctx context.Context, ai *services.AIAnalysisService, prompt string, temperature float64, maxTokens int) (string, error) {
	type chatReq struct {
		Model       string    `json:"model"`
		Messages    []chatMsg `json:"messages"`
		Temperature *float64  `json:"temperature,omitempty"`
		MaxTokens   int       `json:"max_tokens"`
	}
	type chatResp struct {
		Choices []struct {
			Message chatMsg `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	payload := chatReq{
		Model: ai.Model,
		Messages: []chatMsg{
			{Role: "user", Content: prompt},
		},
		Temperature: &temperature,
		MaxTokens:   maxTokens,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ai.BaseURL+"/chat/completions", strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+ai.APIKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result chatResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.Error != nil {
		return "", fmt.Errorf("AI error: %s", result.Error.Message)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("no response from AI")
	}
	return result.Choices[0].Message.Content, nil
}

func streamAIChat(ctx context.Context, ai *services.AIAnalysisService, systemPrompt string, messages []vocabChatMsg, temperature float64, maxTokens int, onDelta func(string) error) error {
	chatMessages := []chatMsg{
		{Role: "system", Content: systemPrompt},
	}
	for _, msg := range messages {
		chatMessages = append(chatMessages, chatMsg{Role: msg.Role, Content: msg.Content})
	}

	payload := struct {
		Model       string    `json:"model"`
		Messages    []chatMsg `json:"messages"`
		Temperature *float64  `json:"temperature,omitempty"`
		MaxTokens   int       `json:"max_tokens"`
		Stream      bool      `json:"stream"`
	}{
		Model:       ai.Model,
		Messages:    chatMessages,
		Temperature: &temperature,
		MaxTokens:   maxTokens,
		Stream:      true,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ai.BaseURL+"/chat/completions", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+ai.APIKey)

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	decoder := json.NewDecoder(resp.Body)
	for {
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := decoder.Decode(&chunk); err != nil {
			break
		}
		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			if err := onDelta(chunk.Choices[0].Delta.Content); err != nil {
				return err
			}
		}
	}
	return nil
}

func vocabFirstMeaning(v models.Vocabulary) string {
	if v.Translation != "" {
		return v.Translation
	}
	return v.Definition
}

func vocabFirstExample(v models.Vocabulary) string {
	if v.Examples == "" {
		return ""
	}
	var examples []struct {
		Sentence string `json:"sentence"`
	}
	if json.Unmarshal([]byte(v.Examples), &examples) == nil && len(examples) > 0 {
		return examples[0].Sentence
	}
	return v.Examples
}

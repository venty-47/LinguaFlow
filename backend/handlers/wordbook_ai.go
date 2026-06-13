package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"gugudu-backend/database"
	"gugudu-backend/models"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// GetWordBookEntryMnemonic 获取词条的 AI 助记
func GetWordBookEntryMnemonic(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	entryID, err := strconv.ParseUint(c.Param("entryId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid entry ID"})
		return
	}

	var entry models.WordBookEntry
	if err := database.DB.Where("id = ? AND word_book_id = ?", entryID, bookID).First(&entry).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Entry not found"})
		return
	}

	if entry.Mnemonic != "" {
		c.JSON(http.StatusOK, mnemonicResponse{Mnemonic: entry.Mnemonic, Cached: true})
		return
	}

	ai := GetAIAnalysisService()
	if ai == nil || !ai.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 服务未启用"})
		return
	}

	phonetic := entry.USPhonetic
	if phonetic == "" {
		phonetic = entry.UKPhonetic
	}
	if phonetic == "" {
		phonetic = entry.Phonetic
	}

	prompt := fmt.Sprintf(`你是一个英语学习助记专家。请为以下单词生成一个简洁有趣的中文助记方法。

单词: %s
音标: %s
释义: %s

要求:
1. 用谐音法、拆词法、联想法或词根词缀法中的一种或多种
2. 50-100字，简洁易记
3. 只输出助记内容，不要标题和多余解释`, entry.Word, phonetic, entry.Translation)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	mnemonic, err := simpleAIChat(ctx, ai, prompt, 0.7, 300)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 生成失败"})
		return
	}

	database.DB.Model(&entry).Update("mnemonic", mnemonic)
	c.JSON(http.StatusOK, mnemonicResponse{Mnemonic: mnemonic, Cached: false})
}

// GetWordBookEntryAIExamples 获取词条的 AI 例句
func GetWordBookEntryAIExamples(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	entryID, err := strconv.ParseUint(c.Param("entryId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid entry ID"})
		return
	}

	var entry models.WordBookEntry
	if err := database.DB.Where("id = ? AND word_book_id = ?", entryID, bookID).First(&entry).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Entry not found"})
		return
	}

	if entry.AIExamples != "" {
		var examples []aiExampleItem
		if json.Unmarshal([]byte(entry.AIExamples), &examples) == nil && len(examples) > 0 {
			c.JSON(http.StatusOK, aiExamplesResponse{Examples: examples, Cached: true})
			return
		}
	}

	ai := GetAIAnalysisService()
	if ai == nil || !ai.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 服务未启用"})
		return
	}

	prompt := fmt.Sprintf(`你是英语教学专家。请为单词 "%s" 生成 3 个英文例句，附中文翻译。

释义: %s

要求:
1. 三个例句难度递进: 简单/中等/较难
2. 贴近日常使用场景
3. 只返回 JSON 数组，格式: [{"sentence":"...","translation":"...","difficulty":"easy|medium|hard"}]
4. 不要输出其他内容`, entry.Word, entry.Translation)

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
	database.DB.Model(&entry).Update("ai_examples", string(examplesJSON))
	c.JSON(http.StatusOK, aiExamplesResponse{Examples: examples, Cached: false})
}

// ChatWithWordBookEntry 与词条 AI 对话
func ChatWithWordBookEntry(c *gin.Context) {
	bookID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wordbook ID"})
		return
	}

	entryID, err := strconv.ParseUint(c.Param("entryId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid entry ID"})
		return
	}

	var entry models.WordBookEntry
	if err := database.DB.Where("id = ? AND word_book_id = ?", entryID, bookID).First(&entry).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Entry not found"})
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

	phonetic := entry.USPhonetic
	if phonetic == "" {
		phonetic = entry.UKPhonetic
	}
	if phonetic == "" {
		phonetic = entry.Phonetic
	}

	firstExample := ""
	if entry.Examples != "" {
		var exs []struct {
			En string `json:"en"`
		}
		if json.Unmarshal([]byte(entry.Examples), &exs) == nil && len(exs) > 0 {
			firstExample = exs[0].En
		}
	}

	systemPrompt := fmt.Sprintf(`你是英语学习助手，正在帮助学生学习单词 "%s"。

单词信息:
- 音标: %s
- 释义: %s
- 例句: %s
- 常用搭配: %s

请围绕这个单词回答学生的问题。可以讨论用法、搭配、近义词、词源、记忆技巧等。
回答简洁有用，用中文回答（除非学生用英文提问）。`, entry.Word, phonetic,
		entry.Translation, firstExample, entry.Collocations)

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

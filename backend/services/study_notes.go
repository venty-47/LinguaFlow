package services

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"gugudu-backend/models"
	"regexp"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	StudyEventTranslation      = "translation"
	StudyEventDictionary       = "dictionary"
	StudyEventVocabulary       = "vocabulary"
	StudyEventSentenceAnalysis = "sentence_analysis"
	StudyEventAssistant        = "assistant"
)

type StudyEventInput struct {
	UserID     uint
	ArticleID  uint
	EventType  string
	SourceText string
	ResultText string
	Context    string
	Metadata   map[string]any
}

type ArticleStudyNoteResponse struct {
	ID                     uint                  `json:"id"`
	UserID                 uint                  `json:"user_id"`
	ArticleID              uint                  `json:"article_id"`
	Title                  string                `json:"title"`
	Summary                string                `json:"summary"`
	Keywords               []string              `json:"keywords"`
	DifficultSentences     []StudyNoteSentence   `json:"difficult_sentences"`
	GrammarPoints          []StudyNotePoint      `json:"grammar_points"`
	ExpressionReplacements []StudyNoteExpression `json:"expression_replacements"`
	ReviewPlan             []string              `json:"review_plan"`
	SourceStats            StudyNoteSourceStats  `json:"source_stats"`
	Provider               string                `json:"provider"`
	GeneratedAt            time.Time             `json:"generated_at"`
	RefreshedAt            *time.Time            `json:"refreshed_at,omitempty"`
	CreatedAt              time.Time             `json:"created_at"`
	UpdatedAt              time.Time             `json:"updated_at"`
}

type StudyNoteSentence struct {
	Text        string   `json:"text"`
	Translation string   `json:"translation,omitempty"`
	Reason      string   `json:"reason,omitempty"`
	Tips        []string `json:"tips,omitempty"`
}

type StudyNotePoint struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Examples    []string `json:"examples,omitempty"`
}

type StudyNoteExpression struct {
	Original    string `json:"original"`
	Alternative string `json:"alternative"`
	Note        string `json:"note,omitempty"`
}

type StudyNoteSourceStats struct {
	TranslatedTexts    int `json:"translated_texts"`
	DictionaryLookups  int `json:"dictionary_lookups"`
	SavedWords         int `json:"saved_words"`
	AnalyzedSentences  int `json:"analyzed_sentences"`
	AssistantQuestions int `json:"assistant_questions"`
}

type ArticleStudyNoteService struct {
	db *gorm.DB
}

func NewArticleStudyNoteService(db *gorm.DB) *ArticleStudyNoteService {
	return &ArticleStudyNoteService{db: db}
}

func (s *ArticleStudyNoteService) RecordEvent(input StudyEventInput) error {
	if s == nil || s.db == nil {
		return nil
	}
	input.EventType = strings.TrimSpace(input.EventType)
	input.SourceText = truncateRunesForStudyNote(input.SourceText, 4000)
	input.ResultText = truncateRunesForStudyNote(input.ResultText, 6000)
	input.Context = truncateRunesForStudyNote(input.Context, 4000)
	if input.UserID == 0 || input.ArticleID == 0 || input.EventType == "" || strings.TrimSpace(input.SourceText) == "" {
		return nil
	}

	metadataJSON := "{}"
	if len(input.Metadata) > 0 {
		if raw, err := json.Marshal(input.Metadata); err == nil {
			metadataJSON = string(raw)
		}
	}

	event := models.ArticleStudyEvent{
		UserID:      input.UserID,
		ArticleID:   input.ArticleID,
		EventType:   input.EventType,
		SourceText:  input.SourceText,
		ResultText:  input.ResultText,
		Context:     input.Context,
		Metadata:    metadataJSON,
		SourceHash:  hashStudyNoteText(input.SourceText),
		ContextHash: hashStudyNoteText(input.EventType + "\n" + input.Context),
	}

	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "user_id"},
			{Name: "article_id"},
			{Name: "event_type"},
			{Name: "source_hash"},
			{Name: "context_hash"},
		},
		DoUpdates: clause.AssignmentColumns([]string{"result_text", "metadata", "updated_at"}),
	}).Create(&event).Error
}

func (s *ArticleStudyNoteService) GetNote(userID, articleID uint) (*ArticleStudyNoteResponse, error) {
	var note models.ArticleStudyNote
	if err := s.db.Where("user_id = ? AND article_id = ?", userID, articleID).First(&note).Error; err != nil {
		return nil, err
	}
	response := BuildArticleStudyNoteResponse(note)
	return &response, nil
}

func (s *ArticleStudyNoteService) GenerateNote(userID, articleID uint, force bool) (*ArticleStudyNoteResponse, error) {
	return s.GenerateNoteWithDraft(userID, articleID, force, nil)
}

func (s *ArticleStudyNoteService) GenerateNoteWithDraft(userID, articleID uint, force bool, aiDraft *ArticleStudyNoteResponse) (*ArticleStudyNoteResponse, error) {
	var article models.Article
	if err := s.db.Preload("Category").Where("id = ? AND status = ?", articleID, "published").First(&article).Error; err != nil {
		return nil, err
	}

	if !force {
		var existing models.ArticleStudyNote
		if err := s.db.Where("user_id = ? AND article_id = ?", userID, articleID).First(&existing).Error; err == nil {
			response := BuildArticleStudyNoteResponse(existing)
			return &response, nil
		}
	}

	var events []models.ArticleStudyEvent
	if err := s.db.
		Where("user_id = ? AND article_id = ?", userID, articleID).
		Order("created_at ASC").
		Find(&events).Error; err != nil {
		return nil, err
	}

	var words []models.Vocabulary
	if err := s.db.
		Where("user_id = ? AND article_id = ?", userID, articleID).
		Order("created_at ASC").
		Find(&words).Error; err != nil {
		return nil, err
	}

	draft := buildRuleStudyNote(article, events, words)
	if aiDraft != nil {
		draft = mergeAIStudyNoteDraft(draft, *aiDraft)
	}
	now := time.Now()
	note := models.ArticleStudyNote{
		UserID:                 userID,
		ArticleID:              articleID,
		Title:                  draft.Title,
		Summary:                draft.Summary,
		Keywords:               mustStudyNoteJSON(draft.Keywords),
		DifficultSentences:     mustStudyNoteJSON(draft.DifficultSentences),
		GrammarPoints:          mustStudyNoteJSON(draft.GrammarPoints),
		ExpressionReplacements: mustStudyNoteJSON(draft.ExpressionReplacements),
		ReviewPlan:             mustStudyNoteJSON(draft.ReviewPlan),
		SourceStats:            mustStudyNoteJSON(draft.SourceStats),
		Provider:               draft.Provider,
		GeneratedAt:            now,
	}

	var existing models.ArticleStudyNote
	if err := s.db.Where("user_id = ? AND article_id = ?", userID, articleID).First(&existing).Error; err == nil {
		note.ID = existing.ID
		note.CreatedAt = existing.CreatedAt
		note.RefreshedAt = &now
		if err := s.db.Model(&existing).Updates(map[string]any{
			"title":                   note.Title,
			"summary":                 note.Summary,
			"keywords":                note.Keywords,
			"difficult_sentences":     note.DifficultSentences,
			"grammar_points":          note.GrammarPoints,
			"expression_replacements": note.ExpressionReplacements,
			"review_plan":             note.ReviewPlan,
			"source_stats":            note.SourceStats,
			"provider":                note.Provider,
			"generated_at":            note.GeneratedAt,
			"refreshed_at":            note.RefreshedAt,
		}).Error; err != nil {
			return nil, err
		}
		if err := s.db.First(&note, existing.ID).Error; err != nil {
			return nil, err
		}
	} else if err := s.db.Create(&note).Error; err != nil {
		return nil, err
	}

	response := BuildArticleStudyNoteResponse(note)
	return &response, nil
}

func BuildArticleStudyNoteResponse(note models.ArticleStudyNote) ArticleStudyNoteResponse {
	return ArticleStudyNoteResponse{
		ID:                     note.ID,
		UserID:                 note.UserID,
		ArticleID:              note.ArticleID,
		Title:                  note.Title,
		Summary:                note.Summary,
		Keywords:               decodeStudyNoteJSON[[]string](note.Keywords),
		DifficultSentences:     decodeStudyNoteJSON[[]StudyNoteSentence](note.DifficultSentences),
		GrammarPoints:          decodeStudyNoteJSON[[]StudyNotePoint](note.GrammarPoints),
		ExpressionReplacements: decodeStudyNoteJSON[[]StudyNoteExpression](note.ExpressionReplacements),
		ReviewPlan:             decodeStudyNoteJSON[[]string](note.ReviewPlan),
		SourceStats:            decodeStudyNoteJSON[StudyNoteSourceStats](note.SourceStats),
		Provider:               note.Provider,
		GeneratedAt:            note.GeneratedAt,
		RefreshedAt:            note.RefreshedAt,
		CreatedAt:              note.CreatedAt,
		UpdatedAt:              note.UpdatedAt,
	}
}

func buildRuleStudyNote(article models.Article, events []models.ArticleStudyEvent, words []models.Vocabulary) ArticleStudyNoteResponse {
	stats := StudyNoteSourceStats{}
	for _, event := range events {
		switch event.EventType {
		case StudyEventTranslation:
			stats.TranslatedTexts++
		case StudyEventDictionary:
			stats.DictionaryLookups++
		case StudyEventVocabulary:
			stats.SavedWords++
		case StudyEventSentenceAnalysis:
			stats.AnalyzedSentences++
		case StudyEventAssistant:
			stats.AssistantQuestions++
		}
	}
	if stats.SavedWords == 0 {
		stats.SavedWords = len(words)
	}

	keywords := buildStudyNoteKeywords(article, events, words)
	difficultSentences := buildStudyNoteSentences(article, events)
	grammarPoints := buildStudyNoteGrammarPoints(article.Content, events)
	expressions := buildStudyNoteExpressions(events, words)
	reviewPlan := []string{
		"先用 2 分钟复述文章主旨，再回看摘要确认遗漏。",
		"朗读难句并按主干、从句、修饰成分重新拆分。",
		"复习本篇生词和表达，优先回到原文上下文理解。",
	}
	if len(expressions) > 0 {
		reviewPlan = append(reviewPlan, "挑选 2 个表达替换，写出自己的英文例句。")
	}

	return ArticleStudyNoteResponse{
		ArticleID:              article.ID,
		Title:                  fmt.Sprintf("%s · 精读笔记", article.Title),
		Summary:                buildStudyNoteSummary(article, stats),
		Keywords:               keywords,
		DifficultSentences:     difficultSentences,
		GrammarPoints:          grammarPoints,
		ExpressionReplacements: expressions,
		ReviewPlan:             reviewPlan,
		SourceStats:            stats,
		Provider:               "rules",
	}
}

func mergeAIStudyNoteDraft(ruleDraft, aiDraft ArticleStudyNoteResponse) ArticleStudyNoteResponse {
	merged := ruleDraft
	merged.Provider = "ai"
	if strings.TrimSpace(aiDraft.Title) != "" {
		merged.Title = aiDraft.Title
	}
	if strings.TrimSpace(aiDraft.Summary) != "" {
		merged.Summary = aiDraft.Summary
	}
	if len(aiDraft.Keywords) > 0 {
		merged.Keywords = aiDraft.Keywords
	}
	if len(aiDraft.DifficultSentences) > 0 {
		merged.DifficultSentences = aiDraft.DifficultSentences
	}
	if len(aiDraft.GrammarPoints) > 0 {
		merged.GrammarPoints = aiDraft.GrammarPoints
	}
	if len(aiDraft.ExpressionReplacements) > 0 {
		merged.ExpressionReplacements = aiDraft.ExpressionReplacements
	}
	if len(aiDraft.ReviewPlan) > 0 {
		merged.ReviewPlan = aiDraft.ReviewPlan
	}
	return merged
}

func buildStudyNoteSummary(article models.Article, stats StudyNoteSourceStats) string {
	base := strings.TrimSpace(article.SummaryCN)
	if base == "" {
		base = strings.TrimSpace(article.Summary)
	}
	if base == "" {
		base = firstStudyNoteSentence(article.Content)
	}
	if base == "" {
		base = "这篇文章的精读笔记会围绕阅读过程中查过的词、翻译过的句子和 AI 讨论内容整理。"
	}
	return fmt.Sprintf("%s\n\n本篇沉淀了 %d 个生词/查词、%d 个句子精读、%d 次段落或选区翻译和 %d 次 AI 问答。", base, stats.SavedWords+stats.DictionaryLookups, stats.AnalyzedSentences, stats.TranslatedTexts, stats.AssistantQuestions)
}

func buildStudyNoteKeywords(article models.Article, events []models.ArticleStudyEvent, words []models.Vocabulary) []string {
	counts := map[string]int{}
	add := func(value string, weight int) {
		for _, word := range regexp.MustCompile(`[A-Za-z][A-Za-z'’-]{2,}`).FindAllString(strings.ToLower(value), -1) {
			if isStudyNoteStopWord(word) {
				continue
			}
			counts[strings.Trim(word, "'’-.")] += weight
		}
	}

	add(article.Title+" "+article.Tags+" "+article.Keywords, 3)
	for _, word := range words {
		add(word.Word, 5)
		add(word.Translation+" "+word.Context, 1)
	}
	for _, event := range events {
		weight := 1
		if event.EventType == StudyEventDictionary || event.EventType == StudyEventVocabulary {
			weight = 4
		}
		add(event.SourceText, weight)
	}

	type scored struct {
		word  string
		score int
	}
	items := make([]scored, 0, len(counts))
	for word, score := range counts {
		if word != "" {
			items = append(items, scored{word: word, score: score})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].word < items[j].word
		}
		return items[i].score > items[j].score
	})
	limit := minStudyNoteInt(12, len(items))
	result := make([]string, 0, limit)
	for _, item := range items[:limit] {
		result = append(result, item.word)
	}
	return result
}

func buildStudyNoteSentences(article models.Article, events []models.ArticleStudyEvent) []StudyNoteSentence {
	result := make([]StudyNoteSentence, 0)
	seen := map[string]bool{}
	for _, event := range events {
		if event.EventType != StudyEventSentenceAnalysis && event.EventType != StudyEventTranslation {
			continue
		}
		text := strings.TrimSpace(event.SourceText)
		if len([]rune(text)) < 24 || seen[text] {
			continue
		}
		seen[text] = true
		result = append(result, StudyNoteSentence{
			Text:        text,
			Translation: strings.TrimSpace(event.ResultText),
			Reason:      "来自阅读过程中的翻译或句子精读。",
			Tips:        sentenceStudyTips(text),
		})
		if len(result) >= 6 {
			return result
		}
	}

	for _, sentence := range splitStudyNoteSentences(article.Content) {
		if len([]rune(sentence)) < 90 || seen[sentence] {
			continue
		}
		seen[sentence] = true
		result = append(result, StudyNoteSentence{
			Text:   sentence,
			Reason: "句子较长，适合读后复盘结构。",
			Tips:   sentenceStudyTips(sentence),
		})
		if len(result) >= 4 {
			break
		}
	}
	return result
}

func buildStudyNoteGrammarPoints(content string, events []models.ArticleStudyEvent) []StudyNotePoint {
	text := strings.ToLower(content)
	for _, event := range events {
		text += " " + strings.ToLower(event.SourceText)
	}

	candidates := []struct {
		marker      string
		title       string
		description string
	}{
		{"although", "让步转折", "although / though 引导的从句先给背景或让步，主句通常才是作者强调的判断。"},
		{"because", "原因解释", "because 引导原因，阅读时先分清事实判断和原因说明。"},
		{"which", "定语从句", "which 常回指前面的名词或整件事，适合训练长句回指。"},
		{"that", "that 从句", "that 可能引导宾语从句、定语从句或同位语从句，需要看前面的动词或名词。"},
		{"however", "转折连接", "however 后面常出现更关键的限制、反例或作者态度。"},
		{"could", "情态判断", "could / may / might 表示可能性，不等于事实已经发生。"},
	}

	result := make([]StudyNotePoint, 0, 4)
	for _, candidate := range candidates {
		if strings.Contains(text, candidate.marker) {
			result = append(result, StudyNotePoint{
				Title:       candidate.title,
				Description: candidate.description,
				Examples:    findStudyNoteExamples(content, candidate.marker, 2),
			})
		}
		if len(result) >= 4 {
			break
		}
	}
	if len(result) == 0 {
		result = append(result, StudyNotePoint{
			Title:       "主干优先",
			Description: "先找到谓语动词，再确定主语、宾语和补语，最后处理介词短语和插入信息。",
			Examples:    findStudyNoteExamples(content, "", 2),
		})
	}
	return result
}

func buildStudyNoteExpressions(events []models.ArticleStudyEvent, words []models.Vocabulary) []StudyNoteExpression {
	result := make([]StudyNoteExpression, 0, 8)
	seen := map[string]bool{}
	add := func(original, alternative, note string) {
		original = strings.TrimSpace(original)
		if original == "" || seen[strings.ToLower(original)] {
			return
		}
		seen[strings.ToLower(original)] = true
		result = append(result, StudyNoteExpression{
			Original:    original,
			Alternative: alternative,
			Note:        note,
		})
	}

	for _, word := range words {
		add(word.Word, firstNonEmptyStudyNote(word.Translation, "结合原文语境复习"), "来自本篇生词本。")
		if len(result) >= 5 {
			break
		}
	}
	for _, event := range events {
		if event.EventType != StudyEventDictionary && event.EventType != StudyEventSentenceAnalysis {
			continue
		}
		phrases := extractStudyNotePhrases(event.SourceText)
		for _, phrase := range phrases {
			add(phrase, "try / use / describe 等简单表达可先替换练习", "来自查词或句子精读，可用于仿写。")
			if len(result) >= 8 {
				return result
			}
		}
	}
	return result
}

func hashStudyNoteText(text string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(text)))
	return hex.EncodeToString(sum[:])
}

func mustStudyNoteJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "null"
	}
	return string(raw)
}

func decodeStudyNoteJSON[T any](raw string) T {
	var value T
	_ = json.Unmarshal([]byte(raw), &value)
	return value
}

func truncateRunesForStudyNote(text string, max int) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max])
}

func splitStudyNoteSentences(text string) []string {
	return regexp.MustCompile(`[^.!?]+[.!?]+["')\]]*|[^.!?]+$`).FindAllString(strings.TrimSpace(text), -1)
}

func firstStudyNoteSentence(text string) string {
	sentences := splitStudyNoteSentences(text)
	if len(sentences) == 0 {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(sentences[0])
}

func sentenceStudyTips(text string) []string {
	lower := strings.ToLower(text)
	tips := []string{"先找谓语动词和主句，再处理修饰信息。"}
	if strings.Contains(text, ",") {
		tips = append(tips, "逗号内的信息可以先跳过，读完主句后再补回。")
	}
	if strings.Contains(lower, "which") || strings.Contains(lower, "that") || strings.Contains(lower, "who") {
		tips = append(tips, "注意从句回指的是哪个名词或观点。")
	}
	if strings.Contains(lower, "however") || strings.Contains(lower, "although") || strings.Contains(lower, "but") {
		tips = append(tips, "留意转折词后的信息，那里常是作者态度。")
	}
	return tips
}

func findStudyNoteExamples(content, marker string, limit int) []string {
	result := make([]string, 0, limit)
	for _, sentence := range splitStudyNoteSentences(content) {
		if marker == "" || strings.Contains(strings.ToLower(sentence), marker) {
			result = append(result, strings.TrimSpace(sentence))
		}
		if len(result) >= limit {
			break
		}
	}
	return result
}

func extractStudyNotePhrases(text string) []string {
	words := regexp.MustCompile(`[A-Za-z]+(?:['’][A-Za-z]+)?`).FindAllString(text, -1)
	result := make([]string, 0, 4)
	for i := 0; i < len(words)-1 && len(result) < 4; i++ {
		left := strings.ToLower(words[i])
		right := strings.ToLower(words[i+1])
		if isStudyNoteStopWord(left) || isStudyNoteStopWord(right) || len(left) < 4 || len(right) < 4 {
			continue
		}
		result = append(result, left+" "+right)
	}
	return result
}

func isStudyNoteStopWord(word string) bool {
	stop := map[string]bool{
		"the": true, "and": true, "for": true, "with": true, "that": true, "this": true,
		"from": true, "into": true, "could": true, "would": true, "should": true, "have": true,
		"has": true, "are": true, "was": true, "were": true, "how": true, "why": true,
		"can": true, "its": true, "they": true, "their": true, "there": true, "what": true,
	}
	return stop[strings.Trim(word, "'’-.")]
}

func firstNonEmptyStudyNote(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func minStudyNoteInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

package services

import (
	"math"
	"regexp"
	"sort"
	"strings"
)

const defaultReadingWordsPerMinute = 180

var articleWordPattern = regexp.MustCompile(`[A-Za-z]+(?:['-][A-Za-z]+)?`)

type ArticleAnalysis struct {
	WordCount       int      `json:"word_count"`
	ReadingTime     int      `json:"reading_time"`
	DifficultyLevel string   `json:"difficulty_level"`
	Keywords        []string `json:"keywords"`
	CEFRLevel       string   `json:"cefr_level"`
}

func AnalyzeArticleText(title, summary, content string) ArticleAnalysis {
	words := articleWordPattern.FindAllString(content, -1)
	wordCount := len(words)
	readingTime := int(math.Ceil(float64(wordCount) / defaultReadingWordsPerMinute))
	if readingTime < 1 {
		readingTime = 1
	}

	stats := analyzeWordStats(words)
	score := articleDifficultyScore(wordCount, stats)

	return ArticleAnalysis{
		WordCount:       wordCount,
		ReadingTime:     readingTime,
		DifficultyLevel: difficultyForScore(score),
		Keywords:        ExtractArticleKeywords(title, summary, content, 8),
		CEFRLevel:       cefrForScore(score),
	}
}

func CountArticleWords(text string) int {
	return len(articleWordPattern.FindAllString(text, -1))
}

func NormalizeDifficultyLevel(difficulty string) string {
	switch strings.ToLower(strings.TrimSpace(difficulty)) {
	case "", "auto":
		return ""
	case "easy", "medium", "hard":
		return strings.ToLower(strings.TrimSpace(difficulty))
	default:
		return ""
	}
}

func KeywordsToString(keywords []string) string {
	cleaned := make([]string, 0, len(keywords))
	seen := map[string]bool{}
	for _, keyword := range keywords {
		keyword = strings.TrimSpace(keyword)
		key := strings.ToLower(keyword)
		if keyword != "" && !seen[key] {
			cleaned = append(cleaned, keyword)
			seen[key] = true
		}
	}
	return strings.Join(cleaned, ",")
}

func ExtractArticleKeywords(title, summary, content string, limit int) []string {
	if limit <= 0 {
		return nil
	}

	type keywordStat struct {
		word       string
		count      int
		score      float64
		firstIndex int
	}

	counts := map[string]*keywordStat{}
	addWords := func(text string, weight float64) {
		for _, raw := range articleWordPattern.FindAllString(text, -1) {
			word := normalizeArticleKeyword(raw)
			if word == "" || articleStopWords[word] {
				continue
			}
			stat, ok := counts[word]
			if !ok {
				stat = &keywordStat{word: word, firstIndex: len(counts)}
				counts[word] = stat
			}
			stat.count++
			stat.score += weight
		}
	}

	addWords(title, 4)
	addWords(summary, 2)
	addWords(content, 1)

	keywords := make([]keywordStat, 0, len(counts))
	for _, stat := range counts {
		if stat.count < 2 && stat.score < 4 {
			continue
		}
		keywords = append(keywords, *stat)
	}
	sort.Slice(keywords, func(i, j int) bool {
		if keywords[i].score == keywords[j].score {
			if keywords[i].count == keywords[j].count {
				return keywords[i].word < keywords[j].word
			}
			return keywords[i].count > keywords[j].count
		}
		return keywords[i].score > keywords[j].score
	})

	if len(keywords) > limit {
		keywords = keywords[:limit]
	}

	result := make([]string, 0, len(keywords))
	for _, keyword := range keywords {
		result = append(result, keyword.word)
	}
	return result
}

type articleWordStats struct {
	AverageLength float64
	LongRatio     float64
	AdvancedRatio float64
}

func analyzeWordStats(words []string) articleWordStats {
	if len(words) == 0 {
		return articleWordStats{}
	}

	totalLength := 0
	longWords := 0
	advancedWords := 0
	for _, raw := range words {
		word := strings.ToLower(strings.Trim(raw, "'-"))
		totalLength += len(word)
		if len(word) >= 9 {
			longWords++
		}
		if isAdvancedArticleWord(word) {
			advancedWords++
		}
	}

	total := float64(len(words))
	return articleWordStats{
		AverageLength: float64(totalLength) / total,
		LongRatio:     float64(longWords) / total,
		AdvancedRatio: float64(advancedWords) / total,
	}
}

func articleDifficultyScore(wordCount int, stats articleWordStats) float64 {
	score := 0.0
	switch {
	case wordCount >= 1600:
		score += 2
	case wordCount >= 900:
		score += 1
	case wordCount <= 350:
		score -= 0.5
	}
	if stats.AverageLength >= 5.8 {
		score += 1
	} else if stats.AverageLength <= 4.6 {
		score -= 0.5
	}
	if stats.LongRatio >= 0.16 {
		score += 1
	} else if stats.LongRatio >= 0.10 {
		score += 0.5
	}
	if stats.AdvancedRatio >= 0.12 {
		score += 1.5
	} else if stats.AdvancedRatio >= 0.06 {
		score += 0.75
	}
	return score
}

func difficultyForScore(score float64) string {
	switch {
	case score < 1:
		return "easy"
	case score < 3:
		return "medium"
	default:
		return "hard"
	}
}

func cefrForScore(score float64) string {
	switch {
	case score < -0.25:
		return "A2"
	case score < 0.75:
		return "B1"
	case score < 2:
		return "B2"
	case score < 3.25:
		return "C1"
	default:
		return "C2"
	}
}

func normalizeArticleKeyword(raw string) string {
	word := strings.ToLower(strings.Trim(raw, "'-"))
	word = strings.TrimSuffix(word, "'s")
	if len(word) < 4 || len(word) > 32 {
		return ""
	}
	if strings.HasSuffix(word, "ies") && len(word) > 5 {
		word = strings.TrimSuffix(word, "ies") + "y"
	} else if strings.HasSuffix(word, "es") && len(word) > 5 {
		word = strings.TrimSuffix(word, "es")
	} else if strings.HasSuffix(word, "s") && len(word) > 5 {
		word = strings.TrimSuffix(word, "s")
	}
	return word
}

func isAdvancedArticleWord(word string) bool {
	if len(word) >= 11 {
		return true
	}
	for _, suffix := range []string{
		"tion", "sion", "ment", "ness", "ity", "ism", "ize", "ise",
		"ology", "graphy", "ative", "ential", "aneous", "ability",
	} {
		if strings.HasSuffix(word, suffix) && len(word) >= 8 {
			return true
		}
	}
	return false
}

var articleStopWords = map[string]bool{
	"about": true, "above": true, "after": true, "again": true, "against": true,
	"also": true, "among": true, "another": true, "because": true, "before": true,
	"being": true, "between": true, "could": true, "every": true, "first": true,
	"from": true, "have": true, "into": true, "just": true, "more": true,
	"most": true, "much": true, "only": true, "other": true, "over": true,
	"same": true, "should": true, "some": true, "such": true, "than": true,
	"that": true, "their": true, "them": true, "then": true, "there": true,
	"these": true, "they": true, "this": true, "those": true, "through": true,
	"under": true, "very": true, "what": true, "when": true, "where": true,
	"which": true, "while": true, "with": true, "would": true, "your": true,
}

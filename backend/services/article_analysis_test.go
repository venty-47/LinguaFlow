package services

import (
	"strings"
	"testing"
)

func TestAnalyzeArticleTextComputesMetadata(t *testing.T) {
	text := strings.Repeat("Scientists explain how climate policy affects communities and technology. ", 35)

	analysis := AnalyzeArticleText("Climate technology policy", "Scientists explain policy.", text)

	if analysis.WordCount != 315 {
		t.Fatalf("WordCount = %d, want 315", analysis.WordCount)
	}
	if analysis.ReadingTime != 2 {
		t.Fatalf("ReadingTime = %d, want 2", analysis.ReadingTime)
	}
	if analysis.DifficultyLevel == "" {
		t.Fatal("expected difficulty level")
	}
	if analysis.CEFRLevel == "" {
		t.Fatal("expected CEFR level")
	}
	if len(analysis.Keywords) == 0 {
		t.Fatal("expected keywords")
	}
}

func TestExtractArticleKeywordsWeightsTitleAndSummary(t *testing.T) {
	keywords := ExtractArticleKeywords(
		"Quantum computing breakthrough",
		"Researchers report a quantum computing result.",
		"Researchers said the computing system improves quantum error correction and quantum stability.",
		5,
	)

	if len(keywords) == 0 || keywords[0] != "quantum" {
		t.Fatalf("expected quantum as top keyword, got %#v", keywords)
	}
}

func TestNormalizeDifficultyLevel(t *testing.T) {
	if got := NormalizeDifficultyLevel("auto"); got != "" {
		t.Fatalf("auto normalized to %q, want empty", got)
	}
	if got := NormalizeDifficultyLevel("Hard"); got != "hard" {
		t.Fatalf("Hard normalized to %q, want hard", got)
	}
	if got := NormalizeDifficultyLevel("expert"); got != "" {
		t.Fatalf("invalid difficulty normalized to %q, want empty", got)
	}
}

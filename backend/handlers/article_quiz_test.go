package handlers

import (
	"testing"

	"gugudu-backend/models"
)

func TestBuildMultiTypeQuizQuestions(t *testing.T) {
	article := models.Article{
		Title:   "AI Revolution in Healthcare",
		Summary: "Artificial intelligence is transforming healthcare by enabling faster diagnosis and personalized treatment.",
		Content: "Artificial intelligence is transforming healthcare.\n\nMachine learning algorithms can analyze medical images with superhuman accuracy.\n\nThis technology helps doctors make better decisions.",
		Category: models.Category{
			Name: "Technology",
		},
		Tags: "AI, healthcare, technology",
	}

	tests := []struct {
		name          string
		questionTypes []string
		countPerType  int
		checkType     string
	}{
		{
			name:          "single_choice only",
			questionTypes: []string{"single_choice"},
			countPerType:  2,
			checkType:     "single_choice",
		},
		{
			name:          "true_false only",
			questionTypes: []string{"true_false"},
			countPerType:  2,
			checkType:     "true_false",
		},
		{
			name:          "main_idea only",
			questionTypes: []string{"main_idea"},
			countPerType:  2,
			checkType:     "main_idea",
		},
		{
			name:          "word_meaning only",
			questionTypes: []string{"word_meaning"},
			countPerType:  2,
			checkType:     "word_meaning",
		},
		{
			name:          "multiple types",
			questionTypes: []string{"single_choice", "true_false", "main_idea"},
			countPerType:  2,
			checkType:     "single_choice",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			questions := buildMultiTypeQuizQuestions(article, 1, tt.questionTypes, tt.countPerType)

			if len(questions) == 0 {
				t.Errorf("expected questions, got empty")
				return
			}

			typeCount := 0
			for _, q := range questions {
				if q.QuestionType == tt.checkType {
					typeCount++
				}
				if q.QuestionType == "" {
					t.Errorf("question has empty QuestionType")
				}
				if q.Prompt == "" {
					t.Errorf("question has empty Prompt")
				}
				if q.Options == "" {
					t.Errorf("question has empty Options")
				}
			}

			if tt.checkType == "single_choice" && typeCount == 0 {
				t.Errorf("expected at least one %s question", tt.checkType)
			}
		})
	}
}

func TestGenerateSingleChoiceQuestions(t *testing.T) {
	article := models.Article{
		Title:   "Test Article",
		Summary: "This is a test summary for the article.",
		Content: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
		Category: models.Category{
			Name: "Test",
		},
	}

	questions := generateSingleChoiceQuestions(article, 1, 1, 2)

	if len(questions) == 0 {
		t.Errorf("expected questions, got empty")
		return
	}

	for _, q := range questions {
		if q.QuestionType != "single_choice" {
			t.Errorf("expected single_choice, got %s", q.QuestionType)
		}
		if q.Prompt == "" {
			t.Errorf("prompt should not be empty")
		}
	}
}

func TestGenerateTrueFalseQuestions(t *testing.T) {
	article := models.Article{
		Title:   "Test Article",
		Summary: "This is a test summary.",
		Content: "First paragraph.\n\nSecond paragraph.",
		Category: models.Category{
			Name: "Test",
		},
	}

	questions := generateTrueFalseQuestions(article, 1, 1, 2)

	if len(questions) == 0 {
		t.Errorf("expected questions, got empty")
		return
	}

	for _, q := range questions {
		if q.QuestionType != "true_false" {
			t.Errorf("expected true_false, got %s", q.QuestionType)
		}
		options := decodeStringSlice(q.Options)
		if len(options) != 2 {
			t.Errorf("expected 2 options for true_false, got %d", len(options))
		}
	}
}

func TestGenerateMainIdeaQuestions(t *testing.T) {
	article := models.Article{
		Title:   "Test Article",
		Summary: "This is a test summary.",
		Content: "First paragraph.\n\nSecond paragraph.",
		Category: models.Category{
			Name: "Test",
		},
	}

	questions := generateMainIdeaQuestions(article, 1, 1, 2)

	if len(questions) == 0 {
		t.Errorf("expected questions, got empty")
		return
	}

	for _, q := range questions {
		if q.QuestionType != "main_idea" {
			t.Errorf("expected main_idea, got %s", q.QuestionType)
		}
	}
}

func TestGenerateWordMeaningQuestions(t *testing.T) {
	article := models.Article{
		Title:   "Test Article",
		Summary: "This is a test summary.",
		Content: "First paragraph.\n\nSecond paragraph.",
		Category: models.Category{
			Name: "Test",
		},
	}

	questions := generateWordMeaningQuestions(article, 1, 1, 2)

	if len(questions) == 0 {
		t.Errorf("expected questions, got empty")
		return
	}

	for _, q := range questions {
		if q.QuestionType != "word_meaning" {
			t.Errorf("expected word_meaning, got %s", q.QuestionType)
		}
	}
}

func TestQuizQuestionTypes(t *testing.T) {
	article := models.Article{
		Title:   "Test Article",
		Summary: "This is a test summary for the article.",
		Content: "First paragraph.\n\nSecond paragraph.",
		Category: models.Category{
			Name: "Test",
		},
	}

	questionTypes := []string{"single_choice", "true_false", "main_idea", "word_meaning"}
	for _, qt := range questionTypes {
		t.Run(qt, func(t *testing.T) {
			questions := buildMultiTypeQuizQuestions(article, 1, []string{qt}, 2)
			if len(questions) == 0 {
				t.Errorf("expected questions for type %s", qt)
			}
			for _, q := range questions {
				if q.QuestionType != qt {
					t.Errorf("expected %s, got %s", qt, q.QuestionType)
				}
			}
		})
	}
}
package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// EliaschenDictionaryResponse 词典API响应
type EliaschenDictionaryResponse struct {
	Word          string                    `json:"word"`
	Pos           []string                  `json:"pos"`
	Verbs         []EliaschenVerb           `json:"verbs"`
	Pronunciation []EliaschenPronunciation  `json:"pronunciation"`
	Definition    []EliaschenDefinition     `json:"definition"`
}

type EliaschenVerb struct {
	ID   int    `json:"id"`
	Type string `json:"type"`
	Text string `json:"text"`
}

type EliaschenPronunciation struct {
	Pos   string `json:"pos"`
	Lang  string `json:"lang"`
	URL   string `json:"url"`
	Pron  string `json:"pron"`
}

type EliaschenDefinition struct {
	ID          int                `json:"id"`
	Pos         string             `json:"pos"`
	Text        string             `json:"text"`
	Translation string             `json:"translation"`
	Example     []EliaschenExample `json:"example"`
}

type EliaschenExample struct {
	ID          int    `json:"id"`
	Text        string `json:"text"`
	Translation string `json:"translation"`
}

// EliaschenDictionaryService 词典服务
type EliaschenDictionaryService struct {
	BaseURL    string
	ProxyURL   string
	HTTPClient *http.Client
}

// NewEliaschenDictionaryService 创建词典服务
func NewEliaschenDictionaryService(baseURL, proxyURL string) *EliaschenDictionaryService {
	if baseURL == "" {
		baseURL = "https://dictionary-api.eliaschen.dev"
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL != "" {
		if parsed, err := url.Parse(proxyURL); err == nil {
			transport.Proxy = http.ProxyURL(parsed)
		}
	}

	return &EliaschenDictionaryService{
		BaseURL:  strings.TrimRight(baseURL, "/"),
		ProxyURL: proxyURL,
		HTTPClient: &http.Client{
			Timeout:   10 * time.Second,
			Transport: transport,
		},
	}
}

// LookupWord 查询单词，dictMode: "en-cn"（英中，默认）或 "en"（英英，仅 Cambridge 词库支持）
func (s *EliaschenDictionaryService) LookupWord(word string, dictMode string) (*DictionaryResult, error) {
	if dictMode == "" {
		dictMode = "en-cn"
	}

	apiURL := fmt.Sprintf("%s/api/dictionary/%s/%s", s.BaseURL, dictMode, word)

	resp, err := s.HTTPClient.Get(apiURL)
	if err != nil {
		return nil, fmt.Errorf("Eliaschen 词典请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Eliaschen 词典返回状态 %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	var apiResp EliaschenDictionaryResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if apiResp.Word == "" {
		return nil, fmt.Errorf("Eliaschen 词典未收录该词")
	}

	result := &DictionaryResult{
		Word:        apiResp.Word,
		Definitions: make([]DefinitionItem, 0),
		WebMeanings: make([]WebMeaning, 0),
	}

	// 解析发音
	for _, p := range apiResp.Pronunciation {
		switch p.Lang {
		case "uk":
			result.UKPhonetic = p.Pron
			result.UKSpeechURL = p.URL
		case "us":
			result.USPhonetic = p.Pron
			result.USSpeechURL = p.URL
		}
	}
	if result.UKPhonetic != "" {
		result.Phonetic = result.UKPhonetic
	} else {
		result.Phonetic = result.USPhonetic
	}
	result.SpeechURL = result.USSpeechURL
	if result.SpeechURL == "" {
		result.SpeechURL = result.UKSpeechURL
	}

	// 解析释义
	lines := make([]string, 0, len(apiResp.Definition))
	for _, def := range apiResp.Definition {
		var text string
		switch dictMode {
		case "en":
			// 英英模式：使用英文原文释义
			text = strings.TrimSpace(def.Text)
		default:
			// 英中模式：使用中文翻译
			text = strings.TrimSpace(def.Translation)
		}
		if text != "" {
			result.Definitions = append(result.Definitions, DefinitionItem{
				Pos:        def.Pos,
				Definition: text,
			})
			lines = append(lines, text)
		}
	}
	if len(lines) > 0 {
		result.Translation = strings.Join(lines, "; ")
	}

	return result, nil
}

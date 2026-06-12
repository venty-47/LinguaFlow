package services

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// YoudaoDictionaryResponse 有道词典API响应
type YoudaoDictionaryResponse struct {
	ErrorCode   string   `json:"errorCode"`
	Query       string   `json:"query"`
	Translation []string `json:"translation"` // 翻译结果
	SpeakURL    string   `json:"speakUrl"`    // 原文发音
	Basic       *struct {
		Phonetic   string   `json:"phonetic"`    // 音标
		UKPhonetic string   `json:"uk-phonetic"` // 英式音标
		USPhonetic string   `json:"us-phonetic"` // 美式音标
		Explains   []string `json:"explains"`    // 基本释义
	} `json:"basic"`
	Web []struct {
		Key   string   `json:"key"`
		Value []string `json:"value"`
	} `json:"web"` // 网络释义
}

// DictionaryResult 词典查询结果
type DictionaryResult struct {
	Word        string           `json:"word"`
	Phonetic    string           `json:"phonetic"`
	UKPhonetic  string           `json:"uk_phonetic"`
	USPhonetic  string           `json:"us_phonetic"`
	SpeechURL   string           `json:"speech_url,omitempty"`
	UKSpeechURL string           `json:"uk_speech_url,omitempty"`
	USSpeechURL string           `json:"us_speech_url,omitempty"`
	Translation string           `json:"translation"`
	Definitions []DefinitionItem `json:"definitions"`
	WebMeanings []WebMeaning     `json:"web_meanings,omitempty"`
	Error       string           `json:"error,omitempty"`
}

type DefinitionItem struct {
	Pos        string `json:"pos"`        // 词性
	Definition string `json:"definition"` // 释义
}

type WebMeaning struct {
	Key   string   `json:"key"`
	Value []string `json:"value"`
}

// YoudaoDictionaryService 有道词典服务
type YoudaoDictionaryService struct {
	AppKey    string
	AppSecret string
}

// NewYoudaoDictionaryService 创建有道词典服务
func NewYoudaoDictionaryService(appKey, appSecret string) *YoudaoDictionaryService {
	return &YoudaoDictionaryService{
		AppKey:    appKey,
		AppSecret: appSecret,
	}
}

// LookupWord 查询单词
func (s *YoudaoDictionaryService) LookupWord(word string, _ string) (*DictionaryResult, error) {
	result, err := s.lookupOfficialDictionary(word)
	if err == nil {
		return result, nil
	}

	fmt.Printf("有道官方词典查询失败，回退文本翻译: %v\n", err)

	fallback, fallbackErr := s.lookupTextTranslate(word)
	if fallbackErr != nil {
		return nil, err
	}
	fallback.Error = err.Error()
	return fallback, nil
}

func (s *YoudaoDictionaryService) lookupOfficialDictionary(word string) (*DictionaryResult, error) {
	salt := strconv.FormatInt(time.Now().UnixNano(), 10)
	curtime := strconv.FormatInt(time.Now().Unix(), 10)
	sign := s.generateSign(word, salt, curtime)

	apiURL := "https://openapi.youdao.com/v2/dict"
	params := url.Values{}
	params.Set("q", word)
	params.Set("langType", "en")
	params.Set("dicts", "ec")
	params.Set("docType", "json")
	params.Set("appKey", s.AppKey)
	params.Set("salt", salt)
	params.Set("sign", sign)
	params.Set("signType", "v3")
	params.Set("curtime", curtime)

	resp, err := http.PostForm(apiURL, params)
	if err != nil {
		return nil, fmt.Errorf("有道词典请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	errorCode := stringValue(raw["errorCode"])
	if errorCode != "0" {
		msg := firstString(raw, "msg", "message")
		if msg == "" {
			msg = youdaoDictionaryErrorMessage(errorCode)
		}
		return nil, fmt.Errorf("有道词典错误代码 %s: %s", errorCode, msg)
	}

	result := &DictionaryResult{
		Word:        word,
		UKSpeechURL: s.voiceURL(word, "1"),
		USSpeechURL: s.voiceURL(word, "2"),
		Definitions: make([]DefinitionItem, 0),
		WebMeanings: make([]WebMeaning, 0),
	}

	for _, item := range interfaceSlice(raw["result"]) {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		ec, ok := itemMap["ec"].(map[string]interface{})
		if !ok {
			continue
		}

		if basic, ok := ec["basic"].(map[string]interface{}); ok {
			result.Phonetic = firstString(basic, "phonetic")
			result.UKPhonetic = firstString(basic, "ukPhonetic", "uk-phonetic")
			result.USPhonetic = firstString(basic, "usPhonetic", "us-phonetic")
			result.UKSpeechURL = firstString(basic, "ukSpeech")
			result.USSpeechURL = firstString(basic, "usSpeech")
			for _, explain := range stringSlice(basic["explains"]) {
				result.Definitions = append(result.Definitions, DefinitionItem{Definition: explain})
			}
		}

		for _, web := range interfaceSlice(ec["web"]) {
			webMap, ok := web.(map[string]interface{})
			if !ok {
				continue
			}
			meaning := firstString(webMap, "meaning")
			values := stringSlice(webMap["explain"])
			if meaning != "" {
				values = append(values, meaning)
			}
			if phrase := firstString(webMap, "phrase"); phrase != "" && len(values) > 0 {
				result.WebMeanings = append(result.WebMeanings, WebMeaning{
					Key:   phrase,
					Value: values,
				})
			}
		}
	}

	if result.UKSpeechURL == "" {
		result.UKSpeechURL = s.voiceURL(word, "1")
	}
	if result.USSpeechURL == "" {
		result.USSpeechURL = s.voiceURL(word, "2")
	}
	result.SpeechURL = result.USSpeechURL

	definitions := make([]string, 0, len(result.Definitions))
	for _, definition := range result.Definitions {
		definitions = append(definitions, definition.Definition)
	}
	result.Translation = strings.Join(definitions, "\n")

	if result.Translation == "" && result.Phonetic == "" && result.UKPhonetic == "" && result.USPhonetic == "" {
		return nil, fmt.Errorf("有道词典结果为空")
	}

	return result, nil
}

func (s *YoudaoDictionaryService) lookupTextTranslate(word string) (*DictionaryResult, error) {
	salt := strconv.FormatInt(time.Now().Unix(), 10)
	curtime := strconv.FormatInt(time.Now().Unix(), 10)
	sign := s.generateSign(word, salt, curtime)

	apiURL := "https://openapi.youdao.com/api"
	params := url.Values{}
	params.Set("q", word)
	params.Set("from", "en")
	params.Set("to", "zh-CHS")
	params.Set("appKey", s.AppKey)
	params.Set("salt", salt)
	params.Set("sign", sign)
	params.Set("signType", "v3")
	params.Set("curtime", curtime)

	resp, err := http.Get(apiURL + "?" + params.Encode())
	if err != nil {
		return nil, fmt.Errorf("有道词典请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	// 调试：打印原始响应
	fmt.Printf("有道词典 API 原始响应: %s\n", string(body))

	var result YoudaoDictionaryResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if result.ErrorCode != "0" {
		return nil, fmt.Errorf("有道词典错误代码: %s", result.ErrorCode)
	}

	// 构建返回结果
	dictResult := &DictionaryResult{
		Word:        word,
		SpeechURL:   result.SpeakURL,
		UKSpeechURL: s.voiceURL(word, "1"),
		USSpeechURL: s.voiceURL(word, "2"),
		Definitions: make([]DefinitionItem, 0),
		WebMeanings: make([]WebMeaning, 0),
	}

	// 获取翻译
	if len(result.Translation) > 0 {
		dictResult.Translation = result.Translation[0]
	}

	// 获取音标和基本释义
	if result.Basic != nil {
		dictResult.Phonetic = result.Basic.Phonetic
		dictResult.UKPhonetic = result.Basic.UKPhonetic
		dictResult.USPhonetic = result.Basic.USPhonetic

		// 解析基本释义（格式如 "n. 所有者"）
		for _, explain := range result.Basic.Explains {
			dictResult.Definitions = append(dictResult.Definitions, DefinitionItem{
				Pos:        "",
				Definition: explain,
			})
		}
	}

	// 获取网络释义
	for _, web := range result.Web {
		dictResult.WebMeanings = append(dictResult.WebMeanings, WebMeaning{
			Key:   web.Key,
			Value: web.Value,
		})
	}

	return dictResult, nil
}

// generateSign 生成有道词典签名
func (s *YoudaoDictionaryService) generateSign(text, salt, curtime string) string {
	input := s.truncate(text)
	str := s.AppKey + input + salt + curtime + s.AppSecret
	hash := sha256.Sum256([]byte(str))
	return hex.EncodeToString(hash[:])
}

// truncate 截断文本（有道签名规则）
func (s *YoudaoDictionaryService) truncate(text string) string {
	runes := []rune(text)
	length := len(runes)
	if length <= 20 {
		return text
	}
	return string(runes[:10]) + strconv.Itoa(length) + string(runes[length-10:])
}

func DictionaryVoiceURL(word, voiceType string) string {
	params := url.Values{}
	params.Set("audio", word)
	params.Set("type", voiceType)
	return "https://dict.youdao.com/dictvoice?" + params.Encode()
}

func (s *YoudaoDictionaryService) voiceURL(word, voiceType string) string {
	return DictionaryVoiceURL(word, voiceType)
}

func stringValue(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	default:
		return ""
	}
}

func firstString(values map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value := stringValue(values[key]); value != "" {
			return value
		}
	}
	return ""
}

func interfaceSlice(value interface{}) []interface{} {
	if values, ok := value.([]interface{}); ok {
		return values
	}
	return nil
}

func stringSlice(value interface{}) []string {
	switch typed := value.(type) {
	case string:
		if typed == "" {
			return nil
		}
		return []string{typed}
	case []string:
		return typed
	case []interface{}:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := stringValue(item); text != "" {
				values = append(values, text)
			}
		}
		return values
	default:
		return nil
	}
}

func youdaoDictionaryErrorMessage(code string) string {
	switch code {
	case "101":
		return "缺少必填参数"
	case "102":
		return "不支持的语言类型"
	case "108":
		return "应用ID无效"
	case "110":
		return "当前应用没有绑定有道词典服务"
	case "120":
		return "不是词，或词典未收录"
	case "202":
		return "签名校验失败"
	case "301":
		return "词典查询失败"
	case "401":
		return "账户已经欠费"
	default:
		return "未知错误"
	}
}

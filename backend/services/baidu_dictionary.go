package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type BaiduDictionaryService struct {
	APIKey         string
	SecretKey      string
	client         *http.Client
	accessToken    string
	tokenExpiresAt time.Time
	mu             sync.Mutex
}

type baiduAccessTokenResponse struct {
	AccessToken      string `json:"access_token"`
	ExpiresIn        int64  `json:"expires_in"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

type baiduDictionaryResponse struct {
	Result *struct {
		From        string `json:"from"`
		To          string `json:"to"`
		TransResult []struct {
			Src    string      `json:"src"`
			Dst    string      `json:"dst"`
			SrcTTS string      `json:"src_tts"`
			DstTTS string      `json:"dst_tts"`
			Dict   interface{} `json:"dict"`
		} `json:"trans_result"`
	} `json:"result"`
	ErrorCode interface{} `json:"error_code"`
	ErrorMsg  string      `json:"error_msg"`
}

type baiduInnerDictionary struct {
	WordResult struct {
		EDict       baiduEDict `json:"edict"`
		SimpleMeans struct {
			WordName  string   `json:"word_name"`
			WordMeans []string `json:"word_means"`
			Symbols   []struct {
				PhEN    string `json:"ph_en"`
				PhAM    string `json:"ph_am"`
				PhOther string `json:"ph_other"`
				Parts   []struct {
					Part  string   `json:"part"`
					Means []string `json:"means"`
				} `json:"parts"`
			} `json:"symbols"`
		} `json:"simple_means"`
	} `json:"word_result"`
}

type baiduEDict struct {
	Item []baiduEDictItem `json:"item"`
}

type baiduEDictItem struct {
	Pos     string              `json:"pos"`
	TRGroup []baiduEDictTRGroup `json:"tr_group"`
}

type baiduEDictTRGroup struct {
	TR      baiduTextList `json:"tr"`
	Example baiduTextList `json:"example"`
}

type baiduTextList []string

func (e *baiduEDict) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if bytes.Equal(data, []byte(`null`)) || len(data) == 0 {
		return nil
	}

	var encoded string
	if err := json.Unmarshal(data, &encoded); err == nil {
		encoded = strings.TrimSpace(encoded)
		if encoded == "" {
			return nil
		}
		data = []byte(encoded)
	}

	type alias baiduEDict
	var parsed alias
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil
	}
	*e = baiduEDict(parsed)
	return nil
}

func (l *baiduTextList) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if bytes.Equal(data, []byte(`""`)) || bytes.Equal(data, []byte(`null`)) || len(data) == 0 {
		return nil
	}

	var one string
	if err := json.Unmarshal(data, &one); err == nil {
		if one != "" {
			*l = append(*l, one)
		}
		return nil
	}

	var many []interface{}
	if err := json.Unmarshal(data, &many); err != nil {
		return err
	}
	for _, item := range many {
		for _, text := range baiduTextValues(item) {
			if text != "" {
				*l = append(*l, text)
			}
		}
	}
	return nil
}

func NewBaiduDictionaryService(apiKey, secretKey string) *BaiduDictionaryService {
	return &BaiduDictionaryService{
		APIKey:    apiKey,
		SecretKey: secretKey,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (s *BaiduDictionaryService) LookupWord(word string, _ string) (*DictionaryResult, error) {
	token, err := s.getAccessToken()
	if err != nil {
		return nil, err
	}

	payload := map[string]string{
		"q":       word,
		"from":    "en",
		"to":      "zh",
		"termIds": "",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("构建百度词典请求失败: %w", err)
	}

	endpoint := "https://aip.baidubce.com/rpc/2.0/mt/texttrans-with-dict/v1"
	req, err := http.NewRequest(http.MethodPost, endpoint+"?access_token="+url.QueryEscape(token), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("构建百度词典请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("百度词典请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取百度词典响应失败: %w", err)
	}

	var result baiduDictionaryResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("解析百度词典响应失败: %w", err)
	}

	if code := stringValue(result.ErrorCode); code != "" && code != "0" {
		return nil, fmt.Errorf("百度词典错误代码 %s: %s", code, result.ErrorMsg)
	}
	if result.Result == nil || len(result.Result.TransResult) == 0 {
		return nil, fmt.Errorf("百度词典结果为空")
	}

	item := result.Result.TransResult[0]
	dictResult := &DictionaryResult{
		Word:        item.Src,
		Translation: item.Dst,
		SpeechURL:   item.SrcTTS,
		UKSpeechURL: DictionaryVoiceURL(word, "1"),
		USSpeechURL: DictionaryVoiceURL(word, "2"),
		Definitions: make([]DefinitionItem, 0),
		WebMeanings: make([]WebMeaning, 0),
	}
	if dictResult.Word == "" {
		dictResult.Word = word
	}

	if err := mergeBaiduDict(item.Dict, dictResult); err != nil {
		dictResult.Error = err.Error()
	}
	if dictResult.Translation == "" {
		dictResult.Translation = item.Dst
	}
	if len(dictResult.Definitions) == 0 && item.Dst != "" {
		dictResult.Definitions = append(dictResult.Definitions, DefinitionItem{Definition: item.Dst})
	}

	return dictResult, nil
}

func (s *BaiduDictionaryService) getAccessToken() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.accessToken != "" && time.Now().Before(s.tokenExpiresAt) {
		return s.accessToken, nil
	}

	params := url.Values{}
	params.Set("grant_type", "client_credentials")
	params.Set("client_id", s.APIKey)
	params.Set("client_secret", s.SecretKey)

	tokenURL := "https://aip.baidubce.com/oauth/2.0/token?" + params.Encode()
	resp, err := s.client.Get(tokenURL)
	if err != nil {
		return "", fmt.Errorf("获取百度 access_token 失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取百度 access_token 响应失败: %w", err)
	}

	var tokenResp baiduAccessTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("解析百度 access_token 响应失败: %w", err)
	}
	if tokenResp.AccessToken == "" {
		return "", fmt.Errorf("获取百度 access_token 失败: %s %s", tokenResp.Error, tokenResp.ErrorDescription)
	}

	expiresIn := tokenResp.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = int64((24 * time.Hour).Seconds())
	}
	s.accessToken = tokenResp.AccessToken
	s.tokenExpiresAt = time.Now().Add(time.Duration(expiresIn-300) * time.Second)

	return s.accessToken, nil
}

func mergeBaiduDict(raw interface{}, result *DictionaryResult) error {
	if raw == nil {
		return fmt.Errorf("百度词典未返回 dict 字段")
	}

	var dict baiduInnerDictionary
	switch value := raw.(type) {
	case string:
		if value == "" {
			return fmt.Errorf("百度词典 dict 字段为空")
		}
		if err := json.Unmarshal([]byte(value), &dict); err != nil {
			return fmt.Errorf("解析百度词典 dict 失败: %w", err)
		}
	default:
		bytes, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("解析百度词典 dict 失败: %w", err)
		}
		if err := json.Unmarshal(bytes, &dict); err != nil {
			return fmt.Errorf("解析百度词典 dict 失败: %w", err)
		}
	}

	simple := dict.WordResult.SimpleMeans
	if simple.WordName != "" {
		result.Word = simple.WordName
	}
	if len(simple.WordMeans) > 0 {
		result.Translation = strings.Join(simple.WordMeans, "\n")
	}

	for _, symbol := range simple.Symbols {
		if result.UKPhonetic == "" {
			result.UKPhonetic = symbol.PhEN
		}
		if result.USPhonetic == "" {
			result.USPhonetic = symbol.PhAM
		}
		if result.Phonetic == "" {
			result.Phonetic = firstBaiduNonEmpty(symbol.PhEN, symbol.PhAM, symbol.PhOther)
		}

		for _, part := range symbol.Parts {
			for _, mean := range part.Means {
				definition := mean
				if part.Part != "" {
					definition = part.Part + " " + mean
				}
				result.Definitions = append(result.Definitions, DefinitionItem{
					Pos:        part.Part,
					Definition: definition,
				})
			}
		}
	}

	for _, item := range dict.WordResult.EDict.Item {
		values := make([]string, 0)
		for _, group := range item.TRGroup {
			values = append(values, group.TR...)
			values = append(values, group.Example...)
		}
		if item.Pos != "" && len(values) > 0 {
			result.WebMeanings = append(result.WebMeanings, WebMeaning{
				Key:   item.Pos,
				Value: values,
			})
		}
	}

	return nil
}

func firstBaiduNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func baiduTextValues(value interface{}) []string {
	switch typed := value.(type) {
	case string:
		if typed == "" {
			return nil
		}
		return []string{typed}
	case map[string]interface{}:
		values := make([]string, 0, len(typed))
		for _, key := range []string{"tr", "tran", "dst", "mean", "meaning", "example"} {
			values = append(values, baiduTextValues(typed[key])...)
		}
		return values
	case []interface{}:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			values = append(values, baiduTextValues(item)...)
		}
		return values
	default:
		return nil
	}
}

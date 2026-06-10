package config

import (
	"fmt"
	"log"
	"os"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Database      DatabaseConfig      `toml:"database"`
	Redis         RedisConfig         `toml:"redis"`
	JWT           JWTConfig           `toml:"jwt"`
	Server        ServerConfig        `toml:"server"`
	CORS          CORSConfig          `toml:"cors"`
	Translation   TranslationConfig   `toml:"translation"`
	AI            AIConfig            `toml:"ai"`
	TTS           TTSConfig           `toml:"tts"`
	RSS           RSSConfig           `toml:"rss"`
	AO3           AO3Config           `toml:"ao3"`
	VideoLearning VideoLearningConfig `toml:"video_learning"`
}

type TranslationConfig struct {
	BaiduAppID         string `toml:"baidu_appid"`
	BaiduSecret        string `toml:"baidu_secret"`
	BaiduDictAPIKey    string `toml:"baidu_dict_api_key"`
	BaiduDictSecretKey string `toml:"baidu_dict_secret_key"`
	YoudaoAppKey       string `toml:"youdao_appkey"`
	YoudaoAppSecret    string `toml:"youdao_appsecret"`
}

type AIConfig struct {
	Enabled        bool   `toml:"enabled"`
	BaseURL        string `toml:"base_url"`
	APIKey         string `toml:"api_key"`
	Model          string `toml:"model"`
	RequestTimeout int    `toml:"request_timeout_seconds"`
}

type TTSConfig struct {
	Enabled        bool   `toml:"enabled"`
	BaseURL        string `toml:"base_url"`
	APIKey         string `toml:"api_key"`
	Model          string `toml:"model"`
	Voice          string `toml:"voice"`
	ResponseFormat string `toml:"response_format"`
	Instructions   string `toml:"instructions"`
	CacheDir       string `toml:"cache_dir"`
	RequestTimeout int    `toml:"request_timeout_seconds"`
	MaxInputLength int    `toml:"max_input_length"`
}

type RSSConfig struct {
	Enabled               bool            `toml:"enabled"`
	Proxy                 string          `toml:"proxy"`
	UserAgent             string          `toml:"user_agent"`
	RequestTimeoutSeconds int             `toml:"request_timeout_seconds"`
	MaxItemsPerFeed       int             `toml:"max_items_per_feed"`
	Feeds                 []RSSFeedConfig `toml:"feeds"`
}

type RSSFeedConfig struct {
	Name         string `toml:"name"`
	URL          string `toml:"url"`
	Source       string `toml:"source"`
	CategoryName string `toml:"category_name"`
	CategoryEN   string `toml:"category_en"`
	CategorySlug string `toml:"category_slug"`
	Tags         string `toml:"tags"`
	MaxItems     int    `toml:"max_items"`
	Enabled      bool   `toml:"enabled"`
}

type AO3Config struct {
	Proxy                 string `toml:"proxy"`
	RequestTimeoutSeconds int    `toml:"request_timeout_seconds"`
}

type VideoLearningConfig struct {
	Enabled                  bool   `toml:"enabled"`
	StorageDir               string `toml:"storage_dir"`
	AudioDir                 string `toml:"audio_dir"`
	TranscriptDir            string `toml:"transcript_dir"`
	MaxUploadMB              int    `toml:"max_upload_mb"`
	MaxDurationSeconds       int    `toml:"max_duration_seconds"`
	AllowedExtensions        string `toml:"allowed_extensions"`
	ProcessingTimeoutSeconds int    `toml:"processing_timeout_seconds"`
	TranscriptionProvider    string `toml:"transcription_provider"`
	TranscriptionBaseURL     string `toml:"transcription_base_url"`
	TranscriptionAPIKey      string `toml:"transcription_api_key"`
	TranscriptionModel       string `toml:"transcription_model"`
	MaxAudioUploadMB         int    `toml:"max_audio_upload_mb"`
}

type DatabaseConfig struct {
	Host     string `toml:"host"`
	Port     string `toml:"port"`
	User     string `toml:"user"`
	Password string `toml:"password"`
	DBName   string `toml:"dbname"`
}

type RedisConfig struct {
	Host     string `toml:"host"`
	Port     string `toml:"port"`
	Password string `toml:"password"`
}

type JWTConfig struct {
	Secret string `toml:"secret"`
}

type ServerConfig struct {
	Port    string `toml:"port"`
	GinMode string `toml:"gin_mode"`
}

type CORSConfig struct {
	AllowedOrigins string `toml:"allowed_origins"`
}

func LoadConfig() *Config {
	var config Config

	// 尝试读取 config.toml 文件
	configPath := "config.toml"
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		log.Fatalf("配置文件 %s 不存在，请参考 config.toml.example 创建配置文件", configPath)
	}

	if _, err := toml.DecodeFile(configPath, &config); err != nil {
		log.Fatalf("无法解析配置文件: %v", err)
	}

	return &config
}

func (c *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable TimeZone=Asia/Shanghai",
		c.Host, c.Port, c.User, c.Password, c.DBName)
}

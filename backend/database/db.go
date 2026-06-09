package database

import (
	"context"
	"fmt"
	"gugudu-backend/config"
	"gugudu-backend/models"
	"log"

	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var (
	DB  *gorm.DB
	RDB *redis.Client
)

// InitDB 初始化数据库连接
func InitDB(cfg *config.Config) error {
	var err error

	// 连接 PostgreSQL
	DB, err = gorm.Open(postgres.Open(cfg.Database.DSN()), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	// 自动迁移数据库表
	if err := DB.AutoMigrate(
		&models.User{},
		&models.Category{},
		&models.Article{},
		&models.ArticleQuiz{},
		&models.ArticleQuizQuestion{},
		&models.ArticleQuizAttempt{},
		&models.ArticleStudyEvent{},
		&models.ArticleStudyNote{},
		&models.Subscription{},
		&models.ReadHistory{},
		&models.Vocabulary{},
		&models.TranslationCache{},
		&models.DictionaryCache{},
		&models.Order{},
		&models.MembershipBenefit{},
		&models.StudyGoal{},
		&models.StudyRecord{},
		&models.KnowledgeNode{},
		&models.KnowledgeEdge{},
		&models.UserKnowledgeState{},
		&models.VideoLesson{},
		&models.VideoSubtitle{},
		&models.VideoProcessingJob{},
	); err != nil {
		return fmt.Errorf("failed to migrate database: %w", err)
	}

	if err := SeedDemoData(); err != nil {
		return fmt.Errorf("failed to seed database: %w", err)
	}

	log.Println("Database connected and migrated successfully")
	return nil
}

// InitRedis 初始化 Redis 连接
func InitRedis(cfg *config.Config) error {
	RDB = redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", cfg.Redis.Host, cfg.Redis.Port),
		Password: cfg.Redis.Password,
		DB:       0,
	})

	// 测试连接
	ctx := context.Background()
	if err := RDB.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("failed to connect to redis: %w", err)
	}

	log.Println("Redis connected successfully")
	return nil
}

// CloseDB 关闭数据库连接
func CloseDB() error {
	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// CloseRedis 关闭 Redis 连接
func CloseRedis() error {
	return RDB.Close()
}

package main

import (
	"gugudu-backend/config"
	"gugudu-backend/database"
	"gugudu-backend/handlers"
	"gugudu-backend/middleware"
	"log"
	"net/url"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	// 加载配置
	cfg := config.LoadConfig()

	// 设置 Gin 模式
	gin.SetMode(cfg.Server.GinMode)

	// 初始化数据库
	if err := database.InitDB(cfg); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer database.CloseDB()

	// 初始化 Redis
	if err := database.InitRedis(cfg); err != nil {
		log.Fatal("Failed to initialize Redis:", err)
	}
	defer database.CloseRedis()

	// 初始化 JWT
	middleware.InitJWT(cfg.JWT.Secret)

	// 初始化翻译服务
	handlers.InitTranslationService(
		cfg.Translation.BaiduAppID,
		cfg.Translation.BaiduSecret,
		cfg.Translation.BaiduDictAPIKey,
		cfg.Translation.BaiduDictSecretKey,
		cfg.Translation.YoudaoAppKey,
		cfg.Translation.YoudaoAppSecret,
		cfg.Translation.EliaschenDictURL,
		cfg.Translation.EliaschenDictProxy,
	)
	handlers.InitAIAnalysisService(
		cfg.AI.Enabled,
		cfg.AI.BaseURL,
		firstNonEmpty(cfg.AI.APIKey, cfg.TTS.APIKey),
		cfg.AI.Model,
		cfg.AI.RequestTimeout,
	)
	handlers.InitTTSService(
		cfg.TTS.Enabled,
		cfg.TTS.BaseURL,
		cfg.TTS.APIKey,
		cfg.TTS.Model,
		cfg.TTS.Voice,
		cfg.TTS.ResponseFormat,
		cfg.TTS.Instructions,
		cfg.TTS.CacheDir,
		cfg.TTS.RequestTimeout,
		cfg.TTS.MaxInputLength,
	)
	handlers.InitRSSImportService(database.DB, cfg.RSS)
	handlers.InitAO3Service(
		firstNonEmpty(cfg.AO3.Proxy, cfg.RSS.Proxy),
		firstPositive(cfg.AO3.RequestTimeoutSeconds, cfg.RSS.RequestTimeoutSeconds),
	)
	handlers.InitVideoLearningService(database.DB, cfg.VideoLearning)
	handlers.LinkTranslationToVideoLearning()
	handlers.InitVideoUnderstandingService(handlers.GetAIAnalysisService())

	// 创建 Gin 路由
	r := gin.Default()
	if err := r.SetTrustedProxies(nil); err != nil {
		log.Fatal("Failed to set trusted proxies:", err)
	}
	r.Static("/storage", "storage")

	// CORS 配置
	r.Use(cors.New(cors.Config{
		AllowOrigins:     buildAllowedOrigins(cfg.CORS.AllowedOrigins),
		AllowOriginFunc:  buildAllowOriginFunc(cfg.CORS.AllowedOrigins),
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Import-Token"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	// API 路由组
	api := r.Group("/api")
	{
		// 认证相关（无需登录）
		auth := api.Group("/auth")
		{
			auth.POST("/register", handlers.Register)
			auth.POST("/login", handlers.Login)
		}

		// 公开文章接口
		articles := api.Group("/articles")
		{
			articles.GET("", middleware.OptionalAuth(), handlers.GetArticles)
			articles.GET("/featured", handlers.GetFeaturedArticles)
			articles.GET("/:slug", middleware.OptionalAuth(), handlers.GetArticleBySlug)
		}

		// 分类
		api.GET("/categories", handlers.GetCategories)

		// RSS 来源
		api.GET("/rss/feeds", handlers.GetRSSFeeds)

		// AO3 公开搜索与阅读代理（非官方，仅解析公开 HTML）
		ao3 := api.Group("/ao3")
		{
			ao3.GET("/search", handlers.SearchAO3Works)
			ao3.GET("/works/:id", handlers.GetAO3Work)
		}

		// 每日一句（无需登录）
		api.GET("/daily-sentence", handlers.GetDailySentence)

		// 翻译服务（无需登录）
		api.POST("/translate", middleware.OptionalAuth(), handlers.Translate)
		api.GET("/dictionary", middleware.OptionalAuth(), handlers.LookupWord)
		api.GET("/tts/audio/:filename", handlers.GetSpeechAudio)

		// RSS 导入（导入 token 保护，供本地脚本或定时任务调用）
		api.POST("/admin/rss/import", handlers.ImportRSS)

		admin := api.Group("/admin")
		admin.Use(middleware.AuthRequired(), middleware.AdminRequired())
		{
			admin.GET("/articles", handlers.AdminListArticles)
			admin.POST("/articles", handlers.AdminCreateArticle)
			admin.GET("/articles/:id", handlers.AdminGetArticle)
			admin.PUT("/articles/:id", handlers.AdminUpdateArticle)
			admin.DELETE("/articles/:id", handlers.AdminDeleteArticle)
			admin.PATCH("/articles/:id/status", handlers.AdminUpdateArticleStatus)
			admin.PATCH("/articles/:id/featured", handlers.AdminUpdateArticleFeatured)
		}

		// 需要认证的路由
		protected := api.Group("")
		protected.Use(middleware.AuthRequired())
		{
			// 用户相关
			protected.GET("/profile", handlers.GetProfile)
			protected.POST("/profile/avatar", handlers.UploadAvatar)

			// 会员相关
			membershipHandler := handlers.NewMembershipHandler(database.DB)
			membership := protected.Group("/membership")
			{
				membership.GET("/info", membershipHandler.GetMembershipInfo)
				membership.GET("/plans", membershipHandler.GetMembershipPlans)
				membership.GET("/benefits", membershipHandler.GetMembershipBenefits)
				membership.POST("/orders", membershipHandler.CreateOrder)
				membership.GET("/orders", membershipHandler.GetOrders)
				membership.POST("/orders/:order_no/activate", membershipHandler.ActivateMembership)
			}

			// 订阅管理
			protected.GET("/subscriptions", handlers.GetMySubscriptions)
			protected.POST("/subscriptions", handlers.AddSubscription)
			protected.DELETE("/subscriptions/:article_id", handlers.RemoveSubscription)
			protected.PUT("/subscriptions/move", handlers.MoveSubscription)

			// 收藏夹管理
			protected.GET("/favorite-folders", handlers.GetFavoriteFolders)
			protected.POST("/favorite-folders", handlers.CreateFavoriteFolder)
			protected.PUT("/favorite-folders/:id", handlers.UpdateFavoriteFolder)
			protected.DELETE("/favorite-folders/:id", handlers.DeleteFavoriteFolder)
			protected.PUT("/favorite-folders-sort", handlers.UpdateFolderSort)

			// 阅读历史
			protected.GET("/history", handlers.GetReadHistory)
			protected.POST("/articles/:id/progress", handlers.UpdateReadProgress)
			protected.POST("/articles/:id/assistant", middleware.PremiumRequired(database.DB), handlers.DiscussArticleWithAssistant)
			protected.GET("/article-quizzes/:id", handlers.GetArticleQuiz)
			protected.POST("/article-quizzes/:id/generate", handlers.GenerateArticleQuiz)
			protected.POST("/article-quizzes/:id/submit", handlers.SubmitArticleQuiz)
			protected.GET("/article-completions/:id", handlers.GetArticleCompletion)
			protected.GET("/article-knowledge-graph/:id", handlers.GetArticleKnowledgeGraph)
			protected.GET("/article-notes/:id", handlers.GetArticleStudyNote)
			protected.POST("/article-notes/:id", handlers.GenerateArticleStudyNote)
			protected.POST("/sentences/analyze", middleware.PremiumRequired(database.DB), handlers.AnalyzeSentence)
			protected.POST("/tts", handlers.GenerateSpeech)

			videoLessons := protected.Group("/video-lessons")
			{
				videoLessons.POST("", handlers.CreateVideoLesson)
				videoLessons.GET("", handlers.ListVideoLessons)
				videoLessons.GET("/:id", handlers.GetVideoLesson)
				videoLessons.DELETE("/:id", handlers.DeleteVideoLesson)
				videoLessons.POST("/:id/regenerate-subtitles", handlers.RegenerateVideoSubtitles)
				videoLessons.GET("/:id/subtitles", handlers.GetVideoSubtitles)
				videoLessons.GET("/:id/subtitles.vtt", handlers.GetVideoSubtitlesVTT)
				videoLessons.POST("/:id/subtitles/translate", handlers.TranslateVideoSubtitles)
				videoLessons.PATCH("/:id/subtitles/:subtitle_id", handlers.UpdateVideoSubtitle)
				videoLessons.POST("/:id/progress", handlers.UpdateVideoProgress)
				videoLessons.POST("/:id/understanding", handlers.GenerateVideoUnderstanding)
				videoLessons.GET("/:id/understanding", handlers.GetVideoUnderstanding)
				videoLessons.POST("/:id/chat", handlers.ChatWithVideo)
				videoLessons.GET("/:id/conversations", handlers.GetVideoConversations)
				videoLessons.DELETE("/:id/conversations", handlers.ClearVideoConversations)
			}

			// 每日学习
			protected.GET("/study/today", handlers.GetStudyToday)
			protected.GET("/study/diagnostics", handlers.GetStudyDiagnostics)
			protected.PUT("/study/goal", handlers.UpdateStudyGoal)

			// 学习知识图谱
			protected.GET("/knowledge-graph/overview", handlers.GetKnowledgeGraphOverview)
			protected.POST("/knowledge-graph/refresh", handlers.RefreshKnowledgeGraph)
			protected.GET("/knowledge-graph", handlers.GetKnowledgeGraph)

			// 生词本
			protected.GET("/vocabulary", handlers.GetVocabulary)
			protected.GET("/vocabulary/review-exercises", handlers.GetVocabularyReviewExercises)
			protected.GET("/vocabulary/:id/knowledge-graph", handlers.GetVocabularyKnowledgeGraph)
			protected.POST("/vocabulary", handlers.AddToVocabulary)
			protected.DELETE("/vocabulary/:id", handlers.DeleteVocabulary)
			protected.PATCH("/vocabulary/:id/learned", handlers.MarkWordLearned)
				protected.PATCH("/vocabulary/:id/notes", handlers.UpdateVocabularyNotes)
			protected.POST("/vocabulary/:id/review", handlers.ReviewVocabulary)
			protected.POST("/vocabulary/:id/review-answer", handlers.SubmitVocabularyReviewAnswer)
			protected.GET("/vocabulary/:id/mnemonic", handlers.GetVocabMnemonic)
			protected.GET("/vocabulary/:id/ai-examples", handlers.GetVocabAIExamples)
			protected.POST("/vocabulary/:id/chat", handlers.ChatWithVocab)

			// 词书背词
			wordbooks := protected.Group("/wordbooks")
			{
				wordbooks.GET("", handlers.ListWordBooks)
				wordbooks.GET("/:id", handlers.GetWordBook)
				wordbooks.POST("/:id/subscribe", handlers.SubscribeWordBook)
				wordbooks.DELETE("/:id/subscribe", handlers.UnsubscribeWordBook)
				wordbooks.PATCH("/:id/plan", handlers.UpdateWordBookPlan)
				wordbooks.GET("/:id/today", handlers.GetTodayTasks)
				wordbooks.POST("/:id/learn", handlers.SubmitLearnResult)
				wordbooks.POST("/:id/review", handlers.SubmitReviewResult)
				wordbooks.GET("/:id/stats", handlers.GetWordBookStats)
				wordbooks.GET("/:id/entries", handlers.GetWordBookEntries)
				wordbooks.GET("/:id/units", handlers.GetWordBookUnits)
				wordbooks.POST("/:id/reset", handlers.ResetWordBookProgress)
				wordbooks.GET("/:id/entries/:entryId/mnemonic", handlers.GetWordBookEntryMnemonic)
				wordbooks.GET("/:id/entries/:entryId/ai-examples", handlers.GetWordBookEntryAIExamples)
				wordbooks.POST("/:id/entries/:entryId/chat", handlers.ChatWithWordBookEntry)
			}
		}
	}

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// 启动服务器
	log.Printf("Server starting on port %s", cfg.Server.Port)
	if err := r.Run(":" + cfg.Server.Port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func buildAllowedOrigins(configured string) []string {
	seen := make(map[string]bool)
	origins := make([]string, 0)

	add := func(origin string) {
		origin = strings.TrimSpace(origin)
		if origin == "" || seen[origin] {
			return
		}
		seen[origin] = true
		origins = append(origins, origin)
	}

	for _, origin := range strings.Split(configured, ",") {
		add(origin)
	}

	add("http://localhost:3000")
	add("http://127.0.0.1:3000")
	add("http://[::1]:3000")

	return origins
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func firstPositive(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func buildAllowOriginFunc(configured string) func(string) bool {
	allowed := make(map[string]bool)
	for _, origin := range buildAllowedOrigins(configured) {
		allowed[origin] = true
	}

	return func(origin string) bool {
		if allowed[origin] {
			return true
		}

		parsed, err := url.Parse(origin)
		if err != nil {
			return false
		}

		host := parsed.Hostname()
		return parsed.Scheme == "http" &&
			(host == "localhost" || host == "127.0.0.1" || host == "::1")
	}
}

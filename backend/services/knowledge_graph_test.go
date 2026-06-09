package services

import (
	"errors"
	"gugudu-backend/models"
	"strconv"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupKnowledgeGraphTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Category{},
		&models.Article{},
		&models.Vocabulary{},
		&models.ReadHistory{},
		&models.KnowledgeNode{},
		&models.KnowledgeEdge{},
		&models.UserKnowledgeState{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestKnowledgeGraphSyncVocabularyCreatesPersistentGraph(t *testing.T) {
	db := setupKnowledgeGraphTestDB(t)
	user := models.User{Username: "learner", Email: "learner@example.com", Password: "secret"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	category := models.Category{Name: "Technology", NameEN: "Tech", Slug: "technology"}
	if err := db.Create(&category).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	article := models.Article{
		Title:           "AI changes how people learn",
		Slug:            "ai-learning",
		Content:         "Although AI is useful, learners still need practice.",
		CategoryID:      category.ID,
		Category:        category,
		Status:          "published",
		Tags:            "AI,education",
		Keywords:        "learning,practice",
		DifficultyLevel: "medium",
		CEFRLevel:       "B2",
		PublishedAt:     time.Now(),
	}
	if err := db.Create(&article).Error; err != nil {
		t.Fatalf("create article: %v", err)
	}
	nextReview := time.Now().Add(-24 * time.Hour)
	vocab := models.Vocabulary{
		UserID:         user.ID,
		Word:           "practice",
		Translation:    "练习；实践",
		Definition:     `[{"pos":"noun","definition":"repeated activity to improve a skill"}]`,
		Context:        "Although AI is useful, learners still need practice.",
		Examples:       `["Practice makes progress visible."]`,
		ArticleID:      &article.ID,
		Article:        &article,
		ReviewCount:    2,
		ForgottenCount: 1,
		NextReviewAt:   &nextReview,
	}
	if err := db.Create(&vocab).Error; err != nil {
		t.Fatalf("create vocabulary: %v", err)
	}

	service := NewKnowledgeGraphService(db)
	if err := service.SyncVocabulary(user.ID, vocab); err != nil {
		t.Fatalf("sync vocabulary: %v", err)
	}
	if err := service.SyncVocabulary(user.ID, vocab); err != nil {
		t.Fatalf("sync vocabulary again: %v", err)
	}

	var wordNodes int64
	if err := db.Model(&models.KnowledgeNode{}).
		Where("user_id = ? AND node_key = ?", user.ID, WordNodeKey(vocab.ID)).
		Count(&wordNodes).Error; err != nil {
		t.Fatalf("count word nodes: %v", err)
	}
	if wordNodes != 1 {
		t.Fatalf("word node count = %d, want 1", wordNodes)
	}

	graph, err := service.GetGraph(user.ID, KnowledgeGraphQuery{
		FocusType: KnowledgeNodeWord,
		FocusID:   vocab.ID,
		Depth:     2,
		Limit:     80,
	})
	if err != nil {
		t.Fatalf("get graph: %v", err)
	}
	if graph.Focus == nil || graph.Focus.ID != WordNodeKey(vocab.ID) {
		t.Fatalf("focus = %#v, want %s", graph.Focus, WordNodeKey(vocab.ID))
	}
	if graph.Stats.TotalNodes < 8 {
		t.Fatalf("total nodes = %d, want at least 8", graph.Stats.TotalNodes)
	}
	if graph.Stats.TotalEdges < 7 {
		t.Fatalf("total edges = %d, want at least 7", graph.Stats.TotalEdges)
	}
	if graph.Stats.GrammarPoints == 0 {
		t.Fatalf("grammar points = 0, want detected grammar")
	}
	if graph.Stats.DueReviews == 0 {
		t.Fatalf("due reviews = 0, want due review state")
	}

	searchGraph, err := service.GetGraph(user.ID, KnowledgeGraphQuery{
		Search: "practice",
		Types:  []string{KnowledgeNodeWord},
		Limit:  20,
	})
	if err != nil {
		t.Fatalf("search graph: %v", err)
	}
	if len(searchGraph.Nodes) != 1 || searchGraph.Nodes[0].Label != "practice" {
		t.Fatalf("search nodes = %#v, want practice word only", searchGraph.Nodes)
	}

	focusedFilteredGraph, err := service.GetGraph(user.ID, KnowledgeGraphQuery{
		FocusType: KnowledgeNodeWord,
		FocusID:   vocab.ID,
		Search:    "中文释义",
		Types:     []string{KnowledgeNodeMeaning},
		Depth:     2,
		Limit:     80,
	})
	if err != nil {
		t.Fatalf("focused filtered graph: %v", err)
	}
	for _, node := range focusedFilteredGraph.Nodes {
		if node.ID == WordNodeKey(vocab.ID) {
			continue
		}
		if node.Type != KnowledgeNodeMeaning {
			t.Fatalf("focused filtered graph included %s node %q; want only focus plus meaning nodes", node.Type, node.Label)
		}
	}

	var nodesAfterFirstQuery int64
	if err := db.Model(&models.KnowledgeNode{}).Where("user_id = ?", user.ID).Count(&nodesAfterFirstQuery).Error; err != nil {
		t.Fatalf("count nodes after query: %v", err)
	}
	if _, err := service.GetGraph(user.ID, KnowledgeGraphQuery{Limit: 80}); err != nil {
		t.Fatalf("get graph without focus: %v", err)
	}
	var nodesAfterSecondQuery int64
	if err := db.Model(&models.KnowledgeNode{}).Where("user_id = ?", user.ID).Count(&nodesAfterSecondQuery).Error; err != nil {
		t.Fatalf("count nodes after second query: %v", err)
	}
	if nodesAfterSecondQuery != nodesAfterFirstQuery {
		t.Fatalf("query changed node count from %d to %d; want no implicit resync growth", nodesAfterFirstQuery, nodesAfterSecondQuery)
	}
	if err := service.RefreshUserGraph(user.ID); err != nil {
		t.Fatalf("refresh graph: %v", err)
	}

	_, err = service.GetGraph(user.ID, KnowledgeGraphQuery{
		FocusType: KnowledgeNodeWord,
		FocusID:   999999,
	})
	if !errors.Is(err, ErrKnowledgeGraphFocusNotFound) {
		t.Fatalf("missing focus error = %v, want ErrKnowledgeGraphFocusNotFound", err)
	}
}

func TestKnowledgeGraphOverviewReturnsWeakDueAndTopicNodes(t *testing.T) {
	db := setupKnowledgeGraphTestDB(t)
	user := models.User{Username: "reader", Email: "reader@example.com", Password: "secret"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	category := models.Category{Name: "Science", NameEN: "Science", Slug: "science"}
	if err := db.Create(&category).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	article := models.Article{
		Title:           "Climate science explained",
		Slug:            "climate-science",
		Content:         "Because climate systems are complex, evidence matters.",
		CategoryID:      category.ID,
		Category:        category,
		Status:          "published",
		Tags:            "climate,science",
		DifficultyLevel: "hard",
		PublishedAt:     time.Now(),
	}
	if err := db.Create(&article).Error; err != nil {
		t.Fatalf("create article: %v", err)
	}
	nextReview := time.Now().Add(-time.Hour)
	vocab := models.Vocabulary{
		UserID:         user.ID,
		Word:           "evidence",
		Translation:    "证据",
		Context:        "Because climate systems are complex, evidence matters.",
		ArticleID:      &article.ID,
		Article:        &article,
		ForgottenCount: 3,
		NextReviewAt:   &nextReview,
	}
	if err := db.Create(&vocab).Error; err != nil {
		t.Fatalf("create vocabulary: %v", err)
	}

	overview, err := NewKnowledgeGraphService(db).GetOverview(user.ID)
	if err != nil {
		t.Fatalf("get overview: %v", err)
	}
	if overview.Stats.TotalNodes == 0 {
		t.Fatalf("overview has no nodes")
	}
	if len(overview.WeakNodes) == 0 {
		t.Fatalf("overview has no weak nodes")
	}
	if len(overview.DueNodes) == 0 {
		t.Fatalf("overview has no due nodes")
	}
	if len(overview.TopTopics) == 0 {
		t.Fatalf("overview has no topic nodes")
	}
	if len(overview.TopicClusters) == 0 {
		t.Fatalf("overview has no topic clusters")
	}
	cluster := overview.TopicClusters[0]
	if cluster.FocusKey == "" {
		t.Fatalf("topic cluster has no focus key")
	}
	if cluster.NodeCount < 2 || cluster.EdgeCount == 0 {
		t.Fatalf("topic cluster is too small: %#v", cluster)
	}
	if cluster.ArticleCount == 0 || len(cluster.Nodes) == 0 {
		t.Fatalf("topic cluster missing article/member nodes: %#v", cluster)
	}
	if len(overview.Recommendations) == 0 {
		t.Fatalf("overview has no recommendations")
	}
	if overview.Recommendations[0].Type != "review" {
		t.Fatalf("top recommendation type = %q, want review", overview.Recommendations[0].Type)
	}
	if overview.Recommendations[0].FocusKey == "" {
		t.Fatalf("top recommendation has no focus key")
	}
	if len(overview.LearningPaths) == 0 {
		t.Fatalf("overview has no learning paths")
	}
	path := overview.LearningPaths[0]
	if path.FocusKey == "" {
		t.Fatalf("learning path has no focus key")
	}
	if path.ActionLabel == "" || path.ActionHref == "" {
		t.Fatalf("learning path action label/href empty: %#v", path)
	}
	if len(path.Steps) < 2 {
		t.Fatalf("learning path steps = %d, want at least 2", len(path.Steps))
	}
	hasWord := false
	hasContextOrArticle := false
	for _, step := range path.Steps {
		if step.Node.ID == "" || step.Node.Label == "" {
			t.Fatalf("learning path step has empty node identity: %#v", step)
		}
		if step.Node.Type == KnowledgeNodeWord {
			hasWord = true
		}
		if step.Node.Type == KnowledgeNodeContext || step.Node.Type == KnowledgeNodeArticle {
			hasContextOrArticle = true
		}
	}
	if !hasWord {
		t.Fatalf("learning path has no word step: %#v", path.Steps)
	}
	if !hasContextOrArticle {
		t.Fatalf("learning path has no context/article step: %#v", path.Steps)
	}
}

func TestKnowledgeGraphRefreshRebuildsCanonicalGraph(t *testing.T) {
	db := setupKnowledgeGraphTestDB(t)
	user := models.User{Username: "refresh", Email: "refresh@example.com", Password: "secret"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	staleNode := models.KnowledgeNode{
		UserID:      user.ID,
		NodeKey:     "word:999",
		Type:        KnowledgeNodeWord,
		Label:       "stale",
		Description: "old data",
		Weight:      90,
	}
	if err := db.Create(&staleNode).Error; err != nil {
		t.Fatalf("create stale node: %v", err)
	}

	vocab := models.Vocabulary{
		UserID:      user.ID,
		Word:        "durable",
		Translation: "持久的",
	}
	if err := db.Create(&vocab).Error; err != nil {
		t.Fatalf("create vocabulary: %v", err)
	}

	service := NewKnowledgeGraphService(db)
	if err := service.RefreshUserGraph(user.ID); err != nil {
		t.Fatalf("refresh graph: %v", err)
	}

	var staleCount int64
	if err := db.Model(&models.KnowledgeNode{}).
		Where("user_id = ? AND node_key = ?", user.ID, staleNode.NodeKey).
		Count(&staleCount).Error; err != nil {
		t.Fatalf("count stale nodes: %v", err)
	}
	if staleCount != 0 {
		t.Fatalf("stale node count = %d, want 0 after canonical refresh", staleCount)
	}

	graph, err := service.GetGraph(user.ID, KnowledgeGraphQuery{Search: "durable", Types: []string{KnowledgeNodeWord}})
	if err != nil {
		t.Fatalf("get graph: %v", err)
	}
	if len(graph.Nodes) != 1 || graph.Nodes[0].ID != WordNodeKey(vocab.ID) {
		t.Fatalf("graph nodes after refresh = %#v, want only durable word", graph.Nodes)
	}
}

func TestKnowledgeGraphSyncPrunesStaleVocabularyDerivedNodes(t *testing.T) {
	db := setupKnowledgeGraphTestDB(t)
	user := models.User{Username: "prune", Email: "prune@example.com", Password: "secret"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	nextReview := time.Now().Add(time.Hour)
	vocab := models.Vocabulary{
		UserID:         user.ID,
		Word:           "fragile",
		Translation:    "脆弱的",
		Context:        "Although the plan was fragile, it worked.",
		Examples:       `["The fragile glass broke."]`,
		ForgottenCount: 2,
		NextReviewAt:   &nextReview,
	}
	if err := db.Create(&vocab).Error; err != nil {
		t.Fatalf("create vocabulary: %v", err)
	}

	service := NewKnowledgeGraphService(db)
	if err := service.SyncVocabulary(user.ID, vocab); err != nil {
		t.Fatalf("sync vocabulary: %v", err)
	}

	vocab.Context = ""
	vocab.Examples = ""
	vocab.ForgottenCount = 0
	vocab.NextReviewAt = nil
	if err := db.Save(&vocab).Error; err != nil {
		t.Fatalf("save vocabulary: %v", err)
	}
	if err := service.SyncVocabulary(user.ID, vocab); err != nil {
		t.Fatalf("sync updated vocabulary: %v", err)
	}

	staleKeys := []string{
		"context:" + strconv.Itoa(int(vocab.ID)),
		"example:" + strconv.Itoa(int(vocab.ID)),
		"weak:" + strconv.Itoa(int(vocab.ID)),
		"review:" + strconv.Itoa(int(vocab.ID)),
	}
	var staleCount int64
	if err := db.Model(&models.KnowledgeNode{}).
		Where("user_id = ? AND node_key IN ?", user.ID, staleKeys).
		Count(&staleCount).Error; err != nil {
		t.Fatalf("count stale nodes: %v", err)
	}
	if staleCount != 0 {
		t.Fatalf("stale derived node count = %d, want 0", staleCount)
	}

	stats, err := service.GetStats(user.ID)
	if err != nil {
		t.Fatalf("get stats: %v", err)
	}
	if stats.WeakSignals != 0 || stats.DueReviews != 0 {
		t.Fatalf("stats after prune weak=%d due=%d, want 0/0", stats.WeakSignals, stats.DueReviews)
	}
}

func TestKnowledgeGraphSyncPrunesStaleMeaningEdges(t *testing.T) {
	db := setupKnowledgeGraphTestDB(t)
	user := models.User{Username: "meaning", Email: "meaning@example.com", Password: "secret"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	vocab := models.Vocabulary{
		UserID:      user.ID,
		Word:        "precise",
		Translation: "精确的",
	}
	if err := db.Create(&vocab).Error; err != nil {
		t.Fatalf("create vocabulary: %v", err)
	}

	service := NewKnowledgeGraphService(db)
	if err := service.SyncVocabulary(user.ID, vocab); err != nil {
		t.Fatalf("sync vocabulary: %v", err)
	}

	vocab.Translation = ""
	if err := db.Save(&vocab).Error; err != nil {
		t.Fatalf("save vocabulary: %v", err)
	}
	if err := service.SyncVocabulary(user.ID, vocab); err != nil {
		t.Fatalf("sync updated vocabulary: %v", err)
	}

	graph, err := service.GetGraph(user.ID, KnowledgeGraphQuery{
		FocusType: KnowledgeNodeWord,
		FocusID:   vocab.ID,
		Depth:     1,
	})
	if err != nil {
		t.Fatalf("get graph: %v", err)
	}
	for _, edge := range graph.Edges {
		if edge.Relation == "defines" {
			t.Fatalf("graph still has defines edge after translation removal: %#v", edge)
		}
	}
	for _, node := range graph.Nodes {
		if node.Type == KnowledgeNodeMeaning {
			t.Fatalf("graph still has orphan meaning node after translation removal: %#v", node)
		}
	}
}

func TestKnowledgeGraphRemoveVocabularyGraphDeletesVocabularyCluster(t *testing.T) {
	db := setupKnowledgeGraphTestDB(t)
	user := models.User{Username: "remove", Email: "remove@example.com", Password: "secret"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	category := models.Category{Name: "Reading", NameEN: "Reading", Slug: "reading"}
	if err := db.Create(&category).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	article := models.Article{
		Title:           "Although readers forget, context helps",
		Slug:            "context-helps",
		Content:         "Although readers forget, context helps.",
		CategoryID:      category.ID,
		Category:        category,
		Status:          "published",
		Tags:            "reading",
		DifficultyLevel: "easy",
		PublishedAt:     time.Now(),
	}
	if err := db.Create(&article).Error; err != nil {
		t.Fatalf("create article: %v", err)
	}
	nextReview := time.Now().Add(-time.Hour)
	vocab := models.Vocabulary{
		UserID:         user.ID,
		Word:           "context",
		Translation:    "语境",
		Context:        "Although readers forget, context helps.",
		ArticleID:      &article.ID,
		Article:        &article,
		ForgottenCount: 1,
		NextReviewAt:   &nextReview,
	}
	if err := db.Create(&vocab).Error; err != nil {
		t.Fatalf("create vocabulary: %v", err)
	}

	service := NewKnowledgeGraphService(db)
	if err := service.SyncVocabulary(user.ID, vocab); err != nil {
		t.Fatalf("sync vocabulary: %v", err)
	}
	if err := service.RemoveVocabularyGraph(user.ID, vocab.ID); err != nil {
		t.Fatalf("remove vocabulary graph: %v", err)
	}

	var nodes int64
	if err := db.Model(&models.KnowledgeNode{}).Where("user_id = ?", user.ID).Count(&nodes).Error; err != nil {
		t.Fatalf("count nodes: %v", err)
	}
	if nodes != 0 {
		var remaining []models.KnowledgeNode
		if err := db.Where("user_id = ?", user.ID).Find(&remaining).Error; err != nil {
			t.Fatalf("list remaining nodes: %v", err)
		}
		t.Fatalf("node count after remove = %d, want 0; remaining=%#v", nodes, remaining)
	}
	var edges int64
	if err := db.Model(&models.KnowledgeEdge{}).Where("user_id = ?", user.ID).Count(&edges).Error; err != nil {
		t.Fatalf("count edges: %v", err)
	}
	if edges != 0 {
		t.Fatalf("edge count after remove = %d, want 0", edges)
	}
}

func TestKnowledgeGraphOverviewStatsUseFullGraph(t *testing.T) {
	db := setupKnowledgeGraphTestDB(t)
	user := models.User{Username: "large", Email: "large@example.com", Password: "secret"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	for i := 0; i < 181; i++ {
		vocab := models.Vocabulary{
			UserID:      user.ID,
			Word:        "word" + strconv.Itoa(i),
			Translation: "释义",
		}
		if err := db.Create(&vocab).Error; err != nil {
			t.Fatalf("create vocabulary %d: %v", i, err)
		}
	}

	overview, err := NewKnowledgeGraphService(db).GetOverview(user.ID)
	if err != nil {
		t.Fatalf("get overview: %v", err)
	}
	if overview.Stats.NodeTypes[KnowledgeNodeWord] != 181 {
		t.Fatalf("word stats = %d, want 181", overview.Stats.NodeTypes[KnowledgeNodeWord])
	}
	if overview.Stats.TotalNodes < 181 {
		t.Fatalf("total nodes = %d, want at least 181", overview.Stats.TotalNodes)
	}
}

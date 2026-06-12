package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"gugudu-backend/models"
	"regexp"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrKnowledgeGraphFocusNotFound = errors.New("knowledge graph focus node not found")

const (
	KnowledgeNodeWord       = "word"
	KnowledgeNodeMeaning    = "meaning"
	KnowledgeNodeDefinition = "definition"
	KnowledgeNodeContext    = "context"
	KnowledgeNodeExample    = "example"
	KnowledgeNodeArticle    = "article"
	KnowledgeNodeTopic      = "topic"
	KnowledgeNodeGrammar    = "grammar"
	KnowledgeNodeWeakness   = "weakness"
	KnowledgeNodeReview     = "review"
)

type KnowledgeGraphService struct {
	db *gorm.DB
}

type KnowledgeGraphNodeDTO struct {
	ID          string                 `json:"id"`
	DBID        uint                   `json:"db_id"`
	Type        string                 `json:"type"`
	Label       string                 `json:"label"`
	Description string                 `json:"description,omitempty"`
	Weight      int                    `json:"weight"`
	Mastery     *int                   `json:"mastery,omitempty"`
	Group       string                 `json:"group"`
	Level       int                    `json:"level"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

type KnowledgeGraphEdgeDTO struct {
	ID       string                 `json:"id"`
	DBID     uint                   `json:"db_id"`
	Source   string                 `json:"source"`
	Target   string                 `json:"target"`
	Relation string                 `json:"relation"`
	Label    string                 `json:"label"`
	Weight   int                    `json:"weight"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

type KnowledgeGraphStats struct {
	TotalNodes    int            `json:"total_nodes"`
	TotalEdges    int            `json:"total_edges"`
	RelatedWords  int            `json:"related_words"`
	Articles      int            `json:"articles"`
	Topics        int            `json:"topics"`
	GrammarPoints int            `json:"grammar_points"`
	WeakSignals   int            `json:"weak_signals"`
	DueReviews    int            `json:"due_reviews"`
	NodeTypes     map[string]int `json:"node_types"`
}

type KnowledgeGraphDTO struct {
	Focus  *KnowledgeGraphNodeDTO  `json:"focus,omitempty"`
	Nodes  []KnowledgeGraphNodeDTO `json:"nodes"`
	Edges  []KnowledgeGraphEdgeDTO `json:"edges"`
	Stats  KnowledgeGraphStats     `json:"stats"`
	Groups []KnowledgeGraphGroup   `json:"groups"`
}

type KnowledgeGraphGroup struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Color     string `json:"color"`
	NodeCount int    `json:"node_count"`
}

type KnowledgeGraphOverview struct {
	Stats           KnowledgeGraphStats            `json:"stats"`
	WeakNodes       []KnowledgeGraphNodeDTO        `json:"weak_nodes"`
	DueNodes        []KnowledgeGraphNodeDTO        `json:"due_nodes"`
	RecentNodes     []KnowledgeGraphNodeDTO        `json:"recent_nodes"`
	TopTopics       []KnowledgeGraphNodeDTO        `json:"top_topics"`
	TopicClusters   []KnowledgeGraphTopicCluster   `json:"topic_clusters"`
	Recommendations []KnowledgeGraphRecommendation `json:"recommendations"`
	LearningPaths   []KnowledgeGraphLearningPath   `json:"learning_paths"`
}

type KnowledgeGraphRecommendation struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`
	Priority    int                    `json:"priority"`
	Title       string                 `json:"title"`
	Description string                 `json:"description"`
	ActionLabel string                 `json:"action_label"`
	ActionHref  string                 `json:"action_href,omitempty"`
	FocusKey    string                 `json:"focus_key,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

type KnowledgeGraphPathStep struct {
	Node     KnowledgeGraphNodeDTO  `json:"node"`
	Via      string                 `json:"via,omitempty"`
	Relation string                 `json:"relation,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

type KnowledgeGraphLearningPath struct {
	ID          string                   `json:"id"`
	Type        string                   `json:"type"`
	Priority    int                      `json:"priority"`
	Title       string                   `json:"title"`
	Description string                   `json:"description"`
	ActionLabel string                   `json:"action_label"`
	ActionHref  string                   `json:"action_href,omitempty"`
	FocusKey    string                   `json:"focus_key,omitempty"`
	Steps       []KnowledgeGraphPathStep `json:"steps"`
}

type KnowledgeGraphTopicCluster struct {
	ID           string                  `json:"id"`
	Topic        KnowledgeGraphNodeDTO   `json:"topic"`
	NodeCount    int                     `json:"node_count"`
	EdgeCount    int                     `json:"edge_count"`
	WordCount    int                     `json:"word_count"`
	ArticleCount int                     `json:"article_count"`
	FocusKey     string                  `json:"focus_key"`
	Nodes        []KnowledgeGraphNodeDTO `json:"nodes"`
}

type KnowledgeGraphQuery struct {
	FocusType string
	FocusID   uint
	FocusKey  string
	Depth     int
	Limit     int
	Types     []string
	Search    string
}

type graphNodeInput struct {
	Key                string
	Type               string
	Label              string
	Description        string
	Weight             int
	Metadata           map[string]interface{}
	SourceVocabularyID *uint
	SourceArticleID    *uint
	Familiarity        int
	ReviewCount        int
	MistakeCount       int
	LastSeenAt         *time.Time
	NextReviewAt       *time.Time
	StateSource        string
}

type graphEdgeInput struct {
	SourceKey string
	TargetKey string
	Relation  string
	Label     string
	Weight    int
	Metadata  map[string]interface{}
}

func NewKnowledgeGraphService(db *gorm.DB) *KnowledgeGraphService {
	return &KnowledgeGraphService{db: db}
}

func (s *KnowledgeGraphService) EnsureUserGraph(userID uint) error {
	var count int64
	if err := s.db.Model(&models.KnowledgeNode{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return s.SyncUserGraph(userID)
}

func (s *KnowledgeGraphService) RefreshUserGraph(userID uint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		service := NewKnowledgeGraphService(tx)
		if err := service.clearUserGraph(userID); err != nil {
			return err
		}
		return service.SyncUserGraph(userID)
	})
}

func (s *KnowledgeGraphService) SyncUserGraph(userID uint) error {
	var vocabulary []models.Vocabulary
	if err := s.db.Preload("Article.Category").
		Where("user_id = ?", userID).
		Order("updated_at DESC").
		Find(&vocabulary).Error; err != nil {
		return err
	}

	for _, vocab := range vocabulary {
		if err := s.SyncVocabulary(userID, vocab); err != nil {
			return err
		}
	}

	var histories []models.ReadHistory
	if err := s.db.Preload("Article.Category").
		Where("user_id = ?", userID).
		Order("last_read_at DESC").
		Limit(300).
		Find(&histories).Error; err != nil {
		return err
	}
	for _, history := range histories {
		if history.Article.ID == 0 {
			continue
		}
		if _, err := s.upsertArticleNode(userID, history.Article); err != nil {
			return err
		}
	}

	return nil
}

func (s *KnowledgeGraphService) SyncVocabulary(userID uint, vocab models.Vocabulary) error {
	if strings.TrimSpace(vocab.Word) == "" {
		return nil
	}
	if vocab.Article == nil && vocab.ArticleID != nil {
		var article models.Article
		if err := s.db.Preload("Category").Where("id = ?", *vocab.ArticleID).First(&article).Error; err == nil {
			vocab.Article = &article
		}
	}
	if err := s.pruneVocabularyDerivedNodes(userID, vocab); err != nil {
		return err
	}

	now := time.Now()
	mastery := vocabularyMasteryScore(vocab, now)
	// Build merged meaning description (Chinese translation + English definition)
	meaningLabel := firstMeaning(vocab.Translation)
	meaningDesc := "中文释义"
	if definition := firstMeaning(vocab.Definition); definition != "" && definition != meaningLabel {
		if meaningLabel != "" {
			meaningLabel = meaningLabel + " | " + shortenGraphLabel(definition, 60)
			meaningDesc = "中英释义"
		} else {
			meaningLabel = shortenGraphLabel(definition, 80)
			meaningDesc = "英文解释"
		}
	}

	wordMetadata := map[string]interface{}{
		"vocabulary_id":   vocab.ID,
		"word":            vocab.Word,
		"phonetic":        vocab.Phonetic,
		"is_learned":      vocab.IsLearned,
		"review_count":    vocab.ReviewCount,
		"forgotten_count": vocab.ForgottenCount,
		"next_review_at":  vocab.NextReviewAt,
	}
	// Embed weakness/review flags in word node metadata instead of separate nodes
	if vocab.ForgottenCount > 0 {
		wordMetadata["weak_flag"] = true
		wordMetadata["forgotten_count"] = vocab.ForgottenCount
	}
	if vocab.NextReviewAt != nil {
		wordMetadata["review_scheduled"] = true
		wordMetadata["review_date"] = vocab.NextReviewAt.Format("2006-01-02")
	}

	wordNode, err := s.upsertNode(userID, graphNodeInput{
		Key:                WordNodeKey(vocab.ID),
		Type:               KnowledgeNodeWord,
		Label:              vocab.Word,
		Description:        firstNonEmptyText(firstMeaning(vocab.Translation), firstMeaning(vocab.Definition), vocab.Phonetic, vocab.Context),
		Weight:             100,
		SourceVocabularyID: &vocab.ID,
		SourceArticleID:    vocab.ArticleID,
		Familiarity:        mastery,
		ReviewCount:        vocab.ReviewCount,
		MistakeCount:       vocab.ForgottenCount,
		LastSeenAt:         lastSeenFromVocabulary(vocab),
		NextReviewAt:       vocab.NextReviewAt,
		StateSource:        "vocabulary",
		Metadata:           wordMetadata,
	})
	if err != nil {
		return err
	}

	if meaningLabel != "" {
		meaningNode, err := s.upsertNode(userID, graphNodeInput{
			Key:                "meaning:" + normalizeGraphID(vocab.Word),
			Type:               KnowledgeNodeMeaning,
			Label:              meaningLabel,
			Description:        meaningDesc,
			Weight:             78,
			SourceVocabularyID: &vocab.ID,
		})
		if err != nil {
			return err
		}
		if err := s.upsertEdge(userID, wordNode.ID, meaningNode.ID, graphEdgeInput{Relation: "defines", Label: "释义", Weight: 92}); err != nil {
			return err
		}
	}

	if strings.TrimSpace(vocab.Context) != "" {
		contextNode, err := s.upsertNode(userID, graphNodeInput{
			Key:                fmt.Sprintf("context:%d", vocab.ID),
			Type:               KnowledgeNodeContext,
			Label:              "原文语境",
			Description:        shortenGraphLabel(vocab.Context, 220),
			Weight:             72,
			SourceVocabularyID: &vocab.ID,
			SourceArticleID:    vocab.ArticleID,
		})
		if err != nil {
			return err
		}
		if err := s.upsertEdge(userID, wordNode.ID, contextNode.ID, graphEdgeInput{Relation: "appears_in_context", Label: "语境", Weight: 88}); err != nil {
			return err
		}
		for _, grammar := range detectGrammarPoints(vocab.Context) {
			grammarNode, err := s.upsertNode(userID, graphNodeInput{
				Key:         "grammar:" + normalizeGraphID(grammar),
				Type:        KnowledgeNodeGrammar,
				Label:       grammar,
				Description: grammarDescription(grammar),
				Weight:      58,
			})
			if err != nil {
				return err
			}
			if err := s.upsertEdge(userID, contextNode.ID, grammarNode.ID, graphEdgeInput{Relation: "has_grammar", Label: "语法", Weight: 54}); err != nil {
				return err
			}
		}
	}

	if example := firstExample(vocab); example != "" {
		exampleNode, err := s.upsertNode(userID, graphNodeInput{
			Key:                fmt.Sprintf("example:%d", vocab.ID),
			Type:               KnowledgeNodeExample,
			Label:              "例句",
			Description:        shortenGraphLabel(example, 220),
			Weight:             64,
			SourceVocabularyID: &vocab.ID,
		})
		if err != nil {
			return err
		}
		if err := s.upsertEdge(userID, wordNode.ID, exampleNode.ID, graphEdgeInput{Relation: "has_example", Label: "例句", Weight: 76}); err != nil {
			return err
		}
	}

	if vocab.Article != nil && vocab.Article.ID > 0 {
		articleNode, err := s.upsertArticleNode(userID, *vocab.Article)
		if err != nil {
			return err
		}
		if err := s.upsertEdge(userID, wordNode.ID, articleNode.ID, graphEdgeInput{Relation: "appears_in", Label: "来源文章", Weight: 96}); err != nil {
			return err
		}
	}

	return s.syncRelatedVocabulary(userID, vocab, wordNode.ID)
}

func (s *KnowledgeGraphService) RemoveVocabularyGraph(userID, vocabularyID uint) error {
	keys := []string{
		WordNodeKey(vocabularyID),
		fmt.Sprintf("context:%d", vocabularyID),
		fmt.Sprintf("example:%d", vocabularyID),
		fmt.Sprintf("weak:%d", vocabularyID),
		fmt.Sprintf("review:%d", vocabularyID),
	}
	if err := s.deleteNodesByKey(userID, keys); err != nil {
		return err
	}
	if err := s.pruneOrphanSharedNodes(userID, []string{
		KnowledgeNodeMeaning,
		KnowledgeNodeDefinition,
		KnowledgeNodeGrammar,
		KnowledgeNodeArticle,
		KnowledgeNodeTopic,
	}); err != nil {
		return err
	}
	if err := s.pruneUnanchoredComponents(userID); err != nil {
		return err
	}
	return nil
}

func (s *KnowledgeGraphService) GetGraph(userID uint, query KnowledgeGraphQuery) (KnowledgeGraphDTO, error) {
	if err := s.EnsureUserGraph(userID); err != nil {
		return KnowledgeGraphDTO{}, err
	}
	if query.Depth <= 0 {
		query.Depth = 2
	}
	if query.Depth > 3 {
		query.Depth = 3
	}
	if query.Limit <= 0 {
		query.Limit = 120
	}
	if query.Limit > 240 {
		query.Limit = 240
	}

	focus, err := s.findFocusNode(userID, query)
	if err != nil {
		return KnowledgeGraphDTO{}, err
	}
	if focus == nil && query.hasFocus() {
		return KnowledgeGraphDTO{}, ErrKnowledgeGraphFocusNotFound
	}

	nodesByID := make(map[uint]models.KnowledgeNode)
	edgesByID := make(map[uint]models.KnowledgeEdge)
	if focus != nil {
		nodesByID[focus.ID] = *focus
		frontier := []uint{focus.ID}
		visited := map[uint]bool{focus.ID: true}
		for depth := 0; depth < query.Depth && len(frontier) > 0; depth++ {
			var edges []models.KnowledgeEdge
			if err := s.db.
				Where("user_id = ? AND (source_node_id IN ? OR target_node_id IN ?)", userID, frontier, frontier).
				Order("weight DESC, updated_at DESC").
				Limit(query.Limit * 2).
				Find(&edges).Error; err != nil {
				return KnowledgeGraphDTO{}, err
			}
			next := make([]uint, 0)
			for _, edge := range edges {
				edgesByID[edge.ID] = edge
				for _, id := range []uint{edge.SourceNodeID, edge.TargetNodeID} {
					if !visited[id] {
						visited[id] = true
						next = append(next, id)
					}
				}
			}
			frontier = next
			if len(nodesByID)+len(next) >= query.Limit {
				break
			}
		}
		for id := range visited {
			if _, ok := nodesByID[id]; ok {
				continue
			}
			var node models.KnowledgeNode
			if err := s.db.Where("user_id = ? AND id = ?", userID, id).First(&node).Error; err == nil {
				nodesByID[id] = node
			}
		}
		nodesByID = filterFocusedGraphNodes(nodesByID, focus.ID, query)
	} else {
		nodeQuery := s.db.Where("user_id = ?", userID)
		if len(query.Types) > 0 {
			nodeQuery = nodeQuery.Where("type IN ?", query.Types)
		}
		if query.Search != "" {
			search := "%" + strings.ToLower(query.Search) + "%"
			nodeQuery = nodeQuery.Where("LOWER(label) LIKE ? OR LOWER(description) LIKE ?", search, search)
		}
		var nodes []models.KnowledgeNode
		if err := nodeQuery.Order("weight DESC, updated_at DESC").Limit(query.Limit).Find(&nodes).Error; err != nil {
			return KnowledgeGraphDTO{}, err
		}
		ids := make([]uint, 0, len(nodes))
		for _, node := range nodes {
			nodesByID[node.ID] = node
			ids = append(ids, node.ID)
		}
		if len(ids) > 0 {
			var edges []models.KnowledgeEdge
			if err := s.db.
				Where("user_id = ? AND source_node_id IN ? AND target_node_id IN ?", userID, ids, ids).
				Order("weight DESC, updated_at DESC").
				Limit(query.Limit * 2).
				Find(&edges).Error; err != nil {
				return KnowledgeGraphDTO{}, err
			}
			for _, edge := range edges {
				edgesByID[edge.ID] = edge
			}
		}
	}

	return s.buildDTO(userID, nodesByID, edgesByID, focus)
}

func (q KnowledgeGraphQuery) hasFocus() bool {
	return q.FocusKey != "" || (q.FocusType != "" && q.FocusID > 0)
}

func (q KnowledgeGraphQuery) matchesNodeFilters(node models.KnowledgeNode) bool {
	if len(q.Types) > 0 {
		matchedType := false
		for _, nodeType := range q.Types {
			if node.Type == nodeType {
				matchedType = true
				break
			}
		}
		if !matchedType {
			return false
		}
	}
	if q.Search != "" {
		search := strings.ToLower(strings.TrimSpace(q.Search))
		if search != "" &&
			!strings.Contains(strings.ToLower(node.Label), search) &&
			!strings.Contains(strings.ToLower(node.Description), search) {
			return false
		}
	}
	return true
}

func filterFocusedGraphNodes(nodesByID map[uint]models.KnowledgeNode, focusID uint, query KnowledgeGraphQuery) map[uint]models.KnowledgeNode {
	if len(query.Types) == 0 && strings.TrimSpace(query.Search) == "" {
		return nodesByID
	}
	filtered := make(map[uint]models.KnowledgeNode, len(nodesByID))
	for id, node := range nodesByID {
		if id == focusID || query.matchesNodeFilters(node) {
			filtered[id] = node
		}
	}
	return filtered
}

func (s *KnowledgeGraphService) GetOverview(userID uint) (KnowledgeGraphOverview, error) {
	if err := s.EnsureUserGraph(userID); err != nil {
		return KnowledgeGraphOverview{}, err
	}

	stats, err := s.GetStats(userID)
	if err != nil {
		return KnowledgeGraphOverview{}, err
	}

	weakNodes, err := s.queryStateNodes(userID, "mistake_count DESC, familiarity ASC, updated_at DESC", "mistake_count > 0", 8)
	if err != nil {
		return KnowledgeGraphOverview{}, err
	}
	dueNodes, err := s.queryStateNodes(userID, "next_review_at ASC, updated_at DESC", "next_review_at IS NOT NULL AND next_review_at <= ?", 8, time.Now())
	if err != nil {
		return KnowledgeGraphOverview{}, err
	}
	recentNodes, err := s.queryNodes(userID, "updated_at DESC", 8, "")
	if err != nil {
		return KnowledgeGraphOverview{}, err
	}
	topTopics, err := s.queryNodes(userID, "weight DESC, updated_at DESC", 8, KnowledgeNodeTopic)
	if err != nil {
		return KnowledgeGraphOverview{}, err
	}
	topicClusters, err := s.GetTopicClusters(userID, topTopics)
	if err != nil {
		return KnowledgeGraphOverview{}, err
	}
	recommendations, err := s.GetRecommendations(userID, stats, weakNodes, dueNodes, topTopics)
	if err != nil {
		return KnowledgeGraphOverview{}, err
	}
	learningPaths, err := s.GetLearningPaths(userID, weakNodes, dueNodes, topTopics)
	if err != nil {
		return KnowledgeGraphOverview{}, err
	}

	return KnowledgeGraphOverview{
		Stats:           stats,
		WeakNodes:       weakNodes,
		DueNodes:        dueNodes,
		RecentNodes:     recentNodes,
		TopTopics:       topTopics,
		TopicClusters:   topicClusters,
		Recommendations: recommendations,
		LearningPaths:   learningPaths,
	}, nil
}

func (s *KnowledgeGraphService) GetStats(userID uint) (KnowledgeGraphStats, error) {
	stats := KnowledgeGraphStats{NodeTypes: make(map[string]int)}

	type typeCount struct {
		Type  string
		Count int
	}
	var nodeCounts []typeCount
	if err := s.db.Model(&models.KnowledgeNode{}).
		Select("type, COUNT(*) AS count").
		Where("user_id = ?", userID).
		Group("type").
		Scan(&nodeCounts).Error; err != nil {
		return stats, err
	}
	for _, item := range nodeCounts {
		stats.NodeTypes[item.Type] = item.Count
		stats.TotalNodes += item.Count
		switch item.Type {
		case KnowledgeNodeWord:
			stats.RelatedWords = item.Count
		case KnowledgeNodeArticle:
			stats.Articles = item.Count
		case KnowledgeNodeTopic:
			stats.Topics = item.Count
		case KnowledgeNodeGrammar:
			stats.GrammarPoints = item.Count
		case KnowledgeNodeWeakness:
			stats.WeakSignals = item.Count
		}
	}

	var edgeCount int64
	if err := s.db.Model(&models.KnowledgeEdge{}).
		Where("user_id = ?", userID).
		Count(&edgeCount).Error; err != nil {
		return stats, err
	}
	stats.TotalEdges = int(edgeCount)

	var dueCount int64
	if err := s.db.Model(&models.UserKnowledgeState{}).
		Where("user_id = ? AND next_review_at IS NOT NULL AND next_review_at <= ?", userID, time.Now()).
		Count(&dueCount).Error; err != nil {
		return stats, err
	}
	stats.DueReviews = int(dueCount)

	return stats, nil
}

func (s *KnowledgeGraphService) GetRecommendations(
	userID uint,
	stats KnowledgeGraphStats,
	weakNodes []KnowledgeGraphNodeDTO,
	dueNodes []KnowledgeGraphNodeDTO,
	topTopics []KnowledgeGraphNodeDTO,
) ([]KnowledgeGraphRecommendation, error) {
	recommendations := make([]KnowledgeGraphRecommendation, 0, 6)

	if len(dueNodes) > 0 {
		recommendations = append(recommendations, KnowledgeGraphRecommendation{
			ID:          "review-due",
			Type:        "review",
			Priority:    100,
			Title:       fmt.Sprintf("先复习 %d 个到期节点", len(dueNodes)),
			Description: "到期复习会直接影响图谱中的掌握度，建议优先清空。",
			ActionLabel: "开始复习",
			ActionHref:  "/vocabulary?mode=review",
			FocusKey:    dueNodes[0].ID,
			Metadata: map[string]interface{}{
				"count": len(dueNodes),
			},
		})
	}

	if len(weakNodes) > 0 {
		recommendations = append(recommendations, KnowledgeGraphRecommendation{
			ID:          "repair-weakness",
			Type:        "weakness",
			Priority:    90,
			Title:       "修复最薄弱的词汇簇",
			Description: fmt.Sprintf("从「%s」开始，沿着语境、释义和文章来源复习。", weakNodes[0].Label),
			ActionLabel: "聚焦薄弱点",
			ActionHref:  "/knowledge-graph",
			FocusKey:    weakNodes[0].ID,
			Metadata: map[string]interface{}{
				"count": len(weakNodes),
			},
		})
	}

	grammarNodes, err := s.queryNodes(userID, "weight DESC, updated_at DESC", 5, KnowledgeNodeGrammar)
	if err != nil {
		return nil, err
	}
	if len(grammarNodes) > 0 {
		recommendations = append(recommendations, KnowledgeGraphRecommendation{
			ID:          "grammar-pattern",
			Type:        "grammar",
			Priority:    76,
			Title:       "整理高频语法结构",
			Description: fmt.Sprintf("图谱中已出现「%s」等语法点，适合结合原文语境复盘。", grammarNodes[0].Label),
			ActionLabel: "查看语法节点",
			ActionHref:  "/knowledge-graph",
			FocusKey:    grammarNodes[0].ID,
			Metadata: map[string]interface{}{
				"count": len(grammarNodes),
			},
		})
	}

	if len(topTopics) > 0 {
		recommendations = append(recommendations, KnowledgeGraphRecommendation{
			ID:          "topic-reading",
			Type:        "reading",
			Priority:    70,
			Title:       "围绕主题扩展阅读",
			Description: fmt.Sprintf("「%s」已经连接了多个学习节点，继续读同主题文章能强化迁移。", topTopics[0].Label),
			ActionLabel: "找相关文章",
			ActionHref:  "/latest",
			FocusKey:    topTopics[0].ID,
			Metadata: map[string]interface{}{
				"topic": topTopics[0].Label,
			},
		})
	}

	if stats.TotalNodes > 0 && stats.TotalEdges < stats.TotalNodes {
		recommendations = append(recommendations, KnowledgeGraphRecommendation{
			ID:          "expand-context",
			Type:        "context",
			Priority:    60,
			Title:       "补充更多语境连接",
			Description: "当前节点多于关系，继续从文章里收藏带上下文的词，会让图谱更容易形成学习路径。",
			ActionLabel: "继续阅读",
			ActionHref:  "/latest",
			Metadata: map[string]interface{}{
				"nodes": stats.TotalNodes,
				"edges": stats.TotalEdges,
			},
		})
	}

	if len(recommendations) == 0 {
		recommendations = append(recommendations, KnowledgeGraphRecommendation{
			ID:          "keep-building",
			Type:        "build",
			Priority:    50,
			Title:       "继续积累高质量节点",
			Description: "从文章中保存带语境的词汇，图谱会自动连接释义、主题、语法和复习计划。",
			ActionLabel: "去阅读",
			ActionHref:  "/latest",
		})
	}

	sort.SliceStable(recommendations, func(i, j int) bool {
		return recommendations[i].Priority > recommendations[j].Priority
	})
	if len(recommendations) > 5 {
		recommendations = recommendations[:5]
	}
	return recommendations, nil
}

func (s *KnowledgeGraphService) GetLearningPaths(
	userID uint,
	weakNodes []KnowledgeGraphNodeDTO,
	dueNodes []KnowledgeGraphNodeDTO,
	topTopics []KnowledgeGraphNodeDTO,
) ([]KnowledgeGraphLearningPath, error) {
	type pathSeed struct {
		node     KnowledgeGraphNodeDTO
		pathType string
		priority int
	}

	seeds := make([]pathSeed, 0, len(dueNodes)+len(weakNodes)+len(topTopics))
	for index, node := range dueNodes {
		if index >= 3 {
			break
		}
		seeds = append(seeds, pathSeed{node: node, pathType: "review", priority: 100 - index})
	}
	for index, node := range weakNodes {
		if index >= 3 {
			break
		}
		seeds = append(seeds, pathSeed{node: node, pathType: "weakness", priority: 90 - index})
	}
	for index, node := range topTopics {
		if index >= 2 {
			break
		}
		seeds = append(seeds, pathSeed{node: node, pathType: "topic", priority: 72 - index})
	}

	paths := make([]KnowledgeGraphLearningPath, 0, 5)
	seen := make(map[string]bool)
	for _, seed := range seeds {
		path, signature, err := s.buildLearningPath(userID, seed.node, seed.pathType, seed.priority)
		if err != nil {
			return nil, err
		}
		if path == nil || len(path.Steps) < 2 || seen[signature] {
			continue
		}
		paths = append(paths, *path)
		seen[signature] = true
		if len(paths) >= 5 {
			break
		}
	}

	sort.SliceStable(paths, func(i, j int) bool {
		return paths[i].Priority > paths[j].Priority
	})
	return paths, nil
}

func (s *KnowledgeGraphService) GetTopicClusters(userID uint, topTopics []KnowledgeGraphNodeDTO) ([]KnowledgeGraphTopicCluster, error) {
	clusters := make([]KnowledgeGraphTopicCluster, 0, min(len(topTopics), 6))
	for index, topicDTO := range topTopics {
		if index >= 6 {
			break
		}
		cluster, err := s.buildTopicCluster(userID, topicDTO)
		if err != nil {
			return nil, err
		}
		if cluster == nil || cluster.NodeCount < 2 {
			continue
		}
		clusters = append(clusters, *cluster)
	}
	sort.SliceStable(clusters, func(i, j int) bool {
		if clusters[i].NodeCount == clusters[j].NodeCount {
			return clusters[i].Topic.Label < clusters[j].Topic.Label
		}
		return clusters[i].NodeCount > clusters[j].NodeCount
	})
	return clusters, nil
}

func (s *KnowledgeGraphService) buildTopicCluster(userID uint, topicDTO KnowledgeGraphNodeDTO) (*KnowledgeGraphTopicCluster, error) {
	var topic models.KnowledgeNode
	if err := s.db.Where("user_id = ? AND node_key = ?", userID, topicDTO.ID).First(&topic).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}

	nodesByID := map[uint]models.KnowledgeNode{topic.ID: topic}
	edgeByID := make(map[uint]models.KnowledgeEdge)
	frontier := []uint{topic.ID}
	visited := map[uint]bool{topic.ID: true}
	for depth := 0; depth < 2 && len(frontier) > 0 && len(nodesByID) < 18; depth++ {
		var edges []models.KnowledgeEdge
		if err := s.db.
			Where("user_id = ? AND (source_node_id IN ? OR target_node_id IN ?)", userID, frontier, frontier).
			Order("weight DESC, updated_at DESC").
			Limit(48).
			Find(&edges).Error; err != nil {
			return nil, err
		}
		if len(edges) == 0 {
			break
		}

		nextIDs := make([]uint, 0, len(edges))
		for _, edge := range edges {
			edgeByID[edge.ID] = edge
			for _, id := range []uint{edge.SourceNodeID, edge.TargetNodeID} {
				if visited[id] {
					continue
				}
				visited[id] = true
				nextIDs = append(nextIDs, id)
			}
		}
		if len(nextIDs) == 0 {
			break
		}

		var nodes []models.KnowledgeNode
		if err := s.db.Where("user_id = ? AND id IN ?", userID, nextIDs).Find(&nodes).Error; err != nil {
			return nil, err
		}
		sort.SliceStable(nodes, func(i, j int) bool {
			left := topicClusterNodeScore(nodes[i])
			right := topicClusterNodeScore(nodes[j])
			if left == right {
				if nodes[i].Weight == nodes[j].Weight {
					return nodes[i].Label < nodes[j].Label
				}
				return nodes[i].Weight > nodes[j].Weight
			}
			return left > right
		})

		frontier = frontier[:0]
		for _, node := range nodes {
			nodesByID[node.ID] = node
			frontier = append(frontier, node.ID)
			if len(nodesByID) >= 18 {
				break
			}
		}
	}

	nodeList := make([]models.KnowledgeNode, 0, len(nodesByID))
	wordCount := 0
	articleCount := 0
	for _, node := range nodesByID {
		if node.ID == topic.ID {
			continue
		}
		switch node.Type {
		case KnowledgeNodeWord:
			wordCount++
		case KnowledgeNodeArticle:
			articleCount++
		}
		nodeList = append(nodeList, node)
	}
	sort.SliceStable(nodeList, func(i, j int) bool {
		left := topicClusterNodeScore(nodeList[i])
		right := topicClusterNodeScore(nodeList[j])
		if left == right {
			return nodeList[i].Label < nodeList[j].Label
		}
		return left > right
	})
	if len(nodeList) > 8 {
		nodeList = nodeList[:8]
	}
	nodeDTOs, err := s.nodesToDTO(userID, nodeList)
	if err != nil {
		return nil, err
	}

	return &KnowledgeGraphTopicCluster{
		ID:           "cluster:" + topic.NodeKey,
		Topic:        topicDTO,
		NodeCount:    len(nodesByID),
		EdgeCount:    len(edgeByID),
		WordCount:    wordCount,
		ArticleCount: articleCount,
		FocusKey:     topic.NodeKey,
		Nodes:        nodeDTOs,
	}, nil
}

func topicClusterNodeScore(node models.KnowledgeNode) int {
	typeScore := map[string]int{
		KnowledgeNodeArticle:    100,
		KnowledgeNodeWord:       92,
		KnowledgeNodeGrammar:    78,
		KnowledgeNodeContext:    72,
		KnowledgeNodeMeaning:    60,
		KnowledgeNodeDefinition: 56,
		KnowledgeNodeExample:    54,
		KnowledgeNodeReview:     42,
		KnowledgeNodeWeakness:   42,
		KnowledgeNodeTopic:      30,
	}
	return typeScore[node.Type] + node.Weight/10
}

func (s *KnowledgeGraphService) buildLearningPath(
	userID uint,
	seed KnowledgeGraphNodeDTO,
	pathType string,
	priority int,
) (*KnowledgeGraphLearningPath, string, error) {
	var seedNode models.KnowledgeNode
	if err := s.db.Where("user_id = ? AND node_key = ?", userID, seed.ID).First(&seedNode).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, "", nil
		}
		return nil, "", err
	}

	nodesByID := map[uint]models.KnowledgeNode{seedNode.ID: seedNode}
	orderedIDs := []uint{seedNode.ID}
	visited := map[uint]bool{seedNode.ID: true}
	viaEdge := make(map[uint]models.KnowledgeEdge)
	frontier := []models.KnowledgeNode{seedNode}

	for depth := 0; depth < 2 && len(frontier) > 0 && len(orderedIDs) < 6; depth++ {
		frontierIDs := make([]uint, 0, len(frontier))
		for _, node := range frontier {
			frontierIDs = append(frontierIDs, node.ID)
		}

		var edges []models.KnowledgeEdge
		if err := s.db.
			Where("user_id = ? AND (source_node_id IN ? OR target_node_id IN ?)", userID, frontierIDs, frontierIDs).
			Order("weight DESC, updated_at DESC").
			Limit(32).
			Find(&edges).Error; err != nil {
			return nil, "", err
		}
		if len(edges) == 0 {
			break
		}

		neighborIDs := make([]uint, 0, len(edges))
		candidateEdge := make(map[uint]models.KnowledgeEdge)
		for _, edge := range edges {
			for _, id := range []uint{edge.SourceNodeID, edge.TargetNodeID} {
				if visited[id] {
					continue
				}
				if _, ok := candidateEdge[id]; !ok {
					neighborIDs = append(neighborIDs, id)
					candidateEdge[id] = edge
				}
			}
		}
		if len(neighborIDs) == 0 {
			break
		}

		var neighbors []models.KnowledgeNode
		if err := s.db.Where("user_id = ? AND id IN ?", userID, neighborIDs).Find(&neighbors).Error; err != nil {
			return nil, "", err
		}
		sort.SliceStable(neighbors, func(i, j int) bool {
			leftEdge := candidateEdge[neighbors[i].ID]
			rightEdge := candidateEdge[neighbors[j].ID]
			leftScore := learningPathNodeScore(pathType, seedNode.Type, neighbors[i], leftEdge)
			rightScore := learningPathNodeScore(pathType, seedNode.Type, neighbors[j], rightEdge)
			if leftScore == rightScore {
				if neighbors[i].Weight == neighbors[j].Weight {
					return neighbors[i].Label < neighbors[j].Label
				}
				return neighbors[i].Weight > neighbors[j].Weight
			}
			return leftScore > rightScore
		})

		nextFrontier := make([]models.KnowledgeNode, 0)
		for _, node := range neighbors {
			if visited[node.ID] {
				continue
			}
			visited[node.ID] = true
			nodesByID[node.ID] = node
			orderedIDs = append(orderedIDs, node.ID)
			viaEdge[node.ID] = candidateEdge[node.ID]
			nextFrontier = append(nextFrontier, node)
			if len(orderedIDs) >= 6 {
				break
			}
		}
		frontier = nextFrontier
	}

	orderedNodes := make([]models.KnowledgeNode, 0, len(orderedIDs))
	for _, id := range orderedIDs {
		orderedNodes = append(orderedNodes, nodesByID[id])
	}
	steps, err := s.learningPathSteps(userID, orderedNodes, viaEdge)
	if err != nil {
		return nil, "", err
	}
	if len(steps) < 2 {
		return nil, "", nil
	}

	signature := learningPathSignature(steps)
	path := KnowledgeGraphLearningPath{
		ID:          fmt.Sprintf("%s-%s", pathType, normalizeGraphID(signature)),
		Type:        pathType,
		Priority:    priority,
		Title:       learningPathTitle(pathType, steps),
		Description: learningPathDescription(pathType, steps),
		ActionLabel: learningPathActionLabel(pathType),
		ActionHref:  learningPathActionHref(pathType, steps),
		FocusKey:    seed.ID,
		Steps:       steps,
	}
	return &path, signature, nil
}

func (s *KnowledgeGraphService) learningPathSteps(userID uint, nodes []models.KnowledgeNode, viaEdge map[uint]models.KnowledgeEdge) ([]KnowledgeGraphPathStep, error) {
	stateByNode := make(map[uint]models.UserKnowledgeState)
	if len(nodes) > 0 {
		ids := make([]uint, 0, len(nodes))
		for _, node := range nodes {
			ids = append(ids, node.ID)
		}
		var states []models.UserKnowledgeState
		if err := s.db.Where("user_id = ? AND node_id IN ?", userID, ids).Find(&states).Error; err != nil {
			return nil, err
		}
		for _, state := range states {
			stateByNode[state.NodeID] = state
		}
	}

	steps := make([]KnowledgeGraphPathStep, 0, len(nodes))
	for _, node := range nodes {
		step := KnowledgeGraphPathStep{Node: nodeDTO(node, stateByNode[node.ID])}
		if edge, ok := viaEdge[node.ID]; ok {
			step.Via = firstNonEmptyText(edge.Label, edge.Relation)
			step.Relation = edge.Relation
			step.Metadata = decodeMetadata(edge.Metadata)
		}
		steps = append(steps, step)
	}
	return steps, nil
}

func learningPathNodeScore(pathType, seedType string, node models.KnowledgeNode, edge models.KnowledgeEdge) int {
	typeScore := map[string]int{
		KnowledgeNodeWord:       100,
		KnowledgeNodeContext:    88,
		KnowledgeNodeArticle:    84,
		KnowledgeNodeMeaning:    80,
		KnowledgeNodeDefinition: 72,
		KnowledgeNodeGrammar:    70,
		KnowledgeNodeReview:     66,
		KnowledgeNodeWeakness:   66,
		KnowledgeNodeExample:    62,
		KnowledgeNodeTopic:      56,
	}
	score := typeScore[node.Type] + edge.Weight/4 + node.Weight/10
	switch edge.Relation {
	case "defines", "appears_in_context":
		score += 14
	case "appears_in", "used_with_grammar":
		score += 12
	case "scheduled_review", "weak_signal":
		score += 10
	case "explains", "has_example":
		score += 8
	case "has_topic", "co_occurs":
		score += 5
	}
	if pathType == "topic" || seedType == KnowledgeNodeTopic {
		if node.Type == KnowledgeNodeArticle {
			score += 28
		}
		if node.Type == KnowledgeNodeWord {
			score += 16
		}
	}
	if pathType == "review" || pathType == "weakness" {
		if node.Type == KnowledgeNodeWord {
			score += 30
		}
		if node.Type == KnowledgeNodeContext || node.Type == KnowledgeNodeArticle {
			score += 12
		}
	}
	return score
}

func learningPathSignature(steps []KnowledgeGraphPathStep) string {
	for _, step := range steps {
		if step.Node.Type == KnowledgeNodeWord {
			return step.Node.ID
		}
	}
	return steps[0].Node.ID
}

func learningPathTitle(pathType string, steps []KnowledgeGraphPathStep) string {
	focus := firstStepOfType(steps, KnowledgeNodeWord)
	if focus == nil {
		focus = &steps[0]
	}
	switch pathType {
	case "review":
		return fmt.Sprintf("复习路径：%s", focus.Node.Label)
	case "weakness":
		return fmt.Sprintf("薄弱修复：%s", focus.Node.Label)
	case "topic":
		return fmt.Sprintf("主题扩展：%s", focus.Node.Label)
	default:
		return fmt.Sprintf("学习路径：%s", focus.Node.Label)
	}
}

func learningPathDescription(pathType string, steps []KnowledgeGraphPathStep) string {
	types := make([]string, 0, len(steps))
	seen := make(map[string]bool)
	for _, step := range steps {
		label := knowledgeNodeTypeLabel(step.Node.Type)
		if seen[label] {
			continue
		}
		seen[label] = true
		types = append(types, label)
	}
	if len(types) == 0 {
		return "沿着图谱关系完成一次集中复盘。"
	}
	switch pathType {
	case "review":
		return "从到期复习节点出发，依次回顾" + strings.Join(types, "、") + "。"
	case "weakness":
		return "从薄弱信号出发，沿着" + strings.Join(types, "、") + "补回记忆缺口。"
	case "topic":
		return "围绕主题串联" + strings.Join(types, "、") + "，用于扩展阅读和迁移。"
	default:
		return "沿着" + strings.Join(types, "、") + "完成一次图谱复盘。"
	}
}

func learningPathActionLabel(pathType string) string {
	switch pathType {
	case "review", "weakness":
		return "开始复盘"
	case "topic":
		return "沿主题阅读"
	default:
		return "查看路径"
	}
}

func learningPathActionHref(pathType string, steps []KnowledgeGraphPathStep) string {
	if pathType == "topic" {
		if article := firstStepOfType(steps, KnowledgeNodeArticle); article != nil {
			if slug, ok := article.Node.Metadata["slug"].(string); ok && slug != "" {
				return "/articles/" + slug
			}
		}
		return "/latest"
	}
	return "/vocabulary?mode=review"
}

func firstStepOfType(steps []KnowledgeGraphPathStep, nodeType string) *KnowledgeGraphPathStep {
	for index := range steps {
		if steps[index].Node.Type == nodeType {
			return &steps[index]
		}
	}
	return nil
}

func knowledgeNodeTypeLabel(nodeType string) string {
	switch nodeType {
	case KnowledgeNodeWord:
		return "单词"
	case KnowledgeNodeMeaning:
		return "释义"
	case KnowledgeNodeDefinition:
		return "解释"
	case KnowledgeNodeContext:
		return "语境"
	case KnowledgeNodeExample:
		return "例句"
	case KnowledgeNodeArticle:
		return "文章"
	case KnowledgeNodeTopic:
		return "主题"
	case KnowledgeNodeGrammar:
		return "语法"
	case KnowledgeNodeWeakness:
		return "薄弱点"
	case KnowledgeNodeReview:
		return "复习"
	default:
		return nodeType
	}
}

func (s *KnowledgeGraphService) clearUserGraph(userID uint) error {
	if err := s.db.Unscoped().Where("user_id = ?", userID).Delete(&models.UserKnowledgeState{}).Error; err != nil {
		return err
	}
	if err := s.db.Unscoped().Where("user_id = ?", userID).Delete(&models.KnowledgeEdge{}).Error; err != nil {
		return err
	}
	return s.db.Unscoped().Where("user_id = ?", userID).Delete(&models.KnowledgeNode{}).Error
}

func (s *KnowledgeGraphService) pruneVocabularyDerivedNodes(userID uint, vocab models.Vocabulary) error {
	if err := s.pruneVocabularySharedEdges(userID, vocab); err != nil {
		return err
	}

	keys := []string{
		fmt.Sprintf("context:%d", vocab.ID),
		fmt.Sprintf("example:%d", vocab.ID),
		fmt.Sprintf("weak:%d", vocab.ID),
		fmt.Sprintf("review:%d", vocab.ID),
	}
	keep := make(map[string]bool)
	if strings.TrimSpace(vocab.Context) != "" {
		keep[fmt.Sprintf("context:%d", vocab.ID)] = true
	}
	if firstExample(vocab) != "" {
		keep[fmt.Sprintf("example:%d", vocab.ID)] = true
	}
	if vocab.ForgottenCount > 0 {
		keep[fmt.Sprintf("weak:%d", vocab.ID)] = true
	}
	if vocab.NextReviewAt != nil {
		keep[fmt.Sprintf("review:%d", vocab.ID)] = true
	}

	staleKeys := make([]string, 0, len(keys))
	for _, key := range keys {
		if !keep[key] {
			staleKeys = append(staleKeys, key)
		}
	}
	return s.deleteNodesByKey(userID, staleKeys)
}

func (s *KnowledgeGraphService) pruneVocabularySharedEdges(userID uint, vocab models.Vocabulary) error {
	var wordNode models.KnowledgeNode
	if err := s.db.Where("user_id = ? AND node_key = ?", userID, WordNodeKey(vocab.ID)).First(&wordNode).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		return err
	}

	expectedTargetByRelation := make(map[string]string)
	if firstMeaning(vocab.Translation) != "" {
		expectedTargetByRelation["defines"] = "meaning:" + normalizeGraphID(vocab.Word)
	}
	if definition := firstMeaning(vocab.Definition); definition != "" && definition != firstMeaning(vocab.Translation) {
		expectedTargetByRelation["explains"] = "definition:" + normalizeGraphID(vocab.Word)
	}

	var edges []models.KnowledgeEdge
	if err := s.db.
		Where("user_id = ? AND source_node_id = ? AND relation IN ?", userID, wordNode.ID, []string{"defines", "explains"}).
		Find(&edges).Error; err != nil {
		return err
	}
	if len(edges) == 0 {
		return nil
	}

	targetIDs := make([]uint, 0, len(edges))
	for _, edge := range edges {
		targetIDs = append(targetIDs, edge.TargetNodeID)
	}
	var targetNodes []models.KnowledgeNode
	if err := s.db.Where("user_id = ? AND id IN ?", userID, targetIDs).Find(&targetNodes).Error; err != nil {
		return err
	}
	targetByID := make(map[uint]models.KnowledgeNode, len(targetNodes))
	for _, node := range targetNodes {
		targetByID[node.ID] = node
	}

	removeEdgeIDs := make([]uint, 0)
	for _, edge := range edges {
		expectedTarget, ok := expectedTargetByRelation[edge.Relation]
		targetNode := targetByID[edge.TargetNodeID]
		if !ok || targetNode.NodeKey != expectedTarget {
			removeEdgeIDs = append(removeEdgeIDs, edge.ID)
		}
	}
	if len(removeEdgeIDs) > 0 {
		if err := s.db.Unscoped().Where("user_id = ? AND id IN ?", userID, removeEdgeIDs).Delete(&models.KnowledgeEdge{}).Error; err != nil {
			return err
		}
	}

	return s.pruneOrphanSharedNodes(userID, []string{KnowledgeNodeMeaning, KnowledgeNodeDefinition})
}

func (s *KnowledgeGraphService) pruneOrphanSharedNodes(userID uint, nodeTypes []string) error {
	var nodes []models.KnowledgeNode
	if err := s.db.Where("user_id = ? AND type IN ?", userID, nodeTypes).Find(&nodes).Error; err != nil {
		return err
	}
	for _, node := range nodes {
		var edgeCount int64
		if err := s.db.Model(&models.KnowledgeEdge{}).
			Where("user_id = ? AND (source_node_id = ? OR target_node_id = ?)", userID, node.ID, node.ID).
			Count(&edgeCount).Error; err != nil {
			return err
		}
		if edgeCount == 0 {
			if err := s.deleteNodesByKey(userID, []string{node.NodeKey}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *KnowledgeGraphService) pruneUnanchoredComponents(userID uint) error {
	var nodes []models.KnowledgeNode
	if err := s.db.Where("user_id = ?", userID).Find(&nodes).Error; err != nil {
		return err
	}
	if len(nodes) == 0 {
		return nil
	}

	articleAnchors := make(map[uint]bool)
	var histories []models.ReadHistory
	if err := s.db.Select("article_id").Where("user_id = ?", userID).Find(&histories).Error; err != nil {
		return err
	}
	for _, history := range histories {
		articleAnchors[history.ArticleID] = true
	}

	nodeByID := make(map[uint]models.KnowledgeNode, len(nodes))
	for _, node := range nodes {
		nodeByID[node.ID] = node
	}
	var edges []models.KnowledgeEdge
	if err := s.db.Where("user_id = ?", userID).Find(&edges).Error; err != nil {
		return err
	}
	adjacency := make(map[uint][]uint, len(nodes))
	for _, edge := range edges {
		adjacency[edge.SourceNodeID] = append(adjacency[edge.SourceNodeID], edge.TargetNodeID)
		adjacency[edge.TargetNodeID] = append(adjacency[edge.TargetNodeID], edge.SourceNodeID)
	}

	visited := make(map[uint]bool, len(nodes))
	for _, start := range nodes {
		if visited[start.ID] {
			continue
		}
		component := make([]uint, 0)
		anchored := false
		queue := []uint{start.ID}
		visited[start.ID] = true
		for len(queue) > 0 {
			id := queue[0]
			queue = queue[1:]
			component = append(component, id)
			node := nodeByID[id]
			if node.Type == KnowledgeNodeWord {
				anchored = true
			}
			if node.Type == KnowledgeNodeArticle && node.SourceArticleID != nil && articleAnchors[*node.SourceArticleID] {
				anchored = true
			}
			for _, nextID := range adjacency[id] {
				if !visited[nextID] {
					visited[nextID] = true
					queue = append(queue, nextID)
				}
			}
		}
		if !anchored {
			keys := make([]string, 0, len(component))
			for _, id := range component {
				keys = append(keys, nodeByID[id].NodeKey)
			}
			if err := s.deleteNodesByKey(userID, keys); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *KnowledgeGraphService) deleteNodesByKey(userID uint, nodeKeys []string) error {
	if len(nodeKeys) == 0 {
		return nil
	}
	var nodes []models.KnowledgeNode
	if err := s.db.Where("user_id = ? AND node_key IN ?", userID, nodeKeys).Find(&nodes).Error; err != nil {
		return err
	}
	if len(nodes) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(nodes))
	for _, node := range nodes {
		ids = append(ids, node.ID)
	}
	if err := s.db.Unscoped().Where("user_id = ? AND node_id IN ?", userID, ids).Delete(&models.UserKnowledgeState{}).Error; err != nil {
		return err
	}
	if err := s.db.Unscoped().Where("user_id = ? AND (source_node_id IN ? OR target_node_id IN ?)", userID, ids, ids).Delete(&models.KnowledgeEdge{}).Error; err != nil {
		return err
	}
	return s.db.Unscoped().Where("user_id = ? AND id IN ?", userID, ids).Delete(&models.KnowledgeNode{}).Error
}

func (s *KnowledgeGraphService) upsertArticleNode(userID uint, article models.Article) (models.KnowledgeNode, error) {
	articleID := article.ID
	articleNode, err := s.upsertNode(userID, graphNodeInput{
		Key:             ArticleNodeKey(article.ID),
		Type:            KnowledgeNodeArticle,
		Label:           article.Title,
		Description:     firstNonEmptyText(article.TitleCN, article.Summary, article.Source),
		Weight:          82,
		SourceArticleID: &articleID,
		Metadata: map[string]interface{}{
			"article_id":         article.ID,
			"slug":               article.Slug,
			"difficulty_level":   article.DifficultyLevel,
			"cefr_level":         article.CEFRLevel,
			"source":             article.Source,
			"published_at":       article.PublishedAt,
			"article_word_count": article.WordCount,
		},
	})
	if err != nil {
		return models.KnowledgeNode{}, err
	}

	for _, topic := range articleTopics(article) {
		topicNode, err := s.upsertNode(userID, graphNodeInput{
			Key:         "topic:" + normalizeGraphID(topic),
			Type:        KnowledgeNodeTopic,
			Label:       topic,
			Description: "文章主题",
			Weight:      54,
		})
		if err != nil {
			return models.KnowledgeNode{}, err
		}
		if err := s.upsertEdge(userID, articleNode.ID, topicNode.ID, graphEdgeInput{Relation: "has_topic", Label: "主题", Weight: 56}); err != nil {
			return models.KnowledgeNode{}, err
		}
	}
	return articleNode, nil
}

func (s *KnowledgeGraphService) syncRelatedVocabulary(userID uint, vocab models.Vocabulary, wordNodeID uint) error {
	var related []models.Vocabulary
	query := s.db.Where("user_id = ? AND id <> ?", userID, vocab.ID).
		Order("forgotten_count DESC, review_count DESC, created_at DESC").
		Limit(80)
	if vocab.ArticleID != nil {
		query = query.Where("article_id = ?", *vocab.ArticleID)
	}
	if err := query.Find(&related).Error; err != nil {
		return err
	}
	if err := s.addRelatedVocabularyEdges(userID, vocab, wordNodeID, related, "co_occurs", "同文出现", 8); err != nil {
		return err
	}

	if stem := vocabularyStem(vocab.Word); stem != "" {
		var patternRelated []models.Vocabulary
		if err := s.db.
			Where("user_id = ? AND id <> ? AND lower(word) LIKE ?", userID, vocab.ID, stem+"%").
			Order("created_at DESC").
			Limit(8).
			Find(&patternRelated).Error; err != nil {
			return err
		}
		if err := s.addRelatedVocabularyEdges(userID, vocab, wordNodeID, patternRelated, "shares_pattern", "词形相关", 6); err != nil {
			return err
		}
	}
	return nil
}

func (s *KnowledgeGraphService) addRelatedVocabularyEdges(userID uint, focus models.Vocabulary, focusNodeID uint, related []models.Vocabulary, relation, label string, limit int) error {
	added := 0
	seen := map[string]bool{normalizeLookupWord(focus.Word): true}
	for _, item := range related {
		key := normalizeLookupWord(item.Word)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		relatedID := item.ID
		mastery := vocabularyMasteryScore(item, time.Now())
		node, err := s.upsertNode(userID, graphNodeInput{
			Key:                WordNodeKey(item.ID),
			Type:               KnowledgeNodeWord,
			Label:              item.Word,
			Description:        firstNonEmptyText(firstMeaning(item.Translation), firstMeaning(item.Definition), item.Context),
			Weight:             maxInt(42, 68-item.ForgottenCount*2),
			SourceVocabularyID: &relatedID,
			SourceArticleID:    item.ArticleID,
			Familiarity:        mastery,
			ReviewCount:        item.ReviewCount,
			MistakeCount:       item.ForgottenCount,
			LastSeenAt:         lastSeenFromVocabulary(item),
			NextReviewAt:       item.NextReviewAt,
			StateSource:        "vocabulary",
			Metadata: map[string]interface{}{
				"vocabulary_id":   item.ID,
				"is_learned":      item.IsLearned,
				"review_count":    item.ReviewCount,
				"forgotten_count": item.ForgottenCount,
			},
		})
		if err != nil {
			return err
		}
		if err := s.upsertEdge(userID, focusNodeID, node.ID, graphEdgeInput{Relation: relation, Label: label, Weight: 62}); err != nil {
			return err
		}
		added++
		if added >= limit {
			return nil
		}
	}
	return nil
}

func (s *KnowledgeGraphService) upsertNode(userID uint, input graphNodeInput) (models.KnowledgeNode, error) {
	input.Label = strings.TrimSpace(input.Label)
	if input.Key == "" || input.Type == "" || input.Label == "" {
		return models.KnowledgeNode{}, fmt.Errorf("knowledge node requires key, type, and label")
	}
	metadata, _ := json.Marshal(input.Metadata)
	node := models.KnowledgeNode{
		UserID:             userID,
		NodeKey:            input.Key,
		Type:               input.Type,
		Label:              input.Label,
		Description:        strings.TrimSpace(input.Description),
		Weight:             clampInt(input.Weight, 1, 100),
		Metadata:           string(metadata),
		SourceVocabularyID: input.SourceVocabularyID,
		SourceArticleID:    input.SourceArticleID,
	}
	if node.Weight == 0 {
		node.Weight = 50
	}

	if err := s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "node_key"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"type":                 node.Type,
			"label":                node.Label,
			"description":          node.Description,
			"weight":               node.Weight,
			"metadata":             node.Metadata,
			"source_vocabulary_id": node.SourceVocabularyID,
			"source_article_id":    node.SourceArticleID,
			"updated_at":           time.Now(),
		}),
	}).Create(&node).Error; err != nil {
		return models.KnowledgeNode{}, err
	}

	if err := s.db.Where("user_id = ? AND node_key = ?", userID, input.Key).First(&node).Error; err != nil {
		return models.KnowledgeNode{}, err
	}

	if input.Familiarity > 0 || input.ReviewCount > 0 || input.MistakeCount > 0 || input.LastSeenAt != nil || input.NextReviewAt != nil || input.StateSource != "" {
		if err := s.upsertState(userID, node.ID, input); err != nil {
			return models.KnowledgeNode{}, err
		}
	}

	return node, nil
}

func (s *KnowledgeGraphService) upsertState(userID, nodeID uint, input graphNodeInput) error {
	familiarity := input.Familiarity
	if familiarity == 0 {
		familiarity = 30
	}
	state := models.UserKnowledgeState{
		UserID:       userID,
		NodeID:       nodeID,
		Familiarity:  clampInt(familiarity, 0, 100),
		ReviewCount:  input.ReviewCount,
		MistakeCount: input.MistakeCount,
		LastSeenAt:   input.LastSeenAt,
		NextReviewAt: input.NextReviewAt,
		Source:       input.StateSource,
	}
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "node_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"familiarity":    state.Familiarity,
			"review_count":   state.ReviewCount,
			"mistake_count":  state.MistakeCount,
			"last_seen_at":   state.LastSeenAt,
			"next_review_at": state.NextReviewAt,
			"source":         state.Source,
			"updated_at":     time.Now(),
		}),
	}).Create(&state).Error
}

func (s *KnowledgeGraphService) upsertEdge(userID, sourceID, targetID uint, input graphEdgeInput) error {
	if sourceID == 0 || targetID == 0 || sourceID == targetID || input.Relation == "" {
		return nil
	}
	metadata, _ := json.Marshal(input.Metadata)
	edge := models.KnowledgeEdge{
		UserID:       userID,
		SourceNodeID: sourceID,
		TargetNodeID: targetID,
		Relation:     input.Relation,
		Label:        input.Label,
		Weight:       clampInt(input.Weight, 1, 100),
		Metadata:     string(metadata),
	}
	if edge.Weight == 0 {
		edge.Weight = 50
	}
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "source_node_id"}, {Name: "target_node_id"}, {Name: "relation"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"label":      edge.Label,
			"weight":     edge.Weight,
			"metadata":   edge.Metadata,
			"updated_at": time.Now(),
		}),
	}).Create(&edge).Error
}

func (s *KnowledgeGraphService) findFocusNode(userID uint, query KnowledgeGraphQuery) (*models.KnowledgeNode, error) {
	if query.FocusKey != "" {
		var node models.KnowledgeNode
		if err := s.db.Where("user_id = ? AND node_key = ?", userID, query.FocusKey).First(&node).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &node, nil
	}
	if query.FocusType == KnowledgeNodeWord && query.FocusID > 0 {
		var node models.KnowledgeNode
		if err := s.db.Where("user_id = ? AND node_key = ?", userID, WordNodeKey(query.FocusID)).First(&node).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &node, nil
	}
	if query.FocusType == KnowledgeNodeArticle && query.FocusID > 0 {
		var node models.KnowledgeNode
		if err := s.db.Where("user_id = ? AND node_key = ?", userID, ArticleNodeKey(query.FocusID)).First(&node).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &node, nil
	}
	return nil, nil
}

func (s *KnowledgeGraphService) buildDTO(userID uint, nodesByID map[uint]models.KnowledgeNode, edgesByID map[uint]models.KnowledgeEdge, focus *models.KnowledgeNode) (KnowledgeGraphDTO, error) {
	nodeIDs := make([]uint, 0, len(nodesByID))
	for id := range nodesByID {
		nodeIDs = append(nodeIDs, id)
	}
	sort.Slice(nodeIDs, func(i, j int) bool {
		left := nodesByID[nodeIDs[i]]
		right := nodesByID[nodeIDs[j]]
		if focus != nil {
			if left.ID == focus.ID {
				return true
			}
			if right.ID == focus.ID {
				return false
			}
		}
		if left.Weight == right.Weight {
			return left.Label < right.Label
		}
		return left.Weight > right.Weight
	})

	var states []models.UserKnowledgeState
	if len(nodeIDs) > 0 {
		if err := s.db.Where("user_id = ? AND node_id IN ?", userID, nodeIDs).Find(&states).Error; err != nil {
			return KnowledgeGraphDTO{}, err
		}
	}
	stateByNode := make(map[uint]models.UserKnowledgeState)
	for _, state := range states {
		stateByNode[state.NodeID] = state
	}

	nodes := make([]KnowledgeGraphNodeDTO, 0, len(nodeIDs))
	stats := KnowledgeGraphStats{NodeTypes: make(map[string]int)}
	for _, id := range nodeIDs {
		node := nodesByID[id]
		dto := nodeDTO(node, stateByNode[id])
		nodes = append(nodes, dto)
		stats.TotalNodes++
		stats.NodeTypes[node.Type]++
		switch node.Type {
		case KnowledgeNodeWord:
			if focus == nil || node.ID != focus.ID {
				stats.RelatedWords++
			}
		case KnowledgeNodeArticle:
			stats.Articles++
		case KnowledgeNodeTopic:
			stats.Topics++
		case KnowledgeNodeGrammar:
			stats.GrammarPoints++
		case KnowledgeNodeWeakness:
			stats.WeakSignals++
		}
		if state, ok := stateByNode[id]; ok && state.NextReviewAt != nil && !state.NextReviewAt.After(time.Now()) {
			stats.DueReviews++
		}
	}

	nodeIDSet := make(map[uint]bool, len(nodesByID))
	for id := range nodesByID {
		nodeIDSet[id] = true
	}
	edgeIDs := make([]uint, 0, len(edgesByID))
	for id, edge := range edgesByID {
		if nodeIDSet[edge.SourceNodeID] && nodeIDSet[edge.TargetNodeID] {
			edgeIDs = append(edgeIDs, id)
		}
	}
	sort.Slice(edgeIDs, func(i, j int) bool {
		left := edgesByID[edgeIDs[i]]
		right := edgesByID[edgeIDs[j]]
		if left.Weight == right.Weight {
			return left.ID < right.ID
		}
		return left.Weight > right.Weight
	})
	edges := make([]KnowledgeGraphEdgeDTO, 0, len(edgeIDs))
	for _, id := range edgeIDs {
		edges = append(edges, edgeDTO(edgesByID[id], nodesByID))
	}
	stats.TotalEdges = len(edges)

	var focusDTO *KnowledgeGraphNodeDTO
	if focus != nil {
		dto := nodeDTO(*focus, stateByNode[focus.ID])
		focusDTO = &dto
	}

	// Compute groups from nodes
	groupCounts := make(map[string]int)
	for _, n := range nodes {
		groupCounts[n.Group]++
	}
	groupDefs := []struct{ id, label, color string }{
		{"vocabulary", "单词词汇", "#3b82f6"},
		{"context", "语境语法", "#8b5cf6"},
		{"article", "文章主题", "#f59e0b"},
		{"study", "学习状态", "#ef4444"},
	}
	groups := make([]KnowledgeGraphGroup, 0, len(groupDefs))
	for _, g := range groupDefs {
		if count, ok := groupCounts[g.id]; ok && count > 0 {
			groups = append(groups, KnowledgeGraphGroup{
				ID:        g.id,
				Label:     g.label,
				Color:     g.color,
				NodeCount: count,
			})
		}
	}

	return KnowledgeGraphDTO{
		Focus:  focusDTO,
		Nodes:  nodes,
		Edges:  edges,
		Stats:  stats,
		Groups: groups,
	}, nil
}

func (s *KnowledgeGraphService) queryNodes(userID uint, order string, limit int, nodeType string) ([]KnowledgeGraphNodeDTO, error) {
	query := s.db.Where("user_id = ?", userID)
	if nodeType != "" {
		query = query.Where("type = ?", nodeType)
	}
	var nodes []models.KnowledgeNode
	if err := query.Order(order).Limit(limit).Find(&nodes).Error; err != nil {
		return nil, err
	}
	return s.nodesToDTO(userID, nodes)
}

func (s *KnowledgeGraphService) queryStateNodes(userID uint, order, where string, limit int, args ...interface{}) ([]KnowledgeGraphNodeDTO, error) {
	var states []models.UserKnowledgeState
	if err := s.db.Preload("Node").
		Where("user_id = ?", userID).
		Where(where, args...).
		Order(order).
		Limit(limit).
		Find(&states).Error; err != nil {
		return nil, err
	}
	result := make([]KnowledgeGraphNodeDTO, 0, len(states))
	for _, state := range states {
		if state.Node.ID == 0 {
			continue
		}
		result = append(result, nodeDTO(state.Node, state))
	}
	return result, nil
}

func (s *KnowledgeGraphService) nodesToDTO(userID uint, nodes []models.KnowledgeNode) ([]KnowledgeGraphNodeDTO, error) {
	ids := make([]uint, 0, len(nodes))
	for _, node := range nodes {
		ids = append(ids, node.ID)
	}
	stateByNode := make(map[uint]models.UserKnowledgeState)
	if len(ids) > 0 {
		var states []models.UserKnowledgeState
		if err := s.db.Where("user_id = ? AND node_id IN ?", userID, ids).Find(&states).Error; err != nil {
			return nil, err
		}
		for _, state := range states {
			stateByNode[state.NodeID] = state
		}
	}
	result := make([]KnowledgeGraphNodeDTO, 0, len(nodes))
	for _, node := range nodes {
		result = append(result, nodeDTO(node, stateByNode[node.ID]))
	}
	return result, nil
}

func nodeGroup(nodeType string) string {
	switch nodeType {
	case KnowledgeNodeWord, KnowledgeNodeMeaning, KnowledgeNodeDefinition, KnowledgeNodeExample:
		return "vocabulary"
	case KnowledgeNodeContext, KnowledgeNodeGrammar:
		return "context"
	case KnowledgeNodeArticle, KnowledgeNodeTopic:
		return "article"
	case KnowledgeNodeWeakness, KnowledgeNodeReview:
		return "study"
	default:
		return "other"
	}
}

func nodeLevel(nodeType string) int {
	switch nodeType {
	case KnowledgeNodeWord:
		return 0
	case KnowledgeNodeMeaning, KnowledgeNodeDefinition, KnowledgeNodeContext, KnowledgeNodeExample:
		return 1
	default:
		return 2
	}
}

func nodeDTO(node models.KnowledgeNode, state models.UserKnowledgeState) KnowledgeGraphNodeDTO {
	metadata := decodeMetadata(node.Metadata)
	dto := KnowledgeGraphNodeDTO{
		ID:          node.NodeKey,
		DBID:        node.ID,
		Type:        node.Type,
		Label:       node.Label,
		Description: node.Description,
		Weight:      node.Weight,
		Group:       nodeGroup(node.Type),
		Level:       nodeLevel(node.Type),
		Metadata:    metadata,
	}
	if state.ID != 0 {
		mastery := clampInt(state.Familiarity, 0, 100)
		dto.Mastery = &mastery
		if dto.Metadata == nil {
			dto.Metadata = make(map[string]interface{})
		}
		dto.Metadata["review_count"] = state.ReviewCount
		dto.Metadata["forgotten_count"] = state.MistakeCount
		dto.Metadata["last_seen_at"] = state.LastSeenAt
		dto.Metadata["next_review_at"] = state.NextReviewAt
	}
	return dto
}

func edgeDTO(edge models.KnowledgeEdge, nodesByID map[uint]models.KnowledgeNode) KnowledgeGraphEdgeDTO {
	return KnowledgeGraphEdgeDTO{
		ID:       fmt.Sprintf("edge:%d", edge.ID),
		DBID:     edge.ID,
		Source:   nodesByID[edge.SourceNodeID].NodeKey,
		Target:   nodesByID[edge.TargetNodeID].NodeKey,
		Relation: edge.Relation,
		Label:    edge.Label,
		Weight:   edge.Weight,
		Metadata: decodeMetadata(edge.Metadata),
	}
}

func decodeMetadata(value string) map[string]interface{} {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	var metadata map[string]interface{}
	if err := json.Unmarshal([]byte(value), &metadata); err != nil {
		return nil
	}
	return metadata
}

func WordNodeKey(vocabularyID uint) string {
	return fmt.Sprintf("word:%d", vocabularyID)
}

func ArticleNodeKey(articleID uint) string {
	return fmt.Sprintf("article:%d", articleID)
}

func firstMeaning(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	var values []string
	if err := json.Unmarshal([]byte(value), &values); err == nil {
		for _, item := range values {
			if strings.TrimSpace(item) != "" {
				return strings.TrimSpace(item)
			}
		}
		return ""
	}

	var definitionItems []DefinitionItem
	if err := json.Unmarshal([]byte(value), &definitionItems); err == nil {
		for _, item := range definitionItems {
			if strings.TrimSpace(item.Definition) != "" {
				return strings.TrimSpace(item.Definition)
			}
		}
		return ""
	}

	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == '\n' || r == ';' || r == '；' || r == '。'
	})
	if len(parts) == 0 {
		return value
	}
	return strings.TrimSpace(parts[0])
}

func firstExample(vocab models.Vocabulary) string {
	value := strings.TrimSpace(vocab.Examples)
	if value == "" {
		return ""
	}
	var examples []string
	if err := json.Unmarshal([]byte(value), &examples); err == nil {
		for _, example := range examples {
			if strings.TrimSpace(example) != "" {
				return strings.TrimSpace(example)
			}
		}
		return ""
	}
	var items []map[string]string
	if err := json.Unmarshal([]byte(value), &items); err == nil {
		for _, item := range items {
			if strings.TrimSpace(item["example"]) != "" {
				return strings.TrimSpace(item["example"])
			}
		}
		return ""
	}
	return value
}

func detectGrammarPoints(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	candidates := []struct {
		name    string
		pattern string
	}{
		{"定语从句", `(?i)\b(who|whom|whose|which|that)\b`},
		{"条件句", `(?i)\bif\b.+\b(would|could|might|will|can)\b`},
		{"完成时", `(?i)\b(has|have|had)\s+\w+(ed|en)\b`},
		{"被动语态", `(?i)\b(am|is|are|was|were|be|been|being)\s+\w+(ed|en)\b`},
		{"非谓语结构", `(?i)\b(to\s+\w+|\w+ing)\b`},
		{"比较结构", `(?i)\b(more|less|better|worse|than|as\s+\w+\s+as)\b`},
		{"转折连接", `(?i)\b(however|although|though|whereas|while)\b`},
		{"因果连接", `(?i)\b(because|since|therefore|thus|so that|as a result)\b`},
	}
	result := make([]string, 0, 4)
	for _, candidate := range candidates {
		if regexp.MustCompile(candidate.pattern).MatchString(text) {
			result = append(result, candidate.name)
		}
		if len(result) >= 4 {
			break
		}
	}
	return result
}

func grammarDescription(name string) string {
	descriptions := map[string]string{
		"定语从句":  "修饰名词或代词的从句结构",
		"条件句":   "表达条件与结果关系的句型",
		"完成时":   "强调动作完成、经验或持续影响",
		"被动语态":  "突出动作承受者的表达方式",
		"非谓语结构": "不作谓语的动词形式，常用于压缩长句",
		"比较结构":  "用于比较程度、数量或性质",
		"转折连接":  "表达让步、对比或转折逻辑",
		"因果连接":  "表达原因、结果或推论逻辑",
	}
	return descriptions[name]
}

func articleTopics(article models.Article) []string {
	values := make([]string, 0, 8)
	addDelimitedGraphValues(&values, article.Category.Name)
	addDelimitedGraphValues(&values, article.Category.NameEN)
	addDelimitedGraphValues(&values, article.Tags)
	addDelimitedGraphValues(&values, article.Keywords)
	if article.DifficultyLevel != "" {
		values = append(values, "难度 "+article.DifficultyLevel)
	}
	if article.CEFRLevel != "" {
		values = append(values, article.CEFRLevel)
	}
	return uniqueLimitedGraphValues(values, 8)
}

func addDelimitedGraphValues(values *[]string, value string) {
	for _, part := range strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '，' || r == ';' || r == '；' || r == '|'
	}) {
		part = strings.TrimSpace(part)
		if part != "" {
			*values = append(*values, part)
		}
	}
}

func uniqueLimitedGraphValues(values []string, limit int) []string {
	result := make([]string, 0, limit)
	seen := make(map[string]bool)
	for _, value := range values {
		key := strings.ToLower(strings.TrimSpace(value))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, strings.TrimSpace(value))
		if len(result) >= limit {
			break
		}
	}
	return result
}

func vocabularyStem(word string) string {
	word = normalizeLookupWord(word)
	if len([]rune(word)) < 5 {
		return ""
	}
	runes := []rune(word)
	if len(runes) > 7 {
		return string(runes[:5])
	}
	return string(runes[:4])
}

func vocabularyMasteryScore(vocab models.Vocabulary, now time.Time) int {
	score := 30 + vocab.ReviewCount*12 - vocab.ForgottenCount*18
	if vocab.IsLearned {
		score += 30
	}
	if vocab.NextReviewAt != nil && vocab.NextReviewAt.Before(now) {
		score -= 10
	}
	return clampInt(score, 0, 100)
}

func lastSeenFromVocabulary(vocab models.Vocabulary) *time.Time {
	if vocab.LastReview != nil {
		return vocab.LastReview
	}
	if !vocab.UpdatedAt.IsZero() {
		value := vocab.UpdatedAt
		return &value
	}
	if !vocab.CreatedAt.IsZero() {
		value := vocab.CreatedAt
		return &value
	}
	return nil
}

func normalizeLookupWord(word string) string {
	word = strings.TrimSpace(strings.ToLower(word))
	word = strings.Trim(word, " \t\r\n.,;:!?\"'()[]{}")
	return word
}

func normalizeGraphID(value string) string {
	value = normalizeLookupWord(value)
	if value == "" {
		return "unknown"
	}
	replacer := strings.NewReplacer(" ", "-", "/", "-", "\\", "-", ":", "-", "#", "-")
	return replacer.Replace(value)
}

func shortenGraphLabel(value string, limit int) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if len([]rune(value)) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "..."
}

func firstNonEmptyText(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func clampInt(value, minValue, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

# AI 生成学习笔记功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户读完文章后显示 AI 生成的学习笔记，包含：核心观点、5个重点词、3个可复用表达、2个长难句、阅读理解小测、推荐下一篇文章

**Architecture:** 后端已有完整的精读笔记生成系统，只需调整 AI prompt 参数并新增「推荐下一篇文章」功能。前端已有笔记展示和测验功能，只需添加推荐文章展示。

**Tech Stack:** Go Gin (backend), Next.js + TypeScript (frontend), PostgreSQL

---

### Task 1: 调整 AI prompt 生成参数

**Files:**
- Modify: `backend/services/ai_analysis.go:360-372`

**Current state:** AI prompt 请求 6-12 个关键词、无固定数量限制的难句和表达替换

**Changes:**

- [ ] **Step 1: 查看当前的 AI prompt 配���**

查看 `backend/services/ai_analysis.go` 第 360-372 行的 system prompt

- [ ] **Step 2: 修改 prompt 中的数量要求**

将:
```go
keywords: 字符串数组，6-12 个关键词或表达
expression_replacements: 数组，每项包含 original, alternative, note
difficult_sentences: 数组，每项包含 text, translation, reason, tips
```

修改为:
```go
keywords: 字符串数组，精确 5 个关键词
expression_replacements: 数组，精确 3 项，每项包含 original, alternative, note
difficult_sentences: 数组，精确 2 项，每项包含 text, translation, reason, tips
```

- [ ] **Step 3: 提交更改**

```bash
git add backend/services/ai_analysis.go
git commit -m "feat(study-note): adjust AI prompt to output exactly 5 keywords, 3 expressions, 2 difficult sentences"
```

---

### Task 2: 实现推荐下一篇文章 API

**Covers:** 用户需求 - 推荐下一篇文章

**Files:**
- Modify: `backend/handlers/article.go` - 添加新 handler
- Modify: `backend/main.go` - 注册新路由

**Implementation:**

- [ ] **Step 1: 在 article handlers 中添加 GetNextArticle handler**

在 `backend/handlers/article.go` 添加新 handler:

```go
// GetRecommendedNextArticle 获取推荐下一篇文章
func GetRecommendedNextArticle(c *gin.Context) {
    userID := c.GetUint("user_id")
    articleID, err := strconv.ParseUint(c.Param("id"), 10, 32)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid article ID"})
        return
    }

    var currentArticle models.Article
    if err := database.DB.First(&currentArticle, articleID).Error; err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
        return
    }

    // 获取当前文章的标签
    var tags []models.ArticleTag
    database.DB.Model(&models.ArticleTag{}).Where("article_id = ?", articleID).Find(&tags)
    
    if len(tags) == 0 {
        // 无标签则返回随机文章
        var nextArticle models.Article
        query := database.DB.Where("id != ? AND status = ?", articleID, "published")
        if currentArticle.Category != "" {
            query = query.Where("category = ?", currentArticle.Category)
        }
        query.Order("RANDOM()").First(&nextArticle)
        
        c.JSON(http.StatusOK, gin.H{"data": nextArticle})
        return
    }

    // 基于标签推荐下一篇相似文章
    tagIDs := make([]uint, len(tags))
    for i, tag := range tags {
        tagIDs[i] = tag.TagID
    }

    var recommendedArticle models.Article
    err = database.DB.
        Table("articles a").
        Joins("JOIN article_tags at ON at.article_id = a.id").
        Where("a.id != ? AND a.status = ?", articleID, "published").
        Where("at.tag_id IN ?", tagIDs).
        Group("a.id").
        Order("COUNT(at.tag_id) DESC, RANDOM()").
        First(&recommendedArticle).Error

    if err != nil {
        // 没有找到相似文章，返回随机
        database.DB.Where("id != ? AND status = ?", articleID, "published").
            Order("RANDOM()").First(&recommendedArticle)
    }

    c.JSON(http.StatusOK, gin.H{"data": recommendedArticle})
}
```

- [ ] **Step 2: 在 main.go 中注册新路由**

在 `backend/main.go` 的 protected 路由中添加:

```go
protected.GET("/articles/:id/next", handlers.GetRecommendedNextArticle)
```

- [ ] **Step 3: 测试编译**

```bash
cd backend && go build ./...
```

- [ ] **Step 4: 提交更改**

```bash
git add backend/handlers/article.go backend/main.go
git commit -m "feat(study-note): add next article recommendation API"
```

---

### Task 3: 前端添加推荐文章展示

**Covers:** 用户需求 - 推荐下一篇文章

**Files:**
- Modify: `frontend/src/lib/api.ts` - 添加 API 方法
- Modify: `frontend/src/types/index.ts` - 添加类型
- Modify: `frontend/src/app/articles/[slug]/page.tsx` - 添加展示组件

**Implementation:**

- [ ] **Step 1: 添加 API 方法**

在 `frontend/src/lib/api.ts` 添加:

```typescript
getNextArticle: (id: number) => api.get(`/articles/${id}/next`),
```

- [ ] **Step 2: 添加类型定义**

在 `frontend/src/types/index.ts` 添加 (如果 Article 类型已包含所需字段则不需要):

```typescript
// 使用现有的 Article 类型
```

- [ ] **Step 3: 在文章页面添加推荐文章 state 和 fetch**

在 `frontend/src/app/articles/[slug]/page.tsx`:

添加 state:
```typescript
const [nextArticle, setNextArticle] = useState<Article | null>(null);
```

添加 fetch 函数:
```typescript
const fetchNextArticle = useCallback(async (articleID: number) => {
  try {
    const response = await articleAPI.getNextArticle(articleID);
    if (response.data.data) {
      setNextArticle(response.data.data as Article);
    }
  } catch (err) {
    console.error('Failed to fetch next article:', err);
  }
}, []);
```

在阅读完成后获取推荐:
```typescript
useEffect(() => {
  if (article && readProgress >= 99) {
    fetchNextArticle(article.id);
  }
}, [article, readProgress, fetchNextArticle]);
```

- [ ] **Step 4: 在精读笔记面板添加推荐文章展示**

在现有的学习笔记展示区域 (约 2321-2449 行) 末尾添加:

```tsx
{nextArticle && (
  <div className="mt-6 rounded-md border border-sky-900/50 bg-sky-950/20 p-4">
    <div className="mb-2 text-sm font-semibold text-sky-100">推荐下一篇文章</div>
    <Link
      href={`/articles/${nextArticle.slug}`}
      className="group block rounded-md border border-sky-900/40 bg-gray-950/30 p-3 transition-colors hover:border-sky-700/50 hover:bg-sky-900/20"
    >
      <div className="font-semibold text-sky-50 group-hover:text-sky-300">
        {nextArticle.title}
      </div>
      {nextArticle.summary && (
        <div className="mt-1 text-sm text-sky-100/70 line-clamp-2">
          {nextArticle.summary}
        </div>
      )}
    </Link>
  </div>
)}
```

- [ ] **Step 5: 运行 lint 检查**

```bash
cd frontend && npm run lint
```

- [ ] **Step 6: 提交更改**

```bash
git add frontend/src/lib/api.ts frontend/src/app/articles/\[slug\]/page.tsx
git commit -m "feat(study-note): add next article recommendation UI"
```

---

### Task 4: 验证功能完整性

- [ ] **Step 1: 运行后端测试**

```bash
cd backend && go test ./...
```

- [ ] **Step 2: 运行前端构建**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat: complete AI study notes with next article recommendation"
```

---

## 实现顺序

1. Task 1: 调整 AI prompt (5 keywords, 3 expressions, 2 sentences)
2. Task 2: 后端添加推荐文章 API
3. Task 3: 前端添加推荐文章展示
4. Task 4: 验证功能
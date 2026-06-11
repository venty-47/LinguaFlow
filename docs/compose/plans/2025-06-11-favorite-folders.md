# 收藏夹功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为文章收藏功能添加收藏夹分类能力，支持用户创建多个收藏夹并分类管理收藏文章。

**Architecture:** 新增 FavoriteFolder 模型，修改 Subscription 添加 FolderID 外键关联。后端提供收藏夹 CRUD API，前端在收藏按钮添加下拉菜单选择收藏夹。

**Tech Stack:** Go + GORM + Gin (后端), Next.js + TypeScript + Tailwind CSS (前端)

---

## 文件结构

### 后端文件
- **新增**: `backend/models/favorite_folder.go` - FavoriteFolder 模型
- **修改**: `backend/models/models.go` - Subscription 添加 FolderID 字段
- **新增**: `backend/handlers/favorite_folder.go` - 收藏夹 CRUD handler
- **修改**: `backend/handlers/user.go` - 修改收藏 API 支持 folder_id
- **修改**: `backend/main.go` - 注册收藏夹路由
- **修改**: `backend/database/db.go` - AutoMigrate 添加 FavoriteFolder

### 前端文件
- **修改**: `frontend/src/types/index.ts` - 添加 FavoriteFolder 类型定义
- **修改**: `frontend/src/lib/api.ts` - 添加收藏夹 API
- **新增**: `frontend/src/components/FavoriteFolderSelect.tsx` - 收藏夹选择下拉组件
- **新增**: `frontend/src/components/FavoriteFolderManager.tsx` - 收藏夹管理组件（含图标选择）
- **修改**: `frontend/src/app/subscriptions/page.tsx` - 重构为收藏夹列表页
- **修改**: `frontend/src/app/articles/[slug]/page.tsx` - 集成收藏夹选择
- **修改**: `frontend/src/app/articles/[slug]/read/page.tsx` - 集成收藏夹选择

---

## Task 1: 后端模型和数据库迁移

**Covers:** [S2]

**Files:**
- Create: `backend/models/favorite_folder.go`
- Modify: `backend/models/models.go:204-216`
- Modify: `backend/database/db.go:34-61`

- [ ] **Step 1: 创建 FavoriteFolder 模型**

```go
// backend/models/favorite_folder.go
package models

import (
	"time"

	"gorm.io/gorm"
)

// FavoriteFolder 收藏夹
type FavoriteFolder struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID    uint   `gorm:"not null;index" json:"user_id"`
	Name      string `gorm:"size:100;not null" json:"name"`
	Icon      string `gorm:"size:50;default:'folder'" json:"icon"`
	SortOrder int    `gorm:"default:0" json:"sort_order"`
	IsDefault bool   `gorm:"default:false" json:"is_default"`

	User          User           `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Subscriptions []Subscription `gorm:"foreignKey:FolderID" json:"subscriptions,omitempty"`
}
```

- [ ] **Step 2: 修改 Subscription 模型添加 FolderID**

在 `backend/models/models.go` 的 Subscription 结构体中添加：

```go
FolderID uint           `gorm:"not null;index" json:"folder_id"`
Folder   FavoriteFolder `gorm:"foreignKey:FolderID" json:"folder,omitempty"`
```

- [ ] **Step 3: 更新 AutoMigrate**

在 `backend/database/db.go` 的 AutoMigrate 中添加 `&models.FavoriteFolder{}`。

- [ ] **Step 4: 编译验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add backend/models/favorite_folder.go backend/models/models.go backend/database/db.go
git commit -m "feat: add FavoriteFolder model and database migration"
```

---

## Task 2: 收藏夹 CRUD Handler

**Covers:** [S3, S7]

**Files:**
- Create: `backend/handlers/favorite_folder.go`

- [ ] **Step 1: 创建收藏夹 handler 文件**

```go
// backend/handlers/favorite_folder.go
package handlers

import (
	"gugudu-backend/database"
	"gugudu-backend/models"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// GetFavoriteFolders 获取用户的所有收藏夹
func GetFavoriteFolders(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var folders []models.FavoriteFolder
	if err := database.DB.Where("user_id = ?", userID).
		Order("is_default DESC, sort_order ASC, created_at ASC").
		Find(&folders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type FolderWithCount struct {
		models.FavoriteFolder
		ArticleCount int `json:"article_count"`
	}

	result := make([]FolderWithCount, len(folders))
	for i, folder := range folders {
		var count int64
		database.DB.Model(&models.Subscription{}).Where("folder_id = ?", folder.ID).Count(&count)
		result[i] = FolderWithFolder{
			FavoriteFolder: folder,
			ArticleCount:   int(count),
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// CreateFavoriteFolder 创建收藏夹
func CreateFavoriteFolder(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req struct {
		Name string `json:"name" binding:"required"`
		Icon string `json:"icon"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查收藏夹数量限制
	var count int64
	database.DB.Model(&models.FavoriteFolder{}).Where("user_id = ?", userID).Count(&count)
	if count >= 20 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "收藏夹数量已达上限(20个)"})
		return
	}

	if req.Icon == "" {
		req.Icon = "folder"
	}

	folder := models.FavoriteFolder{
		UserID: userID.(uint),
		Name:   req.Name,
		Icon:   req.Icon,
	}

	if err := database.DB.Create(&folder).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create folder"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": folder})
}

// UpdateFavoriteFolder 更新收藏夹
func UpdateFavoriteFolder(c *gin.Context) {
	userID, _ := c.Get("user_id")
	folderID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid folder ID"})
		return
	}

	var folder models.FavoriteFolder
	if err := database.DB.Where("id = ? AND user_id = ?", folderID, userID).First(&folder).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Folder not found"})
		return
	}

	if folder.IsDefault {
		c.JSON(http.StatusForbidden, gin.H{"error": "默认收藏夹不能修改"})
		return
	}

	var req struct {
		Name      string `json:"name"`
		Icon      string `json:"icon"`
		SortOrder int    `json:"sort_order"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Icon != "" {
		updates["icon"] = req.Icon
	}
	if req.SortOrder != 0 {
		updates["sort_order"] = req.SortOrder
	}

	database.DB.Model(&folder).Updates(updates)

	c.JSON(http.StatusOK, gin.H{"data": folder})
}

// DeleteFavoriteFolder 删除收藏夹
func DeleteFavoriteFolder(c *gin.Context) {
	userID, _ := c.Get("user_id")
	folderID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid folder ID"})
		return
	}

	var folder models.FavoriteFolder
	if err := database.DB.Where("id = ? AND user_id = ?", folderID, userID).First(&folder).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Folder not found"})
		return
	}

	if folder.IsDefault {
		c.JSON(http.StatusForbidden, gin.H{"error": "默认收藏夹不能删除"})
		return
	}

	// 获取默认收藏夹
	var defaultFolder models.FavoriteFolder
	database.DB.Where("user_id = ? AND is_default = true", userID).First(&defaultFolder)

	// 将文章移回默认收藏夹
	database.DB.Model(&models.Subscription{}).Where("folder_id = ?", folderID).Update("folder_id", defaultFolder.ID)

	// 删除收藏夹
	database.DB.Delete(&folder)

	c.JSON(http.StatusOK, gin.H{"message": "Folder deleted"})
}

// UpdateFolderSort 更新收藏夹排序
func UpdateFolderSort(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req struct {
		FolderIDs []uint `json:"folder_ids" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for i, folderID := range req.FolderIDs {
		database.DB.Model(&models.FavoriteFolder{}).
			Where("id = ? AND user_id = ?", folderID, userID).
			Update("sort_order", i)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Sort order updated"})
}
```

- [ ] **Step 2: 修复代码错误**

注意上面代码中有 typo：`FolderWithFolder` 应该是 `FolderWithCount`，修复它。

- [ ] **Step 3: 编译验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add backend/handlers/favorite_folder.go
git commit -m "feat: add favorite folder CRUD handlers"
```

---

## Task 3: 修改收藏 API 支持 folder_id

**Covers:** [S3]

**Files:**
- Modify: `backend/handlers/user.go:28-70`
- Modify: `backend/main.go:163-166`

- [ ] **Step 1: 修改 AddSubscription handler**

在 `backend/handlers/user.go` 中修改 AddSubscription：

```go
// AddSubscription 添加订阅
func AddSubscription(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req struct {
		ArticleID uint `json:"article_id" binding:"required"`
		FolderID  uint `json:"folder_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查文章是否存在
	var article models.Article
	if err := database.DB.First(&article, req.ArticleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
		return
	}

	// 检查是否已订阅
	var existing models.Subscription
	if err := database.DB.Where("user_id = ? AND article_id = ?", userID, req.ArticleID).
		First(&existing).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{"message": "Already subscribed"})
		return
	}

	// 如果未指定收藏夹，使用默认收藏夹
	folderID := req.FolderID
	if folderID == 0 {
		var defaultFolder models.FavoriteFolder
		if err := database.DB.Where("user_id = ? AND is_default = true", userID).First(&defaultFolder).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Default folder not found"})
			return
		}
		folderID = defaultFolder.ID
	} else {
		// 验证收藏夹属于当前用户
		var folder models.FavoriteFolder
		if err := database.DB.Where("id = ? AND user_id = ?", folderID, userID).First(&folder).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Folder not found"})
			return
		}
	}

	subscription := models.Subscription{
		UserID:    userID.(uint),
		ArticleID: req.ArticleID,
		FolderID:  folderID,
	}

	if err := database.DB.Create(&subscription).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to subscribe"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Subscribed successfully",
		"data":    subscription,
	})
}
```

- [ ] **Step 2: 添加移动收藏文章 API**

在 `backend/handlers/user.go` 中添加：

```go
// MoveSubscription 移动收藏文章到其他收藏夹
func MoveSubscription(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req struct {
		ArticleID   uint `json:"article_id" binding:"required"`
		ToFolderID  uint `json:"to_folder_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 验证目标收藏夹属于当前用户
	var folder models.FavoriteFolder
	if err := database.DB.Where("id = ? AND user_id = ?", req.ToFolderID, userID).First(&folder).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Target folder not found"})
		return
	}

	result := database.DB.Model(&models.Subscription{}).
		Where("user_id = ? AND article_id = ?", userID, req.ArticleID).
		Update("folder_id", req.ToFolderID)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Moved successfully"})
}
```

- [ ] **Step 3: 修改 GetMySubscriptions 支持按收藏夹筛选**

```go
// GetMySubscriptions 获取我的订阅
func GetMySubscriptions(c *gin.Context) {
	userID, _ := c.Get("user_id")
	folderID := c.Query("folder_id")

	query := database.DB.Where("user_id = ?", userID).
		Preload("Article").
		Preload("Article.Category").
		Preload("Folder")

	if folderID != "" {
		query = query.Where("folder_id = ?", folderID)
	}

	var subscriptions []models.Subscription
	if err := query.Order("created_at DESC").Find(&subscriptions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": subscriptions})
}
```

- [ ] **Step 4: 注册新路由**

在 `backend/main.go` 中添加收藏夹路由和移动 API：

```go
// 收藏夹管理
protected.GET("/favorite-folders", handlers.GetFavoriteFolders)
protected.POST("/favorite-folders", handlers.CreateFavoriteFolder)
protected.PUT("/favorite-folders/:id", handlers.UpdateFavoriteFolder)
protected.DELETE("/favorite-folders/:id", handlers.DeleteFavoriteFolder)
protected.PUT("/favorite-folders-sort", handlers.UpdateFolderSort)

// 订阅管理（修改）
protected.GET("/subscriptions", handlers.GetMySubscriptions)
protected.POST("/subscriptions", handlers.AddSubscription)
protected.DELETE("/subscriptions/:article_id", handlers.RemoveSubscription)
protected.PUT("/subscriptions/move", handlers.MoveSubscription)
```

- [ ] **Step 5: 编译验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 6: Commit**

```bash
git add backend/handlers/user.go backend/main.go
git commit -m "feat: add folder_id support to subscription APIs"
```

---

## Task 4: 默认收藏夹和数据迁移

**Covers:** [S5, S6]

**Files:**
- Modify: `backend/database/db.go`
- 查找用户注册的 handler 并修改

- [ ] **Step 1: 在 SeedDemoData 中添加默认收藏夹创建逻辑**

在 `backend/database/db.go` 中，查找 SeedDemoData 函数，在其中添加为现有用户创建默认收藏夹的逻辑：

```go
// 为现有用户创建默认收藏夹
var users []models.User
DB.Find(&users)
for _, user := range users {
	var count int64
	DB.Model(&models.FavoriteFolder{}).Where("user_id = ? AND is_default = true", user.ID).Count(&count)
	if count == 0 {
		DB.Create(&models.FavoriteFolder{
			UserID:    user.ID,
			Name:      "默认收藏夹",
			Icon:      "folder",
			IsDefault: true,
		})
	}
}

// 迁移旧的收藏记录到默认收藏夹
DB.Exec(`
	UPDATE subscriptions
	SET folder_id = (
		SELECT id FROM favorite_folders
		WHERE user_id = subscriptions.user_id AND is_default = true
		LIMIT 1
	)
	WHERE folder_id = 0
`)
```

- [ ] **Step 2: 查找用户注册 handler 添加默认收藏夹创建**

搜索用户注册相关的 handler，在创建用户成功后添加：

```go
// 创建默认收藏夹
defaultFolder := models.FavoriteFolder{
	UserID:    user.ID,
	Name:      "默认收藏夹",
	Icon:      "folder",
	IsDefault: true,
}
database.DB.Create(&defaultFolder)
```

- [ ] **Step 3: 编译验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add backend/database/db.go
git commit -m "feat: add default folder creation and data migration"
```

---

## Task 5: 前端类型定义和 API

**Covers:** [S3]

**Files:**
- Modify: `frontend/src/types/index.ts:392-399`
- Modify: `frontend/src/lib/api.ts:317-323`

- [ ] **Step 1: 添加 FavoriteFolder 类型定义**

在 `frontend/src/types/index.ts` 中添加：

```typescript
export interface FavoriteFolder {
  id: number;
  user_id: number;
  name: string;
  icon: string;
  sort_order: number;
  is_default: boolean;
  article_count: number;
  created_at: string;
  updated_at: string;
}

// 修改 Subscription 类型添加 folder_id
export interface Subscription {
  id: number;
  user_id: number;
  article_id: number;
  folder_id: number;
  article?: Article;
  folder?: FavoriteFolder;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: 添加收藏夹 API**

在 `frontend/src/lib/api.ts` 中添加：

```typescript
// 收藏夹 API
export const favoriteFolderAPI = {
  getFolders: () => api.get('/favorite-folders'),
  createFolder: (data: { name: string; icon?: string }) =>
    api.post('/favorite-folders', data),
  updateFolder: (id: number, data: { name?: string; icon?: string }) =>
    api.put(`/favorite-folders/${id}`, data),
  deleteFolder: (id: number) =>
    api.delete(`/favorite-folders/${id}`),
  updateSort: (folder_ids: number[]) =>
    api.put('/favorite-folders-sort', { folder_ids }),
};

// 修改 subscriptionAPI
export const subscriptionAPI = {
  getSubscriptions: (folder_id?: number) =>
    api.get('/subscriptions', { params: folder_id ? { folder_id } : {} }),
  addSubscription: (article_id: number, folder_id?: number) =>
    api.post('/subscriptions', { article_id, folder_id }),
  removeSubscription: (article_id: number) =>
    api.delete(`/subscriptions/${article_id}`),
  moveSubscription: (article_id: number, to_folder_id: number) =>
    api.put('/subscriptions/move', { article_id, to_folder_id }),
};
```

- [ ] **Step 3: TypeScript 编译验证**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/lib/api.ts
git commit -m "feat: add FavoriteFolder types and API definitions"
```

---

## Task 6: 收藏夹选择下拉组件

**Covers:** [S4]

**Files:**
- Create: `frontend/src/components/FavoriteFolderSelect.tsx`

- [ ] **Step 1: 创建 FavoriteFolderSelect 组件**

```tsx
// frontend/src/components/FavoriteFolderSelect.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { favoriteFolderAPI, subscriptionAPI } from '@/lib/api';
import { FavoriteFolder } from '@/types';
import { ChevronDown, Folder, Plus, Check } from 'lucide-react';

const ICON_MAP: Record<string, React.ReactNode> = {
  folder: <Folder className="h-4 w-4" />,
  bookmark: <span>🔖</span>,
  star: <span>⭐</span>,
  heart: <span>❤️</span>,
  book: <span>📖</span>,
};

interface FavoriteFolderSelectProps {
  articleId: number;
  isFavorited: boolean;
  currentFolderId?: number;
  onFavoriteChange: (isFavorited: boolean, folderId?: number) => void;
}

export default function FavoriteFolderSelect({
  articleId,
  isFavorited,
  currentFolderId,
  onFavoriteChange,
}: FavoriteFolderSelectProps) {
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadFolders();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowNewFolder(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadFolders = async () => {
    try {
      const response = await favoriteFolderAPI.getFolders();
      setFolders(response.data.data);
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  };

  const handleQuickFavorite = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (isFavorited) {
        await subscriptionAPI.removeSubscription(articleId);
        onFavoriteChange(false);
      } else {
        const defaultFolder = folders.find(f => f.is_default);
        if (defaultFolder) {
          await subscriptionAPI.addSubscription(articleId, defaultFolder.id);
          onFavoriteChange(true, defaultFolder.id);
        }
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFolder = async (folderId: number) => {
    if (loading) return;
    setLoading(true);
    try {
      if (isFavorited) {
        await subscriptionAPI.moveSubscription(articleId, folderId);
        onFavoriteChange(true, folderId);
      } else {
        await subscriptionAPI.addSubscription(articleId, folderId);
        onFavoriteChange(true, folderId);
      }
      setIsOpen(false);
    } catch (err) {
      console.error('Failed to favorite:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || loading) return;
    setLoading(true);
    try {
      const response = await favoriteFolderAPI.createFolder({ name: newFolderName });
      const newFolder = response.data.data;
      setFolders([...folders, { ...newFolder, article_count: 0 }]);
      setNewFolderName('');
      setShowNewFolder(false);
      await handleSelectFolder(newFolder.id);
    } catch (err) {
      console.error('Failed to create folder:', err);
    } finally {
      setLoading(false);
    }
  };

  const currentFolder = folders.find(f => f.id === currentFolderId);

  return (
    <div className="relative inline-flex" ref={dropdownRef}>
      <button
        onClick={handleQuickFavorite}
        disabled={loading}
        className={`inline-flex items-center gap-2 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors ${
          isFavorited
            ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}
      >
        {isFavorited ? (
          <>
            <Check className="h-4 w-4" />
            {currentFolder?.name || '已收藏'}
          </>
        ) : (
          '收藏'
        )}
      </button>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center rounded-r-lg border-l border-gray-300 bg-gray-100 px-2 py-2 text-sm text-gray-600 hover:bg-gray-200"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="max-h-60 overflow-y-auto p-1">
            {folders.map(folder => (
              <button
                key={folder.id}
                onClick={() => handleSelectFolder(folder.id)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-gray-100 ${
                  folder.id === currentFolderId ? 'bg-blue-50 text-blue-600' : ''
                }`}
              >
                <span>{ICON_MAP[folder.icon] || ICON_MAP.folder}</span>
                <span className="flex-1 text-left">{folder.name}</span>
                <span className="text-xs text-gray-400">{folder.article_count}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 p-1">
            {showNewFolder ? (
              <div className="flex gap-1 p-1">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                  placeholder="收藏夹名称"
                  className="flex-1 rounded border px-2 py-1 text-sm"
                  autoFocus
                />
                <button
                  onClick={handleCreateFolder}
                  className="rounded bg-blue-500 px-2 py-1 text-sm text-white hover:bg-blue-600"
                >
                  创建
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewFolder(true)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                <Plus className="h-4 w-4" />
                新建收藏夹
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FavoriteFolderSelect.tsx
git commit -m "feat: add FavoriteFolderSelect dropdown component"
```

---

## Task 7: 集成收藏夹选择到文章详情页

**Covers:** [S4]

**Files:**
- Modify: `frontend/src/app/articles/[slug]/page.tsx`
- Modify: `frontend/src/app/articles/[slug]/read/page.tsx`

- [ ] **Step 1: 修改文章详情页收藏逻辑**

在文章详情页中，替换原来的收藏按钮为 FavoriteFolderSelect 组件：

1. 添加状态：
```typescript
const [currentFolderId, setCurrentFolderId] = useState<number | undefined>();
```

2. 修改收藏状态初始化逻辑，记录当前收藏夹 ID：
```typescript
useEffect(() => {
  const checkFavorite = async () => {
    try {
      const response = await subscriptionAPI.getSubscriptions();
      const subs = response.data.data;
      const existing = subs.find((s: Subscription) => s.article_id === articleId);
      if (existing) {
        setIsFavorited(true);
        setCurrentFolderId(existing.folder_id);
      }
    } catch (err) {
      console.error(err);
    }
  };
  checkFavorite();
}, [articleId]);
```

3. 替换收藏按钮：
```tsx
<FavoriteFolderSelect
  articleId={article.id}
  isFavorited={isFavorited}
  currentFolderId={currentFolderId}
  onFavoriteChange={(fav, folderId) => {
    setIsFavorited(fav);
    setCurrentFolderId(folderId);
  }}
/>
```

- [ ] **Step 2: 对阅读模式页面做相同修改**

- [ ] **Step 3: TypeScript 编译验证**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/articles/
git commit -m "feat: integrate FavoriteFolderSelect into article pages"
```

---

## Task 8: 收藏夹列表页重构

**Covers:** [S4]

**Files:**
- Modify: `frontend/src/app/subscriptions/page.tsx`

- [ ] **Step 1: 重构收藏夹列表页**

```tsx
// frontend/src/app/subscriptions/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ArticleCard from '@/components/ArticleCard';
import { subscriptionAPI, favoriteFolderAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Subscription, FavoriteFolder } from '@/types';
import { Loader2, Folder, Plus, Settings, Trash2, Edit2, Star, Heart, BookOpen, Bookmark, Pin } from 'lucide-react';

const ICON_COMPONENTS: Record<string, React.ReactNode> = {
  folder: <Folder className="h-5 w-5" />,
  bookmark: <Bookmark className="h-5 w-5" />,
  star: <Star className="h-5 w-5" />,
  heart: <Heart className="h-5 w-5" />,
  book: <BookOpen className="h-5 w-5" />,
  pin: <Pin className="h-5 w-5" />,
};

const ICON_OPTIONS = ['folder', 'bookmark', 'star', 'heart', 'book', 'pin'];

export default function SubscriptionsPage() {
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolder, setEditingFolder] = useState<FavoriteFolder | null>(null);
  const [showIconPicker, setShowIconPicker] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || !token) {
      router.replace('/login');
      return;
    }
    loadData();
  }, [isAuthenticated, mounted, router, token]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [foldersRes, subsRes] = await Promise.all([
        favoriteFolderAPI.getFolders(),
        subscriptionAPI.getSubscriptions(),
      ]);
      setFolders(foldersRes.data.data);
      setSubscriptions(subsRes.data.data);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFolder = async (folderId: number | null) => {
    setSelectedFolderId(folderId);
    try {
      const response = await subscriptionAPI.getSubscriptions(folderId || undefined);
      setSubscriptions(response.data.data);
    } catch (err) {
      console.error('Failed to load subscriptions:', err);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await favoriteFolderAPI.createFolder({ name: newFolderName });
      setNewFolderName('');
      setShowNewFolder(false);
      await loadData();
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const handleDeleteFolder = async (folderId: number) => {
    if (!confirm('确定删除此收藏夹？文章将移回默认收藏夹。')) return;
    try {
      await favoriteFolderAPI.deleteFolder(folderId);
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
      await loadData();
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  const handleUpdateFolder = async (folderId: number, data: { name?: string; icon?: string }) => {
    try {
      await favoriteFolderAPI.updateFolder(folderId, data);
      setEditingFolder(null);
      setShowIconPicker(false);
      await loadData();
    } catch (err) {
      console.error('Failed to update folder:', err);
    }
  };

  const filteredSubscriptions = selectedFolderId
    ? subscriptions.filter(s => s.folder_id === selectedFolderId)
    : subscriptions;

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-black">我的收藏</h1>
        <p className="text-gray-500">管理你的收藏夹和收藏的文章。</p>
      </div>

      <div className="flex gap-6">
        {/* 左侧边栏 - 收藏夹列表 */}
        <div className="w-64 flex-shrink-0">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">收藏夹</h2>
              <button
                onClick={() => setShowNewFolder(true)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* 新建收藏夹输入 */}
            {showNewFolder && (
              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                  placeholder="收藏夹名称"
                  className="flex-1 rounded border px-2 py-1 text-sm"
                  autoFocus
                />
                <button
                  onClick={handleCreateFolder}
                  className="rounded bg-blue-500 px-2 py-1 text-xs text-white"
                >
                  创建
                </button>
              </div>
            )}

            {/* 全部 */}
            <button
              onClick={() => handleSelectFolder(null)}
              className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm ${
                selectedFolderId === null ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100'
              }`}
            >
              <Folder className="h-4 w-4" />
              <span className="flex-1 text-left">全部</span>
              <span className="text-xs text-gray-400">
                {folders.reduce((sum, f) => sum + f.article_count, 0)}
              </span>
            </button>

            {/* 收藏夹列表 */}
            {folders.map(folder => (
              <div
                key={folder.id}
                className={`group flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  selectedFolderId === folder.id ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100'
                }`}
              >
                <button
                  onClick={() => handleSelectFolder(folder.id)}
                  className="flex flex-1 items-center gap-2"
                >
                  <span>{ICON_COMPONENTS[folder.icon] || ICON_COMPONENTS.folder}</span>
                  <span className="flex-1 text-left">{folder.name}</span>
                  <span className="text-xs text-gray-400">{folder.article_count}</span>
                </button>
                {!folder.is_default && (
                  <div className="hidden gap-1 group-hover:flex">
                    <button
                      onClick={() => setEditingFolder(folder)}
                      className="rounded p-1 text-gray-400 hover:text-gray-600"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDeleteFolder(folder.id)}
                      className="rounded p-1 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 图标选择器弹窗 */}
          {editingFolder && (
            <div className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-medium">编辑收藏夹</h3>
              <input
                type="text"
                defaultValue={editingFolder.name}
                onBlur={e => {
                  if (e.target.value !== editingFolder.name) {
                    handleUpdateFolder(editingFolder.id, { name: e.target.value });
                  }
                }}
                className="mb-2 w-full rounded border px-2 py-1 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {ICON_OPTIONS.map(icon => (
                  <button
                    key={icon}
                    onClick={() => handleUpdateFolder(editingFolder.id, { icon })}
                    className={`rounded p-2 ${
                      editingFolder.icon === icon ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'
                    }`}
                  >
                    {ICON_COMPONENTS[icon]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 右侧 - 文章列表 */}
        <div className="flex-1">
          {filteredSubscriptions.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-10 text-center text-gray-500">
              {selectedFolderId ? '此收藏夹暂无文章。' : '还没有收藏文章。打开文章详情页，点击"收藏"即可添加。'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredSubscriptions.map(subscription =>
                subscription.article ? (
                  <ArticleCard key={subscription.id} article={subscription.article} />
                ) : null
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/subscriptions/page.tsx
git commit -m "feat: redesign subscriptions page with folder sidebar"
```

---

## Task 9: 最终验证

**Covers:** [S1-S8]

- [ ] **Step 1: 后端编译验证**

```bash
cd backend && go build ./...
```

- [ ] **Step 2: 前端类型检查和编译**

```bash
cd frontend && npm run lint && npm run build
```

- [ ] **Step 3: 运行后端测试**

```bash
cd backend && go test ./...
```

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete favorite folders feature"
```

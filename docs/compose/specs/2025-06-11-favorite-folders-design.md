# 收藏夹功能设计文档

## [S1] 概述

为文章收藏功能添加文件夹分类能力，用户可以创建多个收藏夹，将文章收藏到指定收藏夹中。

**核心特性**：
- 收藏夹 CRUD（创建、重命名、删除、图标、排序）
- 文章收藏时通过下拉菜单选择收藏夹
- 默认收藏夹自动创建，现有数据自动迁移
- 收藏夹列表页左侧边栏展示

## [S2] 数据模型

### 新增 FavoriteFolder 模型

```go
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

    User         User          `gorm:"foreignKey:UserID" json:"user,omitempty"`
    Subscriptions []Subscription `gorm:"foreignKey:FolderID" json:"subscriptions,omitempty"`
}
```

### 修改 Subscription 模型

```go
// Subscription 用户收藏
type Subscription struct {
    // ... 现有字段 ...

    FolderID uint              `gorm:"not null;index" json:"folder_id"`
    Folder   FavoriteFolder    `gorm:"foreignKey:FolderID" json:"folder,omitempty"`
}
```

### 预设图标列表

```
folder, bookmark, star, heart, book, bookmark-filled, 
folder-open, collection, tag, pin, flag, fire, 
lightning, diamond, crown, gem
```

## [S3] API 设计

### 收藏夹管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/favorite-folders | 获取用户所有收藏夹（含文章数量） |
| POST | /api/favorite-folders | 创建收藏夹 |
| PUT | /api/favorite-folders/:id | 更新收藏夹（名称、图标） |
| DELETE | /api/favorite-folders/:id | 删除收藏夹（文章移回默认） |
| PUT | /api/favorite-folders/sort | 批量更新排序 |

### 收藏操作（修改现有）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/subscriptions | 添加收藏（body 增加 folder_id） |
| DELETE | /api/subscriptions/:article_id | 取消收藏 |
| PUT | /api/subscriptions/move | 移动文章到其他收藏夹 |
| GET | /api/subscriptions | 获取收藏列表（增加 folder_id 查询参数） |

### 请求/响应示例

**创建收藏夹**:
```json
// POST /api/favorite-folders
{
  "name": "技术文章",
  "icon": "folder"
}

// Response 201
{
  "id": 1,
  "name": "技术文章",
  "icon": "folder",
  "sort_order": 0,
  "is_default": false,
  "article_count": 0
}
```

**添加收藏**:
```json
// POST /api/subscriptions
{
  "article_id": 123,
  "folder_id": 1
}
```

**移动文章**:
```json
// PUT /api/subscriptions/move
{
  "article_id": 123,
  "to_folder_id": 2
}
```

## [S4] 前端设计

### 文章详情页收藏按钮

**组件结构**:
```
<div class="favorite-button-group">
  <button class="favorite-main">收藏</button>
  <button class="favorite-dropdown">▼</button>
  <div class="favorite-dropdown-menu">
    <div class="folder-list">
      {folders.map(f => <FolderItem key={f.id} folder={f} />)}
    </div>
    <div class="new-folder">
      <input placeholder="新建收藏夹..." />
    </div>
  </div>
</div>
```

**交互逻辑**:
- 点击左侧按钮：收藏到默认收藏夹（或取消收藏）
- 点击右侧下拉：显示收藏夹列表
- 选择收藏夹：收藏到该收藏夹
- 已收藏状态：显示当前收藏夹名称，图标变色

### 收藏夹列表页 (/subscriptions)

**布局**:
```
┌─────────────────────────────────────────────┐
│  我的收藏                              [+ 新建] │
├───────────────┬─────────────────────────────┤
│ ★ 全部 (25)   │  [收藏夹名称]                 │
│ 📁 默认 (10)  │  ┌─────┐ ┌─────┐ ┌─────┐   │
│ 📁 技术 (8)   │  │文章1│ │文章2│ │文章3│   │
│ 📁 读书 (7)   │  └─────┘ └─────┘ └─────┘   │
│               │                             │
│               │  ┌─────┐ ┌─────┐           │
│               │  │文章4│ │文章5│           │
│               │  └─────┘ └─────┘           │
└───────────────┴─────────────────────────────┘
```

**功能**:
- 左侧边栏：收藏夹列表，显示图标和文章数量
- 点击收藏夹：右侧显示该收藏夹的文章
- 点击"全部"：显示所有收藏的文章
- 右键/长按收藏夹：弹出菜单（重命名、换图标、删除）
- 拖拽收藏夹：调整排序
- 拖拽文章到左侧：移动到其他收藏夹

### 图标选择器

预设图标以网格展示，用户点击选择：
```
┌─────────────────────────────┐
│  选择图标                    │
├─────────────────────────────┤
│  📁  ⭐  ❤️  📖  🔖  📌   │
│  🏷️  🔥  ⚡  💎  👑  💎   │
│  📂  📚  🎯  🎪           │
└─────────────────────────────┘
```

## [S5] 数据迁移

### 现有数据处理

1. **创建默认收藏夹**: 为每个已有用户创建"默认收藏夹"
2. **迁移收藏记录**: 所有现有 Subscription 记录的 FolderID 设为用户的默认收藏夹 ID
3. **迁移脚本**: 在数据库初始化时执行

```go
// 迁移逻辑伪代码
func MigrateFavoriteFolders(db *gorm.DB) {
    // 1. 自动建表
    db.AutoMigrate(&FavoriteFolder{})

    // 2. 为每个用户创建默认收藏夹
    var users []User
    db.Find(&users)
    for _, user := range users {
        db.FirstOrCreate(&FavoriteFolder{}, FavoriteFolder{
            UserID:    user.ID,
            IsDefault: true,
            Name:      "默认收藏夹",
            Icon:      "folder",
        })
    }

    // 3. 迁移旧数据
    db.Exec(`
        UPDATE subscriptions
        SET folder_id = (
            SELECT id FROM favorite_folders
            WHERE user_id = subscriptions.user_id AND is_default = true
        )
        WHERE folder_id = 0
    `)
}
```

## [S6] 用户注册流程

新用户注册时自动创建默认收藏夹：

```go
func RegisterUser(db *gorm.DB, user *User) error {
    // 创建用户
    if err := db.Create(user).Error; err != nil {
        return err
    }

    // 创建默认收藏夹
    defaultFolder := FavoriteFolder{
        UserID:    user.ID,
        Name:      "默认收藏夹",
        Icon:      "folder",
        IsDefault: true,
    }
    return db.Create(&defaultFolder).Error
}
```

## [S7] 错误处理

| 场景 | 处理方式 |
|------|----------|
| 删除默认收藏夹 | 返回 403，提示"默认收藏夹不能删除" |
| 删除非空收藏夹 | 文章自动移回默认收藏夹 |
| 收藏夹名称重复 | 允许（同名不同文件夹） |
| 收藏夹数量限制 | 每用户最多 20 个收藏夹 |
| 图标不存在 | 使用默认 folder 图标 |

## [S8] 实现优先级

### Phase 1: 核心功能
1. 后端模型和数据库迁移
2. 收藏夹 CRUD API
3. 修改收藏 API 支持 folder_id
4. 前端收藏夹列表页

### Phase 2: 增强功能
1. 收藏按钮下拉菜单
2. 图标选择器
3. 拖拽排序
4. 文章移动功能

### Phase 3: 优化
1. 动画效果
2. 移动端适配
3. 性能优化（缓存）

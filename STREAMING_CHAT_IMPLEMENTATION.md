# 视频理解流式AI对话实现

## 功能概述

为视频学习功能添加了流式AI对话，提供类似ChatGPT的实时对话体验。

## 实现内容

### 1. 后端改动

#### `backend/services/video_understanding.go`
- **新增方法**: `ChatWithVideoStream` - 支持流式响应的聊天功能
- **新增方法**: `buildChatMessages` - 构建对话消息列表
- 利用已有的 `AIAnalysisService.DiscussArticleStream` 实现流式输出
- 保存对话历史到数据库

```go
func (s *VideoUnderstandingService) ChatWithVideoStream(
	ctx context.Context,
	lesson *models.VideoLesson,
	understanding *models.VideoUnderstanding,
	messages []ChatMessage,
	userID uint,
	onDelta func(string) error,
) error
```

#### `backend/handlers/video_understanding.go`
- **修改**: `ChatWithVideo` handler 支持 `stream: true` 参数
- 使用 Server-Sent Events (SSE) 发送流式响应
- 事件类型：
  - `message`: 增量文本内容
  - `error`: 错误信息
  - `done`: 完成标记

### 2. 前端改动

#### `frontend/src/lib/api.ts`
- **新增方法**: `videoLessonAPI.chatWithVideoStream`
- 使用 `fetch` API 处理 SSE 流式响应
- 逐行解析 `event:` 和 `data:` 格式

```typescript
chatWithVideoStream: async (
  id: number,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onDelta: (delta: string) => void
) => Promise<void>
```

#### `frontend/src/components/VideoUnderstandingPanel.tsx`
- **重构**: 对话UI改为对话气泡样式
  - 用户消息：右侧，青色背景
  - AI消息：左侧，白色背景，带AI头像
- **优化**: 添加自动滚动到底部
- **优化**: 乐观更新 - 立即显示用户消息和空白AI消息
- **优化**: 流式更新AI消息内容
- **改进**: 消息容器固定高度（500px），独立滚动区域

### 3. 界面改进

#### 对话UI特性
- ✅ 聊天气泡风格对话框
- ✅ AI头像显示
- ✅ 消息自动滚动到底部
- ✅ 流式输出实时显示
- ✅ 发送中状态显示
- ✅ 输入框禁用状态

#### 布局结构
```
┌─────────────────────────────────────┐
│ AI 助手                [清空历史]   │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 对话区域 (固定高度500px, 滚动)  │ │
│ │                                 │ │
│ │  [AI]  AI消息内容...           │ │
│ │                                 │ │
│ │              用户消息  [用户]   │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ [输入框]                    [发送] │
└─────────────────────────────────────┘
```

## 使用流程

1. 用户上传视频并等待字幕生成
2. 点击"视频理解"标签页
3. 点击"生成视频理解"按钮
4. 切换到"AI 对话"标签
5. 输入问题，按回车或点击发送
6. AI回复会实时流式显示

## 技术细节

### SSE 消息格式

后端发送：
```
event: message
data: 这是一段

event: message
data: 流式输出

event: done
data: 
```

前端解析：
```typescript
const eventMatch = line.match(/event:\s*(\w+)/);
const dataMatch = dataLine.match(/data:\s*(.+)/);
```

### 对话历史管理

- 每次发送时，从现有对话历史构建上下文
- 流式响应完成后，重新加载完整对话历史（包含数据库ID）
- 清空对话历史会删除数据库记录

## 依赖关系

```
VideoUnderstandingPanel
  ├─> videoLessonAPI.chatWithVideoStream (流式)
  │     └─> POST /api/video-lessons/:id/chat { stream: true }
  │           └─> ChatWithVideo handler
  │                 └─> VideoUnderstandingService.ChatWithVideoStream
  │                       └─> AIAnalysisService.DiscussArticleStream
  │
  └─> videoLessonAPI.getConversations (历史)
        └─> GET /api/video-lessons/:id/conversations
```

## 测试建议

1. **流式响应测试**
   - 发送长问题，观察AI是否逐字输出
   - 检查网络面板中SSE事件流

2. **错误处理测试**
   - AI服务未配置时的提示
   - 网络中断时的恢复
   - 发送空消息的阻止

3. **UI交互测试**
   - 消息是否自动滚动
   - 发送按钮禁用状态
   - 清空历史功能

## 配置要求

确保 `backend/config.toml` 中配置了AI服务：

```toml
[ai]
enabled = true
base_url = "https://api.xiaomimimo.com/v1"
api_key = "your-api-key"
model = "mimo-v2.5-pro"
```

## 性能优化

- 使用乐观更新减少等待时间
- 流式输出降低首字延迟
- 自动滚动使用 `behavior: 'smooth'`
- 对话历史限制50条（可配置）

## 未来改进方向

- [ ] 支持重新生成某条回复
- [ ] 添加复制消息按钮
- [ ] 支持Markdown渲染
- [ ] 添加打字机音效（可选）
- [ ] 支持引用视频字幕片段
- [ ] 添加语音输入功能

## 相关文件

- `backend/services/video_understanding.go`
- `backend/handlers/video_understanding.go`
- `backend/services/ai_analysis.go`
- `frontend/src/components/VideoUnderstandingPanel.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/types/index.ts`

# 词书功能Bug修复说明

## 修复的问题

### 问题1：复习显示 0/0
**现象：** 背完单词后，复习任务显示 0/0，即使没有到期的复习单词也显示为 0/50。

**根本原因：** 
- `updateWordBookDailyRecord` 函数在每次提交学习结果时都会重新设置 `ReviewTotal` 为配置值 `ub.DailyReviewWords`（默认50）
- 但实际到期的复习单词数可能是0，导致显示 0/50 而不是 0/0

### 问题2：重启后端每日进度重置
**现象：** 重启后端后，当天的学习进度（如已学5/20，已复习10/30）会被重置。

**根本原因：**
- 每次调用 `updateWordBookDailyRecord` 都会重新计算并**覆盖** `NewTotal` 和 `ReviewTotal`
- 重启后端后，如果用户继续学习，会根据当前的可用任务数重新设置这些目标值，导致之前的进度基准被改变

## 修复方案

### 核心思路
**目标值应该在用户首次获取当天任务时就确定，之后不再改变。**

### 具体修改

1. **在 `GetTodayTasks` 中初始化目标值**
   ```go
   // 初始化或更新今日记录的目标值（只在首次或目标值为0时设置）
   initializeDailyRecordTargets(ub.ID, tasks.TotalNew, tasks.TotalReview)
   ```
   - 当用户获取今日任务时，立即根据**实际**的新词数和复习数设置目标值
   - 如果当天有10个新词和5个复习词，目标就设置为 10/5，而不是配置的 20/50

2. **新增 `initializeDailyRecordTargets` 函数**
   ```go
   func initializeDailyRecordTargets(userWordBookID uint, actualNewCount, actualReviewCount int)
   ```
   - 只在记录不存在或目标值为0时设置
   - 使用实际的任务数量，而不是配置值

3. **修改 `updateWordBookDailyRecord` 函数**
   ```go
   // 只在首次创建时初始化目标值，或者目标值为0时重新设置
   // 注意：实际的目标值应该在 GetTodayTasks 时就设置好，这里只是兜底逻辑
   if record.ID == 0 && record.NewTotal == 0 && record.ReviewTotal == 0 {
       // 兜底逻辑
   }
   ```
   - 移除了每次调用都重新计算的逻辑
   - 只保留兜底逻辑（防止未调用 GetTodayTasks 就直接学习的边缘情况）

## 测试场景

### 场景1：正常使用流程
1. 用户打开词书，调用 `GET /api/wordbooks/:id/today` 获取今日任务
2. 假设返回 15个新词，8个复习词
3. 系统在 `WordBookDailyRecord` 中记录 `NewTotal=15, ReviewTotal=8`
4. 用户学习过程中，`NewLearned` 和 `ReviewDone` 递增
5. 显示进度：5/15 新词，3/8 复习 ✅

### 场景2：重启后端
1. 用户已学习 5/15 新词，3/8 复习
2. 后端重启
3. 用户继续学习，提交第6个新词
4. 系统不会重新设置 `NewTotal` 和 `ReviewTotal`
5. 显示进度：6/15 新词，3/8 复习 ✅

### 场景3：没有复习词
1. 用户打开词书，今天没有到期的复习词
2. 系统返回 20个新词，0个复习词
3. 记录 `NewTotal=20, ReviewTotal=0`
4. 显示进度：5/20 新词，0/0 复习 ✅

### 场景4：动态调整（昨日完成度<60%）
1. 昨天用户只完成了 40% 的复习任务
2. 今天 `generateDailyTasks` 会动态减少新词数量（从20降到10）
3. 系统记录 `NewTotal=10`（实际生成的任务数）
4. 显示正确的进度：5/10 新词 ✅

## 文件修改

- `backend/handlers/wordbook.go`
  - 修改 `GetTodayTasks` 函数
  - 修改 `updateWordBookDailyRecord` 函数
  - 新增 `initializeDailyRecordTargets` 函数

## 验证步骤

1. 启动后端
2. 订阅一个词书
3. 获取今日任务，记录显示的目标值（如 20/10）
4. 学习几个单词（如 5个新词，3个复习）
5. 重启后端
6. 继续学习，验证进度是否保持正确（应该是 6/20，4/10）
7. 第二天，如果没有复习词，验证是否显示 0/0 而不是 0/50

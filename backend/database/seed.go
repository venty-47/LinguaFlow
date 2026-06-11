package database

import (
	"gugudu-backend/models"
	"time"
)

type seedArticle struct {
	Title           string
	TitleCN         string
	Slug            string
	Summary         string
	SummaryCN       string
	Content         string
	ContentCN       string
	CoverImage      string
	CategorySlug    string
	Tags            string
	Source          string
	SourceURL       string
	Author          string
	DifficultyLevel string
	WordCount       int
	ReadingTime     int
	IsFeatured      bool
	PublishedAt     time.Time
}

func SeedDemoData() error {
	categories := []models.Category{
		{Name: "人工智能", NameEN: "Artificial Intelligence", Slug: "artificial-intelligence", Description: "AI research, tools, ethics, and industry changes", Icon: "brain", SortOrder: 1},
		{Name: "气候与能源", NameEN: "Climate and Energy", Slug: "climate-energy", Description: "Climate technology, energy systems, and sustainability", Icon: "leaf", SortOrder: 2},
		{Name: "生物科技与健康", NameEN: "Biotechnology and Health", Slug: "biotech-health", Description: "Medicine, public health, and biotechnology", Icon: "activity", SortOrder: 3},
		{Name: "商业与经济", NameEN: "Business and Economy", Slug: "business-economy", Description: "Companies, markets, and economic policy", Icon: "briefcase", SortOrder: 4},
	}

	categoryBySlug := make(map[string]models.Category)
	for _, category := range categories {
		var saved models.Category
		if err := DB.Where("slug = ?", category.Slug).Attrs(category).FirstOrCreate(&saved).Error; err != nil {
			return err
		}
		categoryBySlug[saved.Slug] = saved
	}

	articles := []seedArticle{
		{
			Title:     "How virtual power plants could provide energy for data centers",
			TitleCN:   "虚拟电厂如何为数据中心提供能源",
			Slug:      "virtual-power-plants-data-centers",
			Summary:   "New grid software can coordinate batteries, buildings, and backup power into flexible clean-energy capacity.",
			SummaryCN: "新的电网软件可以协调电池、建筑和备用电源，形成更灵活的清洁能源容量。",
			Content: articleContent(
				"Data centers are becoming one of the fastest-growing sources of electricity demand. The rise of artificial intelligence has made that demand even harder for utilities to predict.",
				"Virtual power plants offer a practical way to respond. Instead of building one large power station, operators connect thousands of smaller energy resources: batteries, smart thermostats, rooftop solar systems, and backup generators.",
				"When demand rises, the software can reduce consumption in some buildings, discharge stored electricity, or shift loads to a better time of day. The result is not a single plant, but a coordinated network that behaves like one.",
				"For data centers, this matters because reliability is essential. A flexible network can reduce stress on the grid while still keeping servers online. The model also gives communities a cleaner alternative to fossil-fuel peaker plants.",
				"The hard part is trust. Utilities, regulators, and customers all need clear rules for compensation, performance, and privacy. Without those rules, the technology will remain promising but underused.",
			),
			ContentCN: articleContent(
				"数据中心正在成为增长最快的用电来源之一。人工智能的发展让这种需求对电力公司来说更难预测。",
				"虚拟电厂提供了一种务实的应对方式。运营方不是建设一座大型电站，而是连接成千上万个较小的能源资源：电池、智能温控器、屋顶太阳能和备用发电机。",
				"当需求上升时，软件可以降低部分建筑的用电，释放储存电力，或把负载转移到更合适的时段。结果不是一座实体电厂，而是一个像电厂一样协同工作的网络。",
			),
			CoverImage:      "https://images.unsplash.com/photo-1621905251918-48416bd8575a?auto=format&fit=crop&w=1200&q=80",
			CategorySlug:    "climate-energy",
			Tags:            "energy,grid,data centers",
			Source:          "MITTR",
			SourceURL:       "https://www.technologyreview.com/",
			Author:          "GuGuDu Editorial",
			DifficultyLevel: "medium",
			WordCount:       917,
			ReadingTime:     6,
			IsFeatured:      true,
			PublishedAt:     time.Date(2026, 6, 3, 9, 0, 0, 0, time.UTC),
		},
		{
			Title:     "How small businesses can leverage AI",
			TitleCN:   "小企业如何利用人工智能",
			Slug:      "small-businesses-leverage-ai",
			Summary:   "Practical AI tools are changing support, operations, and customer research for smaller teams.",
			SummaryCN: "实用型 AI 工具正在改变小团队的客服、运营和用户研究方式。",
			Content: articleContent(
				"Small companies rarely have the budget to build large AI teams, but they can still benefit from the current wave of tools.",
				"The most useful applications are often narrow. A shop can summarize customer messages, draft product descriptions, translate support replies, or analyze common complaints.",
				"Managers should begin with repeated work that already has clear examples. AI performs better when the team can show what a good answer looks like and review output before customers see it.",
				"The risk is over-automation. A small business often competes on trust and personal service, so AI should support staff rather than replace judgment.",
			),
			ContentCN: articleContent(
				"小公司通常没有预算组建大型 AI 团队，但仍然可以从当前这波工具中获益。",
				"最有用的应用往往很具体：总结客户消息、撰写商品描述、翻译客服回复，或分析常见投诉。",
				"管理者应从重复且已有明确样例的工作开始。团队越能说明好答案长什么样，AI 的输出就越容易被审核和改进。",
			),
			CoverImage:      "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=80",
			CategorySlug:    "artificial-intelligence",
			Tags:            "ai,business,productivity",
			Source:          "MITTR",
			SourceURL:       "https://www.technologyreview.com/",
			Author:          "GuGuDu Editorial",
			DifficultyLevel: "medium",
			WordCount:       859,
			ReadingTime:     5,
			IsFeatured:      true,
			PublishedAt:     time.Date(2026, 6, 2, 9, 0, 0, 0, time.UTC),
		},
		{
			Title:     "China has approved the world’s first invasive brain-computer chip",
			TitleCN:   "中国批准全球首个侵入性脑机接口芯片",
			Slug:      "brain-computer-chip-approved",
			Summary:   "A clinical milestone opens a new phase for neurotechnology and medical devices.",
			SummaryCN: "一个临床里程碑开启了神经技术和医疗设备的新阶段。",
			Content: articleContent(
				"Brain-computer interfaces are moving from laboratories into regulated clinical settings. That shift changes the conversation from possibility to safety, durability, and patient benefit.",
				"An invasive device can read neural signals with greater precision than external sensors, but it also requires surgery and long-term monitoring.",
				"The first approved uses are likely to focus on people with severe paralysis or communication disorders. For those patients, even a slow and imperfect interface can restore meaningful control.",
				"The technology will raise difficult questions about data ownership, medical access, and the line between treatment and enhancement.",
			),
			ContentCN: articleContent(
				"脑机接口正从实验室进入受监管的临床环境。这种转变让讨论从可能性转向安全性、耐久性和患者获益。",
				"侵入式设备能比外部传感器更精确地读取神经信号，但也需要手术和长期监测。",
			),
			CoverImage:      "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?auto=format&fit=crop&w=1200&q=80",
			CategorySlug:    "biotech-health",
			Tags:            "biotech,health,brain computer interface",
			Source:          "MITTR",
			SourceURL:       "https://www.technologyreview.com/",
			Author:          "GuGuDu Editorial",
			DifficultyLevel: "hard",
			WordCount:       1384,
			ReadingTime:     8,
			IsFeatured:      true,
			PublishedAt:     time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC),
		},
		{
			Title:     "The deadly Ebola outbreak is proving difficult to control",
			TitleCN:   "致命的埃博拉疫情难以控制",
			Slug:      "ebola-outbreak-control",
			Summary:   "Public health teams face a familiar set of barriers in tracing, treatment, and trust.",
			SummaryCN: "公共卫生团队在追踪、治疗和信任方面面临熟悉的阻碍。",
			Content: articleContent(
				"Outbreak response depends on speed, but speed depends on trust. When communities fear hospitals or outside officials, even effective tools can arrive too late.",
				"Health workers must identify contacts, isolate cases, and explain risks without creating panic. Each step requires local cooperation.",
				"Vaccines and treatments have improved the outlook, yet logistics remain difficult in regions with limited transport, security problems, or weak health systems.",
			),
			ContentCN: articleContent(
				"疫情响应依赖速度，但速度又依赖信任。当社区害怕医院或外来官员时，即使有效工具也可能来得太晚。",
				"卫生工作者必须识别接触者、隔离病例，并在不制造恐慌的情况下解释风险。",
			),
			CoverImage:      "https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?auto=format&fit=crop&w=1200&q=80",
			CategorySlug:    "biotech-health",
			Tags:            "public health,medicine",
			Source:          "MITTR",
			Author:          "GuGuDu Editorial",
			DifficultyLevel: "hard",
			WordCount:       1022,
			ReadingTime:     6,
			IsFeatured:      true,
			PublishedAt:     time.Date(2026, 5, 29, 9, 0, 0, 0, time.UTC),
		},
		{
			Title:     "A reality check on the AI jobs hysteria",
			TitleCN:   "对 AI 就业恐慌的现实审视",
			Slug:      "ai-jobs-hysteria-reality-check",
			Summary:   "The data suggests disruption is real, but the labor story is more complicated than headlines imply.",
			SummaryCN: "数据显示冲击是真实的，但就业故事比标题暗示的更复杂。",
			Content: articleContent(
				"Predictions about AI and jobs often swing between extremes. Some forecasts imagine mass unemployment, while others assume productivity will solve everything.",
				"The early evidence is more mixed. AI changes tasks before it eliminates roles. Workers who write, analyze, summarize, or support customers are seeing parts of their jobs reorganized.",
				"That does not mean every role disappears. It does mean entry-level workers need new training paths, and managers need a clearer view of which tasks should remain human.",
				"The most useful question is not whether AI will take all jobs. It is which skills become more valuable when routine digital work becomes cheaper.",
			),
			ContentCN: articleContent(
				"关于 AI 和就业的预测常常在两个极端之间摇摆。有些预测认为会出现大规模失业，另一些则认为生产率会解决一切。",
				"早期证据更加复杂。AI 往往先改变任务，再改变岗位。",
			),
			CoverImage:      "https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1200&q=80",
			CategorySlug:    "artificial-intelligence",
			Tags:            "ai,labor,economy",
			Source:          "MITTR",
			Author:          "GuGuDu Editorial",
			DifficultyLevel: "hard",
			WordCount:       3153,
			ReadingTime:     14,
			IsFeatured:      false,
			PublishedAt:     time.Date(2026, 5, 26, 9, 0, 0, 0, time.UTC),
		},
	}

	for _, item := range articles {
		category := categoryBySlug[item.CategorySlug]
		article := models.Article{
			Title: item.Title, TitleCN: item.TitleCN, Slug: item.Slug,
			Summary: item.Summary, SummaryCN: item.SummaryCN,
			Content: item.Content, ContentCN: item.ContentCN,
			CoverImage: item.CoverImage, CategoryID: category.ID,
			Tags: item.Tags, Source: item.Source, SourceURL: item.SourceURL,
			Author: item.Author, PublishedAt: item.PublishedAt,
			DifficultyLevel: item.DifficultyLevel, WordCount: item.WordCount,
			ReadingTime: item.ReadingTime, Status: "published", IsFeatured: item.IsFeatured,
		}

		var saved models.Article
		if err := DB.Where("slug = ?", item.Slug).Attrs(article).FirstOrCreate(&saved).Error; err != nil {
			return err
		}
	}

	if err := migrateDefaultFolders(); err != nil {
		return err
	}

	return nil
}

func migrateDefaultFolders() error {
	var users []models.User
	if err := DB.Find(&users).Error; err != nil {
		return err
	}

	for _, user := range users {
		var folder models.FavoriteFolder
		err := DB.Where("user_id = ? AND is_default = ?", user.ID, true).First(&folder).Error
		if err != nil {
			folder = models.FavoriteFolder{
				UserID:    user.ID,
				Name:      "默认收藏夹",
				Icon:      "folder",
				SortOrder: 0,
				IsDefault: true,
			}
			if err := DB.Create(&folder).Error; err != nil {
				return err
			}
		}

		DB.Model(&models.Subscription{}).
			Where("user_id = ? AND (folder_id = 0 OR folder_id IS NULL)", user.ID).
			Update("folder_id", folder.ID)
	}

	return nil
}

func articleContent(paragraphs ...string) string {
	content := ""
	for i, paragraph := range paragraphs {
		if i > 0 {
			content += "\n\n"
		}
		content += paragraph
	}
	return content
}

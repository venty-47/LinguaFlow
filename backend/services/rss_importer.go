package services

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"gugudu-backend/config"
	"gugudu-backend/models"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"
	"gorm.io/gorm"
)

const (
	defaultRSSUserAgent = "GuGuDu RSS Importer/1.0"
	defaultRSSTimeout   = 15 * time.Second
	defaultRSSMaxItems  = 10
	defaultRSSFeedJobs  = 4
	defaultRSSItemJobs  = 4
	rssCoverImageDir    = "storage/rss-covers"
	rssCoverImageURL    = "/storage/rss-covers"
	maxRSSCoverImage    = 8 * 1024 * 1024
)

type RSSImporter struct {
	db         *gorm.DB
	cfg        config.RSSConfig
	client     *http.Client
	categoryMu sync.Mutex
}

type RSSImportReport struct {
	Feeds      []RSSFeedImportReport `json:"feeds"`
	Created    int                   `json:"created"`
	Updated    int                   `json:"updated"`
	Skipped    int                   `json:"skipped"`
	Errors     []string              `json:"errors,omitempty"`
	ImportedAt time.Time             `json:"imported_at"`
}

type RSSFeedImportReport struct {
	Name    string   `json:"name"`
	URL     string   `json:"url"`
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Skipped int      `json:"skipped"`
	Errors  []string `json:"errors,omitempty"`
}

type feedArticle struct {
	Title       string
	Summary     string
	Content     string
	SourceURL   string
	Author      string
	PublishedAt time.Time
	CoverImage  string
}

type parsedFeed struct {
	Title string
	Items []feedItem
}

type feedItem struct {
	Title          string
	Link           string
	GUID           string
	Description    string
	ContentEncoded string
	PubDate        string
	Updated        string
	Author         string
	Creator        string
	Categories     []string
}

type rssDocument struct {
	Channel struct {
		Title string        `xml:"title"`
		Items []rssFeedItem `xml:"item"`
	} `xml:"channel"`
}

type rssFeedItem struct {
	Title          string   `xml:"title"`
	Link           string   `xml:"link"`
	GUID           string   `xml:"guid"`
	Description    string   `xml:"description"`
	ContentEncoded string   `xml:"http://purl.org/rss/1.0/modules/content/ encoded"`
	PubDate        string   `xml:"pubDate"`
	Date           string   `xml:"http://purl.org/dc/elements/1.1/ date"`
	Author         string   `xml:"author"`
	Creator        string   `xml:"http://purl.org/dc/elements/1.1/ creator"`
	Categories     []string `xml:"category"`
}

type atomDocument struct {
	Title   string         `xml:"title"`
	Entries []atomFeedItem `xml:"entry"`
}

type atomFeedItem struct {
	Title     string     `xml:"title"`
	ID        string     `xml:"id"`
	Links     []atomLink `xml:"link"`
	Summary   string     `xml:"summary"`
	Content   string     `xml:"content"`
	Published string     `xml:"published"`
	Updated   string     `xml:"updated"`
	Author    atomAuthor `xml:"author"`
	Category  []atomCat  `xml:"category"`
}

type atomLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr"`
}

type atomAuthor struct {
	Name string `xml:"name"`
}

type atomCat struct {
	Term string `xml:"term,attr"`
}

type extractedArticleHTML struct {
	Content      string
	Description  string
	CoverImage   string
	CanonicalURL string
	PublishedAt  *time.Time
}

type nextDataDocument struct {
	Props struct {
		PageProps struct {
			DetailData struct {
				Data struct {
					Content     string `json:"content"`
					Summary     string `json:"summary"`
					HeadPic     string `json:"headPic"`
					PublishTime string `json:"publishTime"`
				} `json:"data"`
			} `json:"detailData"`
		} `json:"pageProps"`
	} `json:"props"`
}

func NewRSSImporter(db *gorm.DB, cfg config.RSSConfig) *RSSImporter {
	timeout := defaultRSSTimeout
	if cfg.RequestTimeoutSeconds > 0 {
		timeout = time.Duration(cfg.RequestTimeoutSeconds) * time.Second
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxy := strings.TrimSpace(cfg.Proxy); proxy != "" {
		proxyURL, err := url.Parse(proxy)
		if err != nil || proxyURL.Scheme == "" || proxyURL.Host == "" {
			transport.Proxy = func(*http.Request) (*url.URL, error) {
				return nil, fmt.Errorf("invalid RSS proxy %q", proxy)
			}
		} else {
			transport.Proxy = http.ProxyURL(proxyURL)
		}
	}

	return &RSSImporter{
		db:  db,
		cfg: cfg,
		client: &http.Client{
			Timeout:   timeout,
			Transport: transport,
		},
	}
}

func (i *RSSImporter) ImportAll(ctx context.Context) RSSImportReport {
	report := RSSImportReport{ImportedAt: time.Now()}

	if !i.cfg.Enabled {
		report.Errors = append(report.Errors, "RSS import is disabled")
		return report
	}

	feedReports := make([]RSSFeedImportReport, len(i.cfg.Feeds))
	results := make(chan struct {
		index  int
		report RSSFeedImportReport
	}, len(i.cfg.Feeds))
	sem := make(chan struct{}, defaultRSSFeedJobs)

	var wg sync.WaitGroup
	for index, feed := range i.cfg.Feeds {
		wg.Add(1)
		go func(index int, feed config.RSSFeedConfig) {
			defer wg.Done()

			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				results <- struct {
					index  int
					report RSSFeedImportReport
				}{
					index: index,
					report: RSSFeedImportReport{
						Name:   feed.Name,
						URL:    feed.URL,
						Errors: []string{ctx.Err().Error()},
					},
				}
				return
			}

			results <- struct {
				index  int
				report RSSFeedImportReport
			}{
				index:  index,
				report: i.ImportFeed(ctx, feed),
			}
		}(index, feed)
	}

	wg.Wait()
	close(results)

	for result := range results {
		feedReports[result.index] = result.report
	}

	for _, feedReport := range feedReports {
		report.Feeds = append(report.Feeds, feedReport)
		report.Created += feedReport.Created
		report.Updated += feedReport.Updated
		report.Skipped += feedReport.Skipped
		report.Errors = append(report.Errors, feedReport.Errors...)
	}

	return report
}

func (i *RSSImporter) ImportFeed(ctx context.Context, feed config.RSSFeedConfig) RSSFeedImportReport {
	report := RSSFeedImportReport{Name: feed.Name, URL: feed.URL}
	if !feed.Enabled {
		report.Skipped++
		return report
	}
	if strings.TrimSpace(feed.URL) == "" {
		report.Errors = append(report.Errors, "feed URL is empty")
		return report
	}

	body, err := i.fetch(ctx, feed.URL)
	if err != nil {
		report.Errors = append(report.Errors, err.Error())
		return report
	}

	parsed, err := parseFeed(body)
	if err != nil {
		report.Errors = append(report.Errors, err.Error())
		return report
	}

	limit := importLimitForFeed(i.cfg, feed)
	items := parsed.Items
	if len(items) > limit {
		items = items[:limit]
	}

	articles := i.buildFeedArticles(ctx, feed, items)
	for _, result := range articles {
		if result.err != nil {
			report.Errors = append(report.Errors, fmt.Sprintf("%s: %v", result.item.Title, result.err))
			continue
		}

		article := result.article
		if strings.TrimSpace(article.Title) == "" || strings.TrimSpace(article.SourceURL) == "" || strings.TrimSpace(article.Content) == "" {
			report.Skipped++
			continue
		}

		created, updated, err := i.saveArticle(feed, article)
		if err != nil {
			report.Errors = append(report.Errors, fmt.Sprintf("%s: %v", article.Title, err))
			continue
		}
		if created {
			report.Created++
		} else if updated {
			report.Updated++
		} else {
			report.Skipped++
		}
	}

	return report
}

func importLimitForFeed(cfg config.RSSConfig, feed config.RSSFeedConfig) int {
	if feed.MaxItems > 0 {
		return feed.MaxItems
	}
	if cfg.MaxItemsPerFeed > 0 {
		return cfg.MaxItemsPerFeed
	}
	return defaultRSSMaxItems
}

type feedArticleResult struct {
	index   int
	item    feedItem
	article feedArticle
	err     error
}

func (i *RSSImporter) buildFeedArticles(ctx context.Context, feed config.RSSFeedConfig, items []feedItem) []feedArticleResult {
	results := make([]feedArticleResult, len(items))
	resultCh := make(chan feedArticleResult, len(items))
	sem := make(chan struct{}, defaultRSSItemJobs)

	var wg sync.WaitGroup
	for index, item := range items {
		wg.Add(1)
		go func(index int, item feedItem) {
			defer wg.Done()

			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				resultCh <- feedArticleResult{index: index, item: item, err: ctx.Err()}
				return
			}

			article, err := i.buildArticle(ctx, feed, item)
			resultCh <- feedArticleResult{
				index:   index,
				item:    item,
				article: article,
				err:     err,
			}
		}(index, item)
	}

	wg.Wait()
	close(resultCh)

	for result := range resultCh {
		results[result.index] = result
	}
	return results
}

func (i *RSSImporter) buildArticle(ctx context.Context, feed config.RSSFeedConfig, item feedItem) (feedArticle, error) {
	sourceURL := firstNonEmpty(item.Link, item.GUID)
	if sourceURL == "" {
		return feedArticle{}, errors.New("missing source URL")
	}

	summary := cleanText(stripHTML(item.Description))
	content := stripHTML(firstNonEmpty(item.ContentEncoded, item.Description))
	publishedAt := parseFeedTime(firstNonEmpty(item.PubDate, item.Updated), time.Now())
	article := feedArticle{
		Title:       cleanText(stripHTML(item.Title)),
		Summary:     summary,
		Content:     content,
		SourceURL:   sourceURL,
		Author:      cleanText(firstNonEmpty(item.Creator, item.Author)),
		PublishedAt: publishedAt,
	}

	if htmlBody, err := i.fetch(ctx, sourceURL); err == nil {
		extracted := extractArticleHTML(htmlBody)
		if extracted.Content != "" {
			article.Content = extracted.Content
		}
		if article.Summary == "" {
			article.Summary = extracted.Description
		}
		if extracted.CoverImage != "" {
			article.CoverImage = absoluteURL(sourceURL, extracted.CoverImage)
		}
		if extracted.CanonicalURL != "" {
			article.SourceURL = absoluteURL(sourceURL, extracted.CanonicalURL)
		}
		if extracted.PublishedAt != nil {
			article.PublishedAt = *extracted.PublishedAt
		}
	}

	if article.Author == "" {
		article.Author = feed.Source
	}
	if article.Content == "" {
		article.Content = article.Summary
	}
	if article.CoverImage != "" {
		if localCover := i.downloadCoverImage(ctx, article.CoverImage); localCover != "" {
			article.CoverImage = localCover
		} else {
			article.CoverImage = ""
		}
	}

	return article, nil
}

func (i *RSSImporter) saveArticle(feed config.RSSFeedConfig, item feedArticle) (bool, bool, error) {
	category, err := i.ensureRSSCategory(feed)
	if err != nil {
		return false, false, err
	}

	analysis := AnalyzeArticleText(item.Title, item.Summary, item.Content)
	source := firstNonEmpty(feed.Source, feed.Name)
	slug := makeArticleSlug(item.Title, item.SourceURL)

	article := models.Article{
		Title:           item.Title,
		Slug:            slug,
		Summary:         item.Summary,
		Content:         item.Content,
		CoverImage:      item.CoverImage,
		CategoryID:      category.ID,
		Tags:            cleanTags(feed.Tags),
		Source:          source,
		SourceURL:       item.SourceURL,
		Author:          item.Author,
		PublishedAt:     item.PublishedAt,
		DifficultyLevel: analysis.DifficultyLevel,
		WordCount:       analysis.WordCount,
		ReadingTime:     analysis.ReadingTime,
		Keywords:        KeywordsToString(analysis.Keywords),
		CEFRLevel:       analysis.CEFRLevel,
		Status:          "published",
	}

	var existing models.Article
	err = i.db.Where("source_url = ? OR slug = ? OR (source = ? AND title = ?)", item.SourceURL, slug, source, item.Title).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return true, false, i.db.Create(&article).Error
	}
	if err != nil {
		return false, false, err
	}

	updates := map[string]interface{}{
		"title":            article.Title,
		"source_url":       article.SourceURL,
		"summary":          article.Summary,
		"content":          article.Content,
		"category_id":      article.CategoryID,
		"tags":             article.Tags,
		"source":           article.Source,
		"author":           article.Author,
		"published_at":     article.PublishedAt,
		"difficulty_level": article.DifficultyLevel,
		"word_count":       article.WordCount,
		"reading_time":     article.ReadingTime,
		"keywords":         article.Keywords,
		"cefr_level":       article.CEFRLevel,
		"status":           article.Status,
	}
	if shouldUpdateRSSCoverImage(article.CoverImage, existing.CoverImage) {
		updates["cover_image"] = article.CoverImage
	}

	return false, true, i.db.Model(&existing).Updates(updates).Error
}

func (i *RSSImporter) fetch(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	userAgent := firstNonEmpty(i.cfg.UserAgent, defaultRSSUserAgent)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html")

	resp, err := i.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("GET %s returned %d", rawURL, resp.StatusCode)
	}

	return io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
}

func (i *RSSImporter) downloadCoverImage(ctx context.Context, rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	if !parsed.IsAbs() {
		return rawURL
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", firstNonEmpty(i.cfg.UserAgent, defaultRSSUserAgent))
	req.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5")

	resp, err := i.client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ""
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRSSCoverImage+1))
	if err != nil || len(body) == 0 || len(body) > maxRSSCoverImage {
		return ""
	}

	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if idx := strings.Index(contentType, ";"); idx >= 0 {
		contentType = contentType[:idx]
	}
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(body)
	}

	ext := extensionForImage(contentType, parsed.Path)
	if ext == "" {
		return ""
	}

	if err := os.MkdirAll(rssCoverImageDir, 0755); err != nil {
		return ""
	}

	sum := sha1.Sum([]byte(rawURL))
	filename := hex.EncodeToString(sum[:]) + ext
	path := filepath.Join(rssCoverImageDir, filename)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(path, body, 0644); err != nil {
			return ""
		}
	} else if err != nil {
		return ""
	}

	return rssCoverImageURL + "/" + filename
}

func extensionForImage(contentType, sourcePath string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	}

	if contentType != "" && contentType != "application/octet-stream" {
		return ""
	}

	switch strings.ToLower(filepath.Ext(sourcePath)) {
	case ".jpg", ".jpeg":
		return ".jpg"
	case ".png", ".webp", ".gif":
		return strings.ToLower(filepath.Ext(sourcePath))
	default:
		return ""
	}
}

func shouldUpdateRSSCoverImage(nextCover, existingCover string) bool {
	return nextCover != "" || isRemoteHTTPURL(existingCover)
}

func isRemoteHTTPURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	return parsed.IsAbs() && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func parseFeed(data []byte) (parsedFeed, error) {
	var rss rssDocument
	if err := xml.Unmarshal(data, &rss); err == nil && len(rss.Channel.Items) > 0 {
		items := make([]feedItem, 0, len(rss.Channel.Items))
		for _, item := range rss.Channel.Items {
			items = append(items, feedItem{
				Title:          item.Title,
				Link:           item.Link,
				GUID:           item.GUID,
				Description:    item.Description,
				ContentEncoded: item.ContentEncoded,
				PubDate:        item.PubDate,
				Updated:        item.Date,
				Author:         item.Author,
				Creator:        item.Creator,
				Categories:     item.Categories,
			})
		}
		return parsedFeed{Title: rss.Channel.Title, Items: items}, nil
	}

	var atom atomDocument
	if err := xml.Unmarshal(data, &atom); err == nil && len(atom.Entries) > 0 {
		items := make([]feedItem, 0, len(atom.Entries))
		for _, entry := range atom.Entries {
			categories := make([]string, 0, len(entry.Category))
			for _, category := range entry.Category {
				categories = append(categories, category.Term)
			}
			items = append(items, feedItem{
				Title:          entry.Title,
				Link:           atomEntryLink(entry),
				GUID:           entry.ID,
				Description:    entry.Summary,
				ContentEncoded: entry.Content,
				PubDate:        entry.Published,
				Updated:        entry.Updated,
				Author:         entry.Author.Name,
				Categories:     categories,
			})
		}
		return parsedFeed{Title: atom.Title, Items: items}, nil
	}

	return parsedFeed{}, errors.New("unsupported or empty RSS/Atom feed")
}

func atomEntryLink(entry atomFeedItem) string {
	for _, link := range entry.Links {
		if link.Rel == "" || link.Rel == "alternate" {
			return link.Href
		}
	}
	if len(entry.Links) > 0 {
		return entry.Links[0].Href
	}
	return ""
}

func (i *RSSImporter) ensureRSSCategory(feed config.RSSFeedConfig) (models.Category, error) {
	i.categoryMu.Lock()
	defer i.categoryMu.Unlock()

	slug := firstNonEmpty(feed.CategorySlug, "world-news")
	category := models.Category{
		Name:        firstNonEmpty(feed.CategoryName, feed.Name, "外刊精选"),
		NameEN:      firstNonEmpty(feed.CategoryEN, feed.Name, "World News"),
		Slug:        slug,
		Description: "Imported RSS articles for English reading practice",
		Icon:        "newspaper",
		SortOrder:   50,
	}

	var saved models.Category
	err := i.db.Where("slug = ?", slug).Attrs(category).FirstOrCreate(&saved).Error
	return saved, err
}

func extractArticleHTML(data []byte) extractedArticleHTML {
	doc, err := html.Parse(strings.NewReader(string(data)))
	if err != nil {
		return extractedArticleHTML{}
	}

	extracted := extractedArticleHTML{}
	meta := extractMeta(doc)
	extracted.CoverImage = firstNonEmpty(meta["og:image"], meta["twitter:image"])
	extracted.Description = cleanText(firstNonEmpty(meta["og:description"], meta["description"], meta["twitter:description"]))
	extracted.CanonicalURL = firstNonEmpty(meta["og:url"], findCanonicalURL(doc))
	if published := parseFeedTime(firstNonEmpty(meta["article:published_time"], meta["pubdate"]), time.Time{}); !published.IsZero() {
		extracted.PublishedAt = &published
	}

	if nextData := extractNextDataArticle(doc); nextData.Content != "" {
		extracted.Content = nextData.Content
		if extracted.Description == "" {
			extracted.Description = nextData.Description
		}
		if nextData.CoverImage != "" {
			extracted.CoverImage = nextData.CoverImage
		}
		if nextData.PublishedAt != nil {
			extracted.PublishedAt = nextData.PublishedAt
		}
		return extracted
	}

	candidates := findContentCandidates(doc)
	best := ""
	for _, candidate := range candidates {
		text := extractStructuredText(candidate)
		if countWords(text) > countWords(best) {
			best = text
		}
	}
	extracted.Content = best

	return extracted
}

func extractNextDataArticle(n *html.Node) extractedArticleHTML {
	raw := findScriptTextByID(n, "__NEXT_DATA__")
	if raw == "" {
		return extractedArticleHTML{}
	}

	var nextData nextDataDocument
	if err := json.Unmarshal([]byte(raw), &nextData); err != nil {
		return extractedArticleHTML{}
	}

	data := nextData.Props.PageProps.DetailData.Data
	extracted := extractedArticleHTML{
		Content:     stripHTML(data.Content),
		Description: cleanText(data.Summary),
		CoverImage:  data.HeadPic,
	}
	if published := parseFeedTime(data.PublishTime, time.Time{}); !published.IsZero() {
		extracted.PublishedAt = &published
	}
	return extracted
}

func findCanonicalURL(n *html.Node) string {
	if n.Type == html.ElementNode && n.Data == "link" {
		rel := ""
		href := ""
		for _, attr := range n.Attr {
			switch strings.ToLower(attr.Key) {
			case "rel":
				rel = strings.ToLower(attr.Val)
			case "href":
				href = attr.Val
			}
		}
		if rel == "canonical" && strings.TrimSpace(href) != "" {
			return href
		}
	}
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		if href := findCanonicalURL(child); href != "" {
			return href
		}
	}
	return ""
}

func findScriptTextByID(n *html.Node, id string) string {
	if n.Type == html.ElementNode && n.Data == "script" {
		for _, attr := range n.Attr {
			if attr.Key == "id" && attr.Val == id {
				if n.FirstChild != nil {
					return n.FirstChild.Data
				}
				return ""
			}
		}
	}
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		if text := findScriptTextByID(child, id); text != "" {
			return text
		}
	}
	return ""
}

func extractMeta(n *html.Node) map[string]string {
	values := map[string]string{}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode && node.Data == "meta" {
			key := ""
			value := ""
			for _, attr := range node.Attr {
				switch strings.ToLower(attr.Key) {
				case "property", "name":
					key = strings.ToLower(attr.Val)
				case "content":
					value = attr.Val
				}
			}
			if key != "" && value != "" {
				values[key] = value
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return values
}

func findContentCandidates(n *html.Node) []*html.Node {
	var candidates []*html.Node
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			if node.Data == "article" || hasContentClass(node) {
				candidates = append(candidates, node)
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return candidates
}

func hasContentClass(n *html.Node) bool {
	for _, attr := range n.Attr {
		if attr.Key != "class" && attr.Key != "id" {
			continue
		}
		value := strings.ToLower(attr.Val)
		for _, token := range []string{"article-content", "article__content", "article-body", "entry-content", "main-content", "body-content", "wsw"} {
			if strings.Contains(value, token) {
				return true
			}
		}
	}
	return false
}

func extractStructuredText(n *html.Node) string {
	parts := []string{}

	var walk func(*html.Node, bool)
	walk = func(node *html.Node, inBlock bool) {
		if node.Type == html.ElementNode {
			if shouldSkipHTMLNode(node.Data) {
				return
			}
			inBlock = inBlock || isTextBlock(node.Data)
		}

		if node.Type == html.TextNode && inBlock {
			text := cleanText(node.Data)
			if text != "" {
				parts = append(parts, text)
			}
		}

		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child, inBlock)
		}

		if node.Type == html.ElementNode && isTextBlock(node.Data) {
			parts = append(parts, "\n\n")
		}
	}
	walk(n, false)

	text := strings.Join(parts, " ")
	text = regexp.MustCompile(`\s*\n\s*\n\s*`).ReplaceAllString(text, "\n\n")
	return cleanArticleText(text)
}

func stripHTML(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}

	doc, err := html.Parse(strings.NewReader(raw))
	if err != nil {
		return cleanText(raw)
	}
	if text := extractStructuredText(doc); text != "" {
		return text
	}
	return cleanText(extractAllText(doc))
}

func shouldSkipHTMLNode(tag string) bool {
	switch tag {
	case "script", "style", "noscript", "nav", "aside", "footer", "header", "form", "button":
		return true
	default:
		return false
	}
}

func isTextBlock(tag string) bool {
	switch tag {
	case "p", "div", "section", "article", "li", "blockquote", "h1", "h2", "h3", "h4":
		return true
	default:
		return false
	}
}

func extractAllText(n *html.Node) string {
	parts := []string{}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode && shouldSkipHTMLNode(node.Data) {
			return
		}
		if node.Type == html.TextNode {
			text := cleanText(node.Data)
			if text != "" {
				parts = append(parts, text)
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return strings.Join(parts, " ")
}

func cleanArticleText(text string) string {
	lines := strings.Split(text, "\n")
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		line = cleanText(line)
		if line != "" {
			cleaned = append(cleaned, line)
		}
	}
	return strings.Join(cleaned, "\n\n")
}

func cleanText(text string) string {
	text = html.UnescapeString(text)
	text = strings.ReplaceAll(text, "\u00a0", " ")
	text = regexp.MustCompile(`[ \t\r\n]+`).ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

func cleanTags(tags string) string {
	parts := strings.Split(tags, ",")
	cleaned := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = cleanText(part)
		key := strings.ToLower(part)
		if part != "" && !seen[key] {
			cleaned = append(cleaned, part)
			seen[key] = true
		}
	}
	return strings.Join(cleaned, ",")
}

func parseFeedTime(raw string, fallback time.Time) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}

	layouts := []string{
		time.RFC3339,
		time.RFC3339Nano,
		time.RFC1123Z,
		time.RFC1123,
		time.RFC822Z,
		time.RFC822,
		"Mon, 02 Jan 2006 15:04:05 -0700",
		"Mon, 02 Jan 2006 15:04:05 MST",
		"Mon Jan 02 15:04:05 MST 2006",
		"Jan 02, 2006",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}

	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed
		}
	}

	return fallback
}

func countWords(text string) int {
	return len(regexp.MustCompile(`[A-Za-z]+(?:['-][A-Za-z]+)?`).FindAllString(text, -1))
}

func makeArticleSlug(title, sourceURL string) string {
	base := strings.ToLower(title)
	base = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "rss-article"
	}
	if len(base) > 150 {
		base = strings.Trim(base[:150], "-")
	}

	hashSource := firstNonEmpty(sourceURL, title)
	sum := sha1.Sum([]byte(hashSource))
	return base + "-" + hex.EncodeToString(sum[:])[:8]
}

func absoluteURL(baseURL, maybeRelative string) string {
	if strings.TrimSpace(maybeRelative) == "" {
		return ""
	}
	parsed, err := url.Parse(maybeRelative)
	if err != nil || parsed.IsAbs() {
		return maybeRelative
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return maybeRelative
	}
	return base.ResolveReference(parsed).String()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

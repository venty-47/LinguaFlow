package services

import (
	"context"
	"gugudu-backend/config"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestNewRSSImporterUsesConfiguredProxy(t *testing.T) {
	importer := NewRSSImporter(nil, config.RSSConfig{
		Proxy: "http://127.0.0.1:7897",
	})

	transport, ok := importer.client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected http.Transport, got %T", importer.client.Transport)
	}
	proxyURL, err := transport.Proxy(&http.Request{})
	if err != nil {
		t.Fatalf("proxy returned error: %v", err)
	}
	if proxyURL == nil || proxyURL.String() != "http://127.0.0.1:7897" {
		t.Fatalf("unexpected proxy URL: %v", proxyURL)
	}
}

func TestParseRSSFeed(t *testing.T) {
	data := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>VOA Learning English</title>
    <item>
      <title>Scientists Test a New Tool</title>
      <link>https://learningenglish.voanews.com/a/scientists-test-tool/123.html</link>
      <description><![CDATA[<p>A short summary for learners.</p>]]></description>
      <content:encoded><![CDATA[<p>Scientists are testing a new tool for students.</p><p>The tool helps learners read more carefully.</p>]]></content:encoded>
      <pubDate>Fri, 05 Jun 2026 10:30:00 +0000</pubDate>
      <dc:creator>VOA Learning English</dc:creator>
    </item>
  </channel>
</rss>`)

	feed, err := parseFeed(data)
	if err != nil {
		t.Fatalf("parseFeed returned error: %v", err)
	}
	if feed.Title != "VOA Learning English" {
		t.Fatalf("expected feed title, got %q", feed.Title)
	}
	if len(feed.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(feed.Items))
	}

	item := feed.Items[0]
	if item.Title != "Scientists Test a New Tool" {
		t.Fatalf("unexpected item title: %q", item.Title)
	}
	if stripHTML(item.Title) != "Scientists Test a New Tool" {
		t.Fatalf("plain title was not preserved: %q", stripHTML(item.Title))
	}
	if item.ContentEncoded == "" {
		t.Fatal("expected content:encoded to be parsed")
	}
	if item.Creator != "VOA Learning English" {
		t.Fatalf("expected dc:creator, got %q", item.Creator)
	}

	published := parseFeedTime(item.PubDate, time.Time{})
	if published.IsZero() || published.Year() != 2026 {
		t.Fatalf("unexpected published time: %v", published)
	}
}

func TestExtractArticleHTML(t *testing.T) {
	data := []byte(`<!doctype html>
<html>
  <head>
    <meta property="og:image" content="/images/story.jpg">
    <meta name="description" content="A description for search.">
    <meta property="article:published_time" content="2026-06-05T10:30:00Z">
    <link rel="canonical" href="https://example.com/articles/story">
  </head>
  <body>
    <nav>Navigation should not be included.</nav>
    <article class="article-content">
      <h1>Headline</h1>
      <p>Scientists are testing a new tool for students.</p>
      <p>The tool helps learners read more carefully.</p>
    </article>
  </body>
</html>`)

	extracted := extractArticleHTML(data)
	if extracted.CoverImage != "/images/story.jpg" {
		t.Fatalf("unexpected cover image: %q", extracted.CoverImage)
	}
	if extracted.Description != "A description for search." {
		t.Fatalf("unexpected description: %q", extracted.Description)
	}
	if extracted.PublishedAt == nil || extracted.PublishedAt.Year() != 2026 {
		t.Fatalf("unexpected published time: %v", extracted.PublishedAt)
	}
	if extracted.CanonicalURL != "https://example.com/articles/story" {
		t.Fatalf("unexpected canonical URL: %q", extracted.CanonicalURL)
	}
	if countWords(extracted.Content) < 10 {
		t.Fatalf("expected article body text, got %q", extracted.Content)
	}
	if extracted.Content == "" || extracted.Content == "Navigation should not be included." {
		t.Fatalf("unexpected article content: %q", extracted.Content)
	}
}

func TestExtractArticleHTMLUsesNextData(t *testing.T) {
	data := []byte(`<!doctype html>
<html>
  <head>
    <meta property="og:image" content="https://example.com/fallback.jpg">
    <meta name="description" content="Fallback summary.">
  </head>
  <body>
    <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"detailData":{"data":{"content":"<p>First paragraph for learners.</p><p>Second paragraph with enough words to count.</p>","summary":"A Sixth Tone summary.","headPic":"https://example.com/head.jpg","publishTime":"Fri Jun 05 02:09:46 PDT 2026"}}}}}</script>
  </body>
</html>`)

	extracted := extractArticleHTML(data)
	if extracted.CoverImage != "https://example.com/head.jpg" {
		t.Fatalf("unexpected cover image: %q", extracted.CoverImage)
	}
	if extracted.Description != "Fallback summary." {
		t.Fatalf("unexpected description: %q", extracted.Description)
	}
	if extracted.PublishedAt == nil || extracted.PublishedAt.Year() != 2026 || extracted.PublishedAt.Month() != time.June {
		t.Fatalf("unexpected published time: %v", extracted.PublishedAt)
	}
	if countWords(extracted.Content) < 10 {
		t.Fatalf("expected next data content, got %q", extracted.Content)
	}
}

func TestDownloadCoverImageStoresLocalFile(t *testing.T) {
	t.Cleanup(func() {
		_ = os.RemoveAll(rssCoverImageDir)
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cover.jpg" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = io.WriteString(w, "fake jpeg bytes")
	}))
	defer server.Close()

	importer := NewRSSImporter(nil, config.RSSConfig{})
	path := importer.downloadCoverImage(context.Background(), server.URL+"/cover.jpg")
	if !strings.HasPrefix(path, rssCoverImageURL+"/") || !strings.HasSuffix(path, ".jpg") {
		t.Fatalf("expected local cover path, got %q", path)
	}

	info, err := os.Stat(strings.TrimPrefix(path, "/"))
	if err != nil {
		t.Fatalf("expected stored cover file: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("expected non-empty cover file")
	}
}

func TestDownloadCoverImageRejectsNonImages(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, "<html></html>")
	}))
	defer server.Close()

	importer := NewRSSImporter(nil, config.RSSConfig{})
	if path := importer.downloadCoverImage(context.Background(), server.URL+"/cover.html"); path != "" {
		t.Fatalf("expected non-image cover to be skipped, got %q", path)
	}
}

func TestShouldUpdateRSSCoverImage(t *testing.T) {
	cases := []struct {
		name          string
		nextCover     string
		existingCover string
		expected      bool
	}{
		{
			name:          "stores downloaded local cover",
			nextCover:     "/storage/rss-covers/cover.jpg",
			existingCover: "",
			expected:      true,
		},
		{
			name:          "clears stale remote cover after failed download",
			nextCover:     "",
			existingCover: "https://gdb.voanews.com/example.jpg",
			expected:      true,
		},
		{
			name:          "keeps existing local cover when feed has no replacement",
			nextCover:     "",
			existingCover: "/storage/rss-covers/cover.jpg",
			expected:      false,
		},
		{
			name:          "keeps empty cover empty",
			nextCover:     "",
			existingCover: "",
			expected:      false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := shouldUpdateRSSCoverImage(tc.nextCover, tc.existingCover); got != tc.expected {
				t.Fatalf("shouldUpdateRSSCoverImage(%q, %q) = %v, want %v", tc.nextCover, tc.existingCover, got, tc.expected)
			}
		})
	}
}

func TestExtensionForImage(t *testing.T) {
	cases := []struct {
		contentType string
		sourcePath  string
		expected    string
	}{
		{contentType: "image/jpeg", sourcePath: "/cover", expected: ".jpg"},
		{contentType: "image/png", sourcePath: "/cover", expected: ".png"},
		{contentType: "image/webp", sourcePath: "/cover", expected: ".webp"},
		{contentType: "application/octet-stream", sourcePath: "/cover.gif", expected: ".gif"},
		{contentType: "text/html", sourcePath: "/cover.jpg", expected: ""},
	}

	for _, tc := range cases {
		if got := extensionForImage(tc.contentType, tc.sourcePath); got != tc.expected {
			t.Fatalf("extensionForImage(%q, %q) = %q, want %q", tc.contentType, tc.sourcePath, got, tc.expected)
		}
	}
}

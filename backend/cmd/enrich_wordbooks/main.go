package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"gugudu-backend/config"
	"gugudu-backend/services"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type wordBookJSON struct {
	Meta struct {
		Name       string `json:"name"`
		NameEN     string `json:"name_en"`
		Slug       string `json:"slug"`
		Category   string `json:"category"`
		Difficulty string `json:"difficulty"`
		CEFRLevel  string `json:"cefr_level"`
		Version    string `json:"version"`
		Source     string `json:"source"`
		License    string `json:"license"`
	} `json:"meta"`
	Units []struct {
		Unit    int    `json:"unit"`
		Name    string `json:"name"`
		Entries []entry `json:"entries"`
	} `json:"units"`
}

type entry struct {
	Word         string       `json:"word"`
	UKPhonetic   string       `json:"uk_phonetic"`
	USPhonetic   string       `json:"us_phonetic"`
	Definitions  []definition `json:"definitions"`
	Translation  string       `json:"translation"`
	Examples     []example    `json:"examples"`
	Collocations []string     `json:"collocations"`
	Frequency    int          `json:"frequency"`
	Tags         []string     `json:"tags"`
}

type definition struct {
	Pos        string `json:"pos"`
	Definition string `json:"definition"`
}

type example struct {
	EN string `json:"en"`
	ZH string `json:"zh"`
}

type entryRef struct {
	unitIdx  int
	entryIdx int
}

func main() {
	dir := flag.String("dir", "data/wordbooks", "词书目录")
	file := flag.String("file", "", "指定单个词书 JSON 文件路径")
	workers := flag.Int("workers", 10, "并发 worker 数量")
	dryRun := flag.Bool("dry-run", false, "仅统计需要更新的词条数")
	force := flag.Bool("force", false, "强制覆盖已有翻译（默认仅补充空值）")
	slug := flag.String("slug", "", "仅处理指定 slug 的词书")
	flag.Parse()

	cfg := config.LoadConfig()
	apiKey := cfg.Translation.BaiduDictAPIKey
	secretKey := cfg.Translation.BaiduDictSecretKey
	if (apiKey == "" || secretKey == "") && !*dryRun {
		log.Fatal("config.toml 中未配置 baidu_dict_api_key / baidu_dict_secret_key")
	}

	var dict *services.BaiduDictionaryService
	if !*dryRun {
		dict = services.NewBaiduDictionaryService(apiKey, secretKey)
	}

	var files []string
	if *file != "" {
		files = []string{*file}
	} else {
		var err error
		files, err = filepath.Glob(filepath.Join(*dir, "*.json"))
		if err != nil {
			log.Fatalf("扫描目录失败: %v", err)
		}
		log.Printf("词书目录: %s, 找到 %d 个文件", *dir, len(files))
	}

	for _, f := range files {
		book, raw, err := loadBook(f)
		if err != nil {
			log.Printf("✗ 跳过 %s: %v", filepath.Base(f), err)
			continue
		}

		if *slug != "" && book.Meta.Slug != *slug {
			continue
		}

		total := countEntries(book)
		needsUpdate := findNeedsUpdate(book, *force)
		log.Printf("--- %s (%s): %d 词条, %d 需更新 ---", book.Meta.Name, book.Meta.Slug, total, len(needsUpdate))

		if len(needsUpdate) == 0 {
			continue
		}

		if *dryRun {
			continue
		}

		updated := processBook(book, needsUpdate, dict, *workers, *force)

		if updated > 0 {
			oldVer := book.Meta.Version
			book.Meta.Version = bumpVersion(oldVer)
			if err := writeJSON(f, book); err != nil {
				log.Printf("✗ 保存失败 %s: %v", filepath.Base(f), err)
				continue
			}
			log.Printf("✓ %s: 更新 %d 词条, 版本 %s → %s", book.Meta.Name, updated, oldVer, book.Meta.Version)
		} else {
			log.Printf("- %s: 无实际更新", book.Meta.Name)
		}

		_ = raw
	}
}

func loadBook(filePath string) (*wordBookJSON, []byte, error) {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return nil, nil, err
	}
	var book wordBookJSON
	if err := json.Unmarshal(raw, &book); err != nil {
		return nil, nil, err
	}
	return &book, raw, nil
}

func countEntries(book *wordBookJSON) int {
	n := 0
	for _, u := range book.Units {
		n += len(u.Entries)
	}
	return n
}

func findNeedsUpdate(book *wordBookJSON, force bool) []entryRef {
	var refs []entryRef
	for ui, unit := range book.Units {
		for ei, e := range unit.Entries {
			if force || needsTranslationUpdate(e) {
				refs = append(refs, entryRef{unitIdx: ui, entryIdx: ei})
			}
		}
	}
	return refs
}

func needsTranslationUpdate(e entry) bool {
	if strings.TrimSpace(e.Translation) == "" {
		return true
	}
	if len(e.Definitions) == 0 {
		return true
	}
	for _, d := range e.Definitions {
		def := strings.TrimSpace(d.Definition)
		if def == "" || def == ")" || def == "(" {
			return true
		}
		if strings.TrimSpace(d.Pos) == "" {
			return true
		}
	}
	return false
}

func processBook(book *wordBookJSON, refs []entryRef, dict *services.BaiduDictionaryService, workers int, force bool) int {
	var updatedCount atomic.Int64
	total := int64(len(refs))

	jobs := make(chan entryRef, workers*2)

	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ref := range jobs {
				time.Sleep(150 * time.Millisecond)

				e := &book.Units[ref.unitIdx].Entries[ref.entryIdx]
				word := e.Word

				result, err := dict.LookupWord(word, "")
				if err != nil {
					done := updatedCount.Load()
					log.Printf("[%d/%d] ✗ %-20s %v", done, total, word, err)
					continue
				}

				changed := false

				if (force || strings.TrimSpace(e.Translation) == "") && result.Translation != "" {
					e.Translation = result.Translation
					changed = true
				}

				if (force || hasBadDefinitions(e.Definitions)) && len(result.Definitions) > 0 {
					e.Definitions = make([]definition, 0, len(result.Definitions))
					for _, d := range result.Definitions {
						def := d.Definition
						if d.Pos != "" {
							def = strings.TrimPrefix(def, d.Pos+" ")
							def = strings.TrimPrefix(def, d.Pos)
						}
						e.Definitions = append(e.Definitions, definition{Pos: d.Pos, Definition: def})
					}
					changed = true
				}

				if result.UKPhonetic != "" && e.UKPhonetic == "" {
					e.UKPhonetic = result.UKPhonetic
					changed = true
				}
				if result.USPhonetic != "" && e.USPhonetic == "" {
					e.USPhonetic = result.USPhonetic
					changed = true
				}

				if changed {
					u := updatedCount.Add(1)
					done := u
					if u%10 == 0 || done == total {
						log.Printf("[%d/%d] ✓ %s 已更新 %d 词条", done, total, book.Meta.Name, u)
					}
				}
			}
		}()
	}

	for _, ref := range refs {
		jobs <- ref
	}
	close(jobs)
	wg.Wait()

	return int(updatedCount.Load())
}

func hasBadDefinitions(defs []definition) bool {
	if len(defs) == 0 {
		return true
	}
	for _, d := range defs {
		def := strings.TrimSpace(d.Definition)
		if def == "" || def == ")" || def == "(" {
			return true
		}
		if strings.TrimSpace(d.Pos) == "" {
			return true
		}
	}
	return false
}

func bumpVersion(version string) string {
	parts := strings.Split(version, ".")
	if len(parts) == 3 {
		if n, err := strconv.Atoi(parts[2]); err == nil {
			parts[2] = strconv.Itoa(n + 1)
			return strings.Join(parts, ".")
		}
	}
	return version + ".1"
}

func writeJSON(filePath string, data *wordBookJSON) error {
	out, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化失败: %w", err)
	}
	return os.WriteFile(filePath, append(out, '\n'), 0o644)
}

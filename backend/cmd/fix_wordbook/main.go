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
		Entries []struct {
			Word         string   `json:"word"`
			UKPhonetic   string   `json:"uk_phonetic"`
			USPhonetic   string   `json:"us_phonetic"`
			Definitions  []struct {
				Pos        string `json:"pos"`
				Definition string `json:"definition"`
			} `json:"definitions"`
			Translation  string   `json:"translation"`
			Examples     []struct {
				EN string `json:"en"`
				ZH string `json:"zh"`
			} `json:"examples"`
			Collocations []string `json:"collocations"`
			Frequency    int      `json:"frequency"`
			Tags         []string `json:"tags"`
		} `json:"entries"`
	} `json:"units"`
}

type entryRef struct {
	unitIdx  int
	entryIdx int
}

func main() {
	filePath := flag.String("file", "data/wordbooks/cet6_core_2500.json", "词书 JSON 文件路径")
	dryRun := flag.Bool("dry-run", false, "仅检测损坏词条，不修改文件")
	workers := flag.Int("workers", 10, "并发 worker 数量")
	flag.Parse()

	raw, err := os.ReadFile(*filePath)
	if err != nil {
		log.Fatalf("读取文件失败: %v", err)
	}

	var data wordBookJSON
	if err := json.Unmarshal(raw, &data); err != nil {
		log.Fatalf("解析 JSON 失败: %v", err)
	}

	broken := findBrokenEntries(&data)
	log.Printf("文件: %s", *filePath)
	log.Printf("词条总数: %d, 损坏: %d", countAllEntries(&data), len(broken))

	if len(broken) == 0 {
		log.Println("没有损坏的词条，无需修复")
		return
	}

	if *dryRun {
		for _, ref := range broken {
			e := &data.Units[ref.unitIdx].Entries[ref.entryIdx]
			fd := ""
			if len(e.Definitions) > 0 {
				fd = e.Definitions[0].Definition
			}
			log.Printf("  损坏: %-20s translation=%q definition=%q", e.Word, e.Translation, fd)
		}
		return
	}

	cfg := config.LoadConfig()
	apiKey := cfg.Translation.BaiduDictAPIKey
	secretKey := cfg.Translation.BaiduDictSecretKey
	if apiKey == "" || secretKey == "" {
		log.Fatal("config.toml 中未配置 baidu_dict_api_key / baidu_dict_secret_key")
	}

	dict := services.NewBaiduDictionaryService(apiKey, secretKey)

	var fixedCount, failedCount atomic.Int64
	total := int64(len(broken))

	jobs := make(chan entryRef, *workers*2)

	var wg sync.WaitGroup
	for w := 0; w < *workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ref := range jobs {
				time.Sleep(150 * time.Millisecond)

				entry := &data.Units[ref.unitIdx].Entries[ref.entryIdx]
				word := entry.Word

				result, err := dict.LookupWord(word, "")
				if err != nil {
					failedCount.Add(1)
					done := failedCount.Load() + fixedCount.Load()
					log.Printf("[%d/%d] ✗ %-20s 查询失败: %v", done, total, word, err)
					continue
				}

				entry.Translation = result.Translation
				entry.Definitions = make([]struct {
					Pos        string `json:"pos"`
					Definition string `json:"definition"`
				}, 0, len(result.Definitions))
				for _, d := range result.Definitions {
					def := d.Definition
					if d.Pos != "" {
						def = strings.TrimPrefix(def, d.Pos+" ")
						def = strings.TrimPrefix(def, d.Pos)
					}
					entry.Definitions = append(entry.Definitions, struct {
						Pos        string `json:"pos"`
						Definition string `json:"definition"`
					}{
						Pos:        d.Pos,
						Definition: def,
					})
				}

				if result.UKPhonetic != "" && (entry.UKPhonetic == "" || entry.UKPhonetic == ")") {
					entry.UKPhonetic = result.UKPhonetic
				}
				if result.USPhonetic != "" && (entry.USPhonetic == "" || entry.USPhonetic == ")") {
					entry.USPhonetic = result.USPhonetic
				}

				f := fixedCount.Add(1)
				done := failedCount.Load() + f
				if f%50 == 0 || done == total {
					log.Printf("[%d/%d] ✓ 已修复 %d 个词条", done, total, f)
				}
			}
		}()
	}

	for _, ref := range broken {
		jobs <- ref
	}
	close(jobs)
	wg.Wait()

	if err := writeJSON(*filePath, &data); err != nil {
		log.Fatalf("保存文件失败: %v", err)
	}

	oldVer := data.Meta.Version
	parts := strings.Split(oldVer, ".")
	if len(parts) == 3 {
		if n, err := strconv.Atoi(parts[2]); err == nil {
			parts[2] = strconv.Itoa(n + 1)
		}
	} else {
		parts = append(parts, "1")
	}
	data.Meta.Version = strings.Join(parts, ".")

	if err := writeJSON(*filePath, &data); err != nil {
		log.Fatalf("更新版本号失败: %v", err)
	}
	log.Printf("版本号: %s → %s（重启后端自动 re-seed）", oldVer, data.Meta.Version)

	log.Printf("修复完成: 成功 %d, 失败 %d", fixedCount.Load(), failedCount.Load())
}

func findBrokenEntries(data *wordBookJSON) []entryRef {
	var refs []entryRef
	for ui, unit := range data.Units {
		for ei, entry := range unit.Entries {
			if isBroken(entry.Translation) || hasBrokenDefinitions(entry.Definitions) {
				refs = append(refs, entryRef{unitIdx: ui, entryIdx: ei})
			}
		}
	}
	return refs
}

func isBroken(s string) bool {
	s = strings.TrimSpace(s)
	return s == "" || s == ")" || s == "(" || s == "." || s == "," || s == "-"
}

func hasBrokenDefinitions(defs []struct {
	Pos        string `json:"pos"`
	Definition string `json:"definition"`
}) bool {
	if len(defs) == 0 {
		return true
	}
	for _, d := range defs {
		if isBroken(d.Definition) {
			return true
		}
	}
	return false
}

func countAllEntries(data *wordBookJSON) int {
	n := 0
	for _, u := range data.Units {
		n += len(u.Entries)
	}
	return n
}

func writeJSON(filePath string, data *wordBookJSON) error {
	out, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化 JSON 失败: %w", err)
	}

	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	return os.WriteFile(filePath, append(out, '\n'), 0o644)
}

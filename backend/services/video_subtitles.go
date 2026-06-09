package services

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

func ParseSubtitleFile(filename string, content []byte) ([]TranscriptionSegment, error) {
	lower := strings.ToLower(filename)
	text := strings.ReplaceAll(string(content), "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	if strings.HasSuffix(lower, ".vtt") {
		return ParseVTT(text)
	}
	if strings.HasSuffix(lower, ".srt") {
		return ParseSRT(text)
	}
	return nil, fmt.Errorf("unsupported subtitle file format")
}

func ParseSRT(content string) ([]TranscriptionSegment, error) {
	return parseSubtitleBlocks(content, false)
}

func ParseVTT(content string) ([]TranscriptionSegment, error) {
	lines := strings.Split(content, "\n")
	if len(lines) > 0 && strings.HasPrefix(strings.TrimSpace(lines[0]), "WEBVTT") {
		lines = lines[1:]
	}
	return parseSubtitleBlocks(strings.Join(lines, "\n"), true)
}

func parseSubtitleBlocks(content string, allowVTTSettings bool) ([]TranscriptionSegment, error) {
	blocks := splitSubtitleBlocks(content)
	segments := make([]TranscriptionSegment, 0, len(blocks))
	for _, block := range blocks {
		lines := strings.Split(strings.TrimSpace(block), "\n")
		if len(lines) == 0 {
			continue
		}

		timeLineIndex := -1
		for i, line := range lines {
			if strings.Contains(line, "-->") {
				timeLineIndex = i
				break
			}
		}
		if timeLineIndex < 0 {
			continue
		}

		start, end, err := parseTimeRange(lines[timeLineIndex], allowVTTSettings)
		if err != nil {
			return nil, err
		}
		if end <= start {
			continue
		}

		textLines := lines[timeLineIndex+1:]
		cleanText := cleanSubtitleText(strings.Join(textLines, " "))
		if cleanText == "" {
			continue
		}
		segments = append(segments, TranscriptionSegment{
			StartSeconds: start,
			EndSeconds:   end,
			Text:         cleanText,
			Confidence:   0,
		})
	}

	if len(segments) == 0 {
		return nil, fmt.Errorf("no subtitle cues found")
	}

	sort.SliceStable(segments, func(i, j int) bool {
		return segments[i].StartSeconds < segments[j].StartSeconds
	})
	return CleanTranscriptionSegments(segments), nil
}

func splitSubtitleBlocks(content string) []string {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}
	re := regexp.MustCompile(`\n{2,}`)
	return re.Split(content, -1)
}

func parseTimeRange(line string, allowSettings bool) (float64, float64, error) {
	parts := strings.Split(line, "-->")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid subtitle time range: %s", line)
	}
	startText := strings.TrimSpace(parts[0])
	endText := strings.TrimSpace(parts[1])
	if allowSettings {
		endText = strings.Fields(endText)[0]
	}

	start, err := parseSubtitleTimestamp(startText)
	if err != nil {
		return 0, 0, err
	}
	end, err := parseSubtitleTimestamp(endText)
	if err != nil {
		return 0, 0, err
	}
	return start, end, nil
}

func parseSubtitleTimestamp(value string) (float64, error) {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, ",", ".")
	parts := strings.Split(value, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, fmt.Errorf("invalid subtitle timestamp: %s", value)
	}

	var hours float64
	var minutesPart string
	var secondsPart string
	if len(parts) == 3 {
		h, err := strconv.ParseFloat(parts[0], 64)
		if err != nil {
			return 0, fmt.Errorf("invalid subtitle timestamp: %s", value)
		}
		hours = h
		minutesPart = parts[1]
		secondsPart = parts[2]
	} else {
		minutesPart = parts[0]
		secondsPart = parts[1]
	}

	minutes, err := strconv.ParseFloat(minutesPart, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid subtitle timestamp: %s", value)
	}
	seconds, err := strconv.ParseFloat(secondsPart, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid subtitle timestamp: %s", value)
	}
	return hours*3600 + minutes*60 + seconds, nil
}

func cleanSubtitleText(text string) string {
	text = strings.TrimSpace(text)
	text = regexp.MustCompile(`<[^>]+>`).ReplaceAllString(text, "")
	text = strings.ReplaceAll(text, "&nbsp;", " ")
	text = strings.ReplaceAll(text, "&amp;", "&")
	text = strings.ReplaceAll(text, "&lt;", "<")
	text = strings.ReplaceAll(text, "&gt;", ">")
	return strings.Join(strings.Fields(text), " ")
}

package services

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type MediaProbe struct {
	DurationSeconds float64
	FormatName      string
}

type MediaProcessor struct {
	Timeout time.Duration
}

func NewMediaProcessor(timeoutSeconds int) *MediaProcessor {
	if timeoutSeconds <= 0 {
		timeoutSeconds = 1800
	}
	return &MediaProcessor{Timeout: time.Duration(timeoutSeconds) * time.Second}
}

func (p *MediaProcessor) Probe(ctx context.Context, mediaPath string) (MediaProbe, error) {
	if _, err := exec.LookPath("ffprobe"); err != nil {
		return MediaProbe{}, fmt.Errorf("ffprobe is required for video processing: %w", err)
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, p.Timeout)
	defer cancel()

	cmd := exec.CommandContext(
		timeoutCtx,
		"ffprobe",
		"-v", "error",
		"-show_entries", "format=duration,format_name",
		"-of", "json",
		mediaPath,
	)

	output, err := cmd.Output()
	if err != nil {
		return MediaProbe{}, fmt.Errorf("failed to probe media: %w", err)
	}

	var parsed struct {
		Format struct {
			Duration   string `json:"duration"`
			FormatName string `json:"format_name"`
		} `json:"format"`
	}
	if err := json.Unmarshal(output, &parsed); err != nil {
		return MediaProbe{}, fmt.Errorf("failed to parse ffprobe output: %w", err)
	}

	duration, _ := strconv.ParseFloat(parsed.Format.Duration, 64)
	return MediaProbe{
		DurationSeconds: duration,
		FormatName:      parsed.Format.FormatName,
	}, nil
}

func (p *MediaProcessor) ExtractAudio(ctx context.Context, inputPath, outputPath string) error {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return fmt.Errorf("ffmpeg is required for video processing: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return fmt.Errorf("failed to create audio directory: %w", err)
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, p.Timeout)
	defer cancel()

	cmd := exec.CommandContext(
		timeoutCtx,
		"ffmpeg",
		"-y",
		"-i", inputPath,
		"-vn",
		"-ac", "1",
		"-ar", "16000",
		"-b:a", "48k",
		outputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 600 {
			message = message[:600]
		}
		if timeoutCtx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("audio extraction timed out")
		}
		if message != "" {
			return fmt.Errorf("failed to extract audio: %s", message)
		}
		return fmt.Errorf("failed to extract audio: %w", err)
	}

	return nil
}

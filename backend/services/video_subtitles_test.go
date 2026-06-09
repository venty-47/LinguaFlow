package services

import "testing"

func TestParseSRT(t *testing.T) {
	content := `1
00:00:01,000 --> 00:00:03,500
Hello everyone.

2
00:00:04,000 --> 00:00:07,000
Today I want to talk about learning.`

	segments, err := ParseSRT(content)
	if err != nil {
		t.Fatalf("ParseSRT returned error: %v", err)
	}
	if len(segments) != 2 {
		t.Fatalf("expected 2 segments, got %d", len(segments))
	}
	if segments[0].StartSeconds != 1 || segments[0].EndSeconds != 3.5 {
		t.Fatalf("unexpected first segment timing: %#v", segments[0])
	}
	if segments[1].Text != "Today I want to talk about learning." {
		t.Fatalf("unexpected second segment text: %q", segments[1].Text)
	}
}

func TestParseVTTWithSettingsAndTags(t *testing.T) {
	content := `WEBVTT

00:00:02.000 --> 00:00:05.000 align:start position:0%
<v Speaker>Welcome &amp; listen carefully.</v>`

	segments, err := ParseVTT(content)
	if err != nil {
		t.Fatalf("ParseVTT returned error: %v", err)
	}
	if len(segments) != 1 {
		t.Fatalf("expected 1 segment, got %d", len(segments))
	}
	if segments[0].Text != "Welcome & listen carefully." {
		t.Fatalf("unexpected cleaned text: %q", segments[0].Text)
	}
}

func TestCleanTranscriptionSegmentsSortsAndFixesTiming(t *testing.T) {
	segments := CleanTranscriptionSegments([]TranscriptionSegment{
		{StartSeconds: 5, EndSeconds: 5, Text: " later "},
		{StartSeconds: -1, EndSeconds: 2, Text: " first "},
		{StartSeconds: 3, EndSeconds: 4, Text: "   "},
	})

	if len(segments) != 2 {
		t.Fatalf("expected 2 cleaned segments, got %d", len(segments))
	}
	if segments[0].StartSeconds != 0 || segments[0].Text != "first" {
		t.Fatalf("unexpected first cleaned segment: %#v", segments[0])
	}
	if segments[1].EndSeconds <= segments[1].StartSeconds {
		t.Fatalf("expected timing to be fixed: %#v", segments[1])
	}
}

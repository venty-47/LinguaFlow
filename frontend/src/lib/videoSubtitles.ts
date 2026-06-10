import { VideoSubtitle } from '@/types';

export function findActiveSubtitle(subtitles: VideoSubtitle[], time: number) {
  let left = 0;
  let right = subtitles.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (subtitles[mid].start_seconds <= time) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (result >= 0 && time < subtitles[result].end_seconds) {
    return subtitles[result];
  }
  return null;
}

export function formatVideoTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function getSubtitleContext(subtitle: VideoSubtitle, subtitles: VideoSubtitle[]) {
  const index = subtitles.findIndex((item) => item.id === subtitle.id);
  if (index === -1) return subtitle.text;
  return subtitles.slice(Math.max(0, index - 1), index + 2).map((item) => item.text).join(' ');
}

export function splitSubtitleTokens(text: string) {
  return text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?|[^A-Za-z]+/g) || [text];
}

export function normalizeSubtitleWord(token: string) {
  return token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase();
}

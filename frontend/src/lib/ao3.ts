export function formatAO3Chapters(value: string) {
  const chapters = value.trim();
  if (!chapters) return '';

  const match = chapters.match(/^(\d+|\?)\s*\/\s*(\d+|\?)$/);
  if (!match) return `${chapters} 章`;

  const [, published, total] = match;

  if (published === '?' && total === '?') return '连载中';
  if (total === '?') return `${published} 章（连载中）`;
  if (published === total) return `${published} 章（已完结）`;
  if (published === '?') return `预计 ${total} 章`;

  return `${published} / ${total} 章`;
}

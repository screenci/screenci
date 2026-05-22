export function findDuplicateTitles(titles: readonly string[]): string[] {
  const counts = new Map<string, number>()

  for (const title of titles) {
    counts.set(title, (counts.get(title) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([title]) => title)
}

export function formatDuplicateTitlesMessage(
  duplicates: readonly string[]
): string {
  const lines = [
    'Duplicate test titles detected. Titles must be exactly unique:',
  ]

  for (const title of duplicates) {
    lines.push(`  - "${title}"`)
  }

  return lines.join('\n')
}

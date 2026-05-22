const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*%\u0000-\u001f]/g
const TRAILING_DOTS_OR_SPACES = /[. ]+$/

function escapeCharacter(character: string): string {
  return encodeURIComponent(character)
}

export function escapeFileSystemPathSegment(title: string): string {
  let escaped = title.replace(INVALID_FILE_NAME_CHARACTERS, escapeCharacter)

  escaped = escaped.replace(TRAILING_DOTS_OR_SPACES, (suffix) =>
    [...suffix]
      .map((character) =>
        character === '.' ? '%2E' : escapeCharacter(character)
      )
      .join('')
  )

  if (escaped === '.' || escaped === '..') {
    escaped = [...escaped].map(escapeCharacter).join('')
  }

  const normalizedForWindows = escaped.replace(/[. ]+$/g, '')
  if (WINDOWS_RESERVED_NAMES.has(normalizedForWindows.toUpperCase())) {
    escaped = `${escaped}%20`
  }

  return escaped
}

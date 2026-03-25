function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Returns an HTML string with syntax-colored <span> tags for JSON display.
 * All text content is HTML-escaped to prevent XSS.
 * Falls back to HTML-escaped plain text if input is not valid JSON.
 */
export function highlightJson(input: string): string {
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(input), null, 2)
  } catch {
    return escapeHtml(input)
  }

  // Classic single-pass JSON token regex
  const tokenRegex =
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g

  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(pretty)) !== null) {
    // Escape and append the non-token segment before this match
    result += escapeHtml(pretty.slice(lastIndex, match.index))

    const token = match[0]
    let color: string

    if (token.startsWith('"')) {
      // Key: ends with optional whitespace + colon
      color = token.trimEnd().endsWith(':') ? '#9b1c3a' : '#1a6b3c'
    } else if (token === 'true' || token === 'false' || token === 'null') {
      color = 'rgba(20,18,16,0.55)'
    } else {
      color = '#7c4d00' // number
    }

    result += `<span style="color:${color}">${escapeHtml(token)}</span>`
    lastIndex = match.index + token.length
  }

  result += escapeHtml(pretty.slice(lastIndex))
  return result
}

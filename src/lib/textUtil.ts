export function preprocessText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, 100000)
}

export function inferAuthor(filename: string, content: string): string | undefined {
  try {
    const base = filename.replace(/\.[^.]+$/, '')
    const paren = base.match(/[（(]([ぁ-ゖァ-ヺ一-龯]{2,10})[）)]/)
    if (paren && paren[1]) return paren[1]
    const bracket = base.match(/【.*】([ぁ-ゖァ-ヺ一-龯]{2,10})/)
    if (bracket && bracket[1]) return bracket[1]

    const exclude = ['修士論文','修論','卒論','本文','最終','最終提出版','完成版','final','v','ver','版']
    const parts = base.split(/[\s_\-]+/)
    const cand = parts
      .map(p => p.replace(/[0-9()（）\[\]【】]+/g, ''))
      .filter(p => p.length >= 2 && p.length <= 10)
      .filter(p => /^[ぁ-ゖァ-ヺ一-龯]+$/.test(p))
      .filter(p => !exclude.some(w => p.includes(w)))
      .sort((a,b) => b.length - a.length)[0]
    if (cand) return cand

    const head = content.slice(0, 3000)
    const byLine = head.match(/(?:著者|作者|氏名|姓名)[:：]\s*([ぁ-ゖァ-ヺ一-龯]{2,10})/)
    if (byLine && byLine[1]) return byLine[1]
    const around = head.match(/([ぁ-ゖァ-ヺ一-龯]{2,10})\s*(?:君|さん)?\s*(?:学籍番号|指導|所属)/)
    if (around && around[1]) return around[1]
  } catch {}
  return undefined
}


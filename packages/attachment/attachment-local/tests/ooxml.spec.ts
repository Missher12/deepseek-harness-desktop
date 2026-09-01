import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractOoxmlText } from '../src/ooxml.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const

function archive(entries: Readonly<Record<string, string>>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])))
}

function docx(extra: Readonly<Record<string, string>> = {}): Uint8Array {
  return archive({
    '[Content_Types].xml': '<?xml version="1.0"?><Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:tab/><w:t>world</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>',
    ...extra,
  })
}

function xlsx(): Uint8Array {
  return archive({
    '[Content_Types].xml': '<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="urn:r"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<?xml version="1.0"?><sst><si><t>Item</t></si><si><r><t>Total</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>2+2</f><v>4</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Done</t></is></c><c r="B2" t="s"><v>1</v></c></row></sheetData></worksheet>',
  })
}

describe('extractOoxmlText', () => {
  it('extracts ordered DOCX paragraphs without executing relationships', () => {
    expect(extractOoxmlText(docx({
      'word/_rels/document.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://example.invalid/secret"/></Relationships>',
    }), DOCX, 1024)).toEqual({ text: 'Hello\tworld\nSecond line', truncated: false })
  })

  it('extracts XLSX display values and never evaluates formulas', () => {
    expect(extractOoxmlText(xlsx(), XLSX, 1024)).toEqual({
      text: '[Sheet: Budget]\nItem\t4\nDone\tTotal',
      truncated: false,
    })
  })

  it('rejects traversal, macros, encrypted containers, and expansion abuse', () => {
    expect(() => extractOoxmlText(docx({ '../escape.xml': '<x/>' }), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    expect(() => extractOoxmlText(docx({ 'word/vbaProject.bin': 'macro' }), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'DOCUMENT_MACROS_UNSUPPORTED' }))
    expect(() => extractOoxmlText(archive({ EncryptionInfo: 'x', EncryptedPackage: 'x' }), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'DOCUMENT_ENCRYPTED' }))
    expect(() => extractOoxmlText(docx({ 'word/large.xml': 'x'.repeat(9 * 1024 * 1024) }), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
  })

  it('truncates UTF-8 output deterministically without splitting a character', () => {
    const result = extractOoxmlText(docx({
      'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>甲乙丙丁</w:t></w:r></w:p></w:body></w:document>',
    }), DOCX, 7)
    expect(result).toEqual({ text: '甲乙', truncated: true })
    expect(new TextEncoder().encode(result.text)).toHaveLength(6)
  })
})

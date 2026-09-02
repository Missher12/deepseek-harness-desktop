import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractOoxmlText } from '../src/ooxml.ts'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const

function archive(entries: Readonly<Record<string, string>>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])))
}

function archiveBytes(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  return zipSync(entries)
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

  it('accepts ordinary explicit ZIP directory entries without treating them as traversal', () => {
    expect(extractOoxmlText(docx({ 'word/': '' }), DOCX, 1024)).toEqual({
      text: 'Hello\tworld\nSecond line',
      truncated: false,
    })
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

  it('rejects every unsafe ZIP path shape and bounded container overflow', () => {
    for (const path of ['/absolute.xml', 'word//empty.xml', 'a/b/c/d/e/f/g/h/i.xml']) {
      expect(() => extractOoxmlText(docx({ [path]: '<x/>' }), DOCX, 1024))
        .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    }
    expect(() => extractOoxmlText(docx({ 'word/non-empty/': 'x' }), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))

    const entries = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`unused/${String(index)}.xml`, '<x/>']))
    expect(() => extractOoxmlText(docx(entries), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))

    const expanded = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
      `unused/${String(index)}.xml`,
      'x'.repeat(7 * 1024 * 1024),
    ]))
    expect(() => extractOoxmlText(docx(expanded), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
  })

  it('rejects malformed ZIP and XML payloads without parser fallback', () => {
    expect(() => extractOoxmlText(Uint8Array.of(1, 2, 3), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    expect(() => extractOoxmlText(Uint8Array.of(0x50, 0x4b, 0, 0), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    expect(() => extractOoxmlText(archiveBytes({
      '[Content_Types].xml': strToU8('<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      'word/document.xml': Uint8Array.of(0xff),
    }), DOCX, 1024)).toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    expect(() => extractOoxmlText(docx({ 'word/document.xml': '<!DOCTYPE x><x/>' }), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    expect(() => extractOoxmlText(docx({ 'word/document.xml': '<w:document>' }), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
  })

  it('rejects missing parts, macro declarations, and declared Office type mismatches', () => {
    const docxTypes = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    const xlsxTypes = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
    expect(() => extractOoxmlText(archive({ 'word/document.xml': '<w:document/>' }), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    expect(() => extractOoxmlText(archive({ '[Content_Types].xml': docxTypes }), DOCX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    expect(() => extractOoxmlText(docx({
      '[Content_Types].xml': '<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
    }), DOCX, 1024)).toThrow(expect.objectContaining({ code: 'DOCUMENT_MACROS_UNSUPPORTED' }))
    expect(() => extractOoxmlText(archive({
      '[Content_Types].xml': xlsxTypes,
      'word/document.xml': '<w:document/>',
    }), DOCX, 1024)).toThrow(expect.objectContaining({ code: 'DOCUMENT_TYPE_MISMATCH' }))
    expect(() => extractOoxmlText(archive({
      '[Content_Types].xml': docxTypes,
      'xl/workbook.xml': '<workbook/>',
      'xl/_rels/workbook.xml.rels': '<Relationships/>',
    }), XLSX, 1024)).toThrow(expect.objectContaining({ code: 'DOCUMENT_TYPE_MISMATCH' }))
  })

  it('extracts DOCX breaks and ignores non-text structural nodes', () => {
    expect(extractOoxmlText(docx({
      'word/document.xml': '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t><w:cr/><w:t>C</w:t></w:r></w:p><w:p>ignored literal</w:p><w:sectPr/></w:body></w:document>',
    }), DOCX, 1024)).toEqual({ text: 'A\nB\nC\n', truncated: false })
  })

  it('rejects XLSX files with missing or unreadable workbook targets', () => {
    const contentTypes = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
    expect(() => extractOoxmlText(archive({ '[Content_Types].xml': contentTypes }), XLSX, 1024))
      .toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))

    for (const target of ['/worksheets/sheet1.xml', 'worksheets\\sheet1.xml', '../sheet1.xml']) {
      expect(() => extractOoxmlText(archive({
        '[Content_Types].xml': contentTypes,
        'xl/workbook.xml': '<workbook><sheets><sheet r:id="r1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="r1" Target="${target}"/></Relationships>`,
      }), XLSX, 1024)).toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    }
    expect(() => extractOoxmlText(archive({
      '[Content_Types].xml': contentTypes,
      'xl/workbook.xml': '<workbook><sheets><sheet r:id="r1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" TargetMode="External" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c><v>secret</v></c></row></sheetData></worksheet>',
    }), XLSX, 1024)).toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
    expect(() => extractOoxmlText(archive({
      '[Content_Types].xml': contentTypes,
      'xl/workbook.xml': '<workbook><sheets><sheet r:id="r1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships/>',
    }), XLSX, 1024)).toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT' }))
  })

  it('uses bounded XLSX display fallbacks without evaluating formulas', () => {
    const contentTypes = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
    const result = extractOoxmlText(archive({
      '[Content_Types].xml': contentTypes,
      'xl/workbook.xml': '<workbook><sheets><sheet r:id="r1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship/><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si/></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>-1</v></c><c t="s"><v>99</v></c><c t="inlineStr"><is><r><t>inline</t></r></is></c><c><f>1+1</f><v>2</v></c><c><v><x/></v></c></row></sheetData></worksheet>',
    }), XLSX, 1024)
    expect(result).toEqual({ text: '[Sheet: Sheet 1]\n\t\tinline\t2\t', truncated: false })
  })

  it('truncates UTF-8 output deterministically without splitting a character', () => {
    const result = extractOoxmlText(docx({
      'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>甲乙丙丁</w:t></w:r></w:p></w:body></w:document>',
    }), DOCX, 7)
    expect(result).toEqual({ text: '甲乙', truncated: true })
    expect(new TextEncoder().encode(result.text)).toHaveLength(6)
  })

  it('stops DOCX traversal at bounded tabs, breaks, and paragraph separators', () => {
    for (const documentXml of [
      '<w:document><w:body><w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p></w:body></w:document>',
      '<w:document><w:body><w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t></w:r></w:p></w:body></w:document>',
      '<w:document><w:body><w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p></w:body></w:document>',
    ]) {
      expect(extractOoxmlText(docx({ 'word/document.xml': documentXml }), DOCX, 1))
        .toEqual({ text: 'A', truncated: true })
    }
  })

  it('stops XLSX rendering at every bounded structural append', () => {
    const contentTypes = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
    const makeWorkbook = (
      sheets: string,
      relationships: string,
      worksheets: Readonly<Record<string, string>>,
      sharedStrings?: string,
    ): Uint8Array => archive({
      '[Content_Types].xml': contentTypes,
      'xl/workbook.xml': `<workbook><sheets>${sheets}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships>${relationships}</Relationships>`,
      ...sharedStrings === undefined ? {} : { 'xl/sharedStrings.xml': sharedStrings },
      ...worksheets,
    })

    const oneSheet = '<sheet name="S" r:id="r1"/>'
    const oneRelationship = '<Relationship Id="r1" Target="worksheets/sheet1.xml"/>'
    expect(extractOoxmlText(makeWorkbook(oneSheet, oneRelationship, {
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>',
    }), XLSX, 1)).toEqual({ text: '[', truncated: true })
    expect(extractOoxmlText(makeWorkbook(oneSheet, oneRelationship, {
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row/></sheetData></worksheet>',
    }), XLSX, 10)).toEqual({ text: '[Sheet: S]', truncated: true })
    expect(extractOoxmlText(makeWorkbook(oneSheet, oneRelationship, {
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c><v>A</v></c><c><v>B</v></c></row></sheetData></worksheet>',
    }), XLSX, 12)).toEqual({ text: '[Sheet: S]\nA', truncated: true })
    expect(extractOoxmlText(makeWorkbook(oneSheet, oneRelationship, {
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c><v>AB</v></c></row></sheetData></worksheet>',
    }), XLSX, 12)).toEqual({ text: '[Sheet: S]\nA', truncated: true })
    expect(extractOoxmlText(makeWorkbook(oneSheet, oneRelationship, {
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>',
    }, '<sst><si><r><t>ABCDEFGHIJKLMNOPQRST</t></r></si></sst>'), XLSX, 12))
      .toEqual({ text: '[Sheet: S]\nA', truncated: true })

    expect(extractOoxmlText(makeWorkbook(
      '<sheet name="A" r:id="r1"/><sheet name="B" r:id="r2"/>',
      '<Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/>',
      {
        'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>',
        'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
      },
    ), XLSX, 10)).toEqual({ text: '[Sheet: A]', truncated: true })
  })

  it('stops XLSX worksheet parsing as soon as the UTF-8 output budget is exhausted', () => {
    const contentTypes = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
    const result = extractOoxmlText(archive({
      '[Content_Types].xml': contentTypes,
      'xl/workbook.xml': '<workbook><sheets><sheet name="First" r:id="r1"/><sheet name="Unread" r:id="r2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row><c t="inlineStr"><is><t>${'甲'.repeat(100)}</t></is></c></row></sheetData></worksheet>`,
      'xl/worksheets/sheet2.xml': '<worksheet>',
    }), XLSX, 21)

    expect(result).toEqual({ text: '[Sheet: First]\n甲甲', truncated: true })
  })
})

"""Validate and extract Office content. Never executes macros or external links."""
import json, sys, zipfile, pathlib

def inspect_pdf(p):
    from pypdf import PdfReader, filters
    # Bound decoded content streams before text extraction.
    for name in ('ZLIB_MAX_OUTPUT_LENGTH','LZW_MAX_OUTPUT_LENGTH','RUN_LENGTH_MAX_OUTPUT_LENGTH','MAX_ARRAY_BASED_STREAM_OUTPUT_LENGTH','MAX_DECLARED_STREAM_LENGTH'):
        setattr(filters,name,8*1024*1024)
    if p.open('rb').read(5)!=b'%PDF-': raise ValueError('pdf signature')
    reader=PdfReader(p,strict=True)
    if reader.is_encrypted: raise ValueError('encrypted PDF')
    total=len(reader.pages); parts=[]; used=0; truncated=total>200; empty=[]
    for i in range(min(total,200)):
        text=reader.pages[i].extract_text() or ''
        if not text.strip():
            empty.append(i+1)
            text='[此页未提取到文字，可能是扫描图片或空白页；未进行 OCR，不得推断内容。]'
        part='第 %d 页\n%s'%(i+1,text)
        remaining=30000-used
        if len(part)>remaining:
            parts.append(part[:remaining]);truncated=True;break
        parts.append(part);used+=len(part)+2
        if used>=30000:truncated=i+1<total;break
    return {'format':'.pdf','text':'\n\n'.join(parts)[:30000],'truncated':truncated,'pages':total,'emptyPages':empty,
            'notice':'PDF 共 %d 页，最多提取前 200 页、30000 字符，按原页码标记。只读取文字层，未进行 OCR 或渲染图片、图表和版式；无文字的页面不能据此分析内容。'%total}

def inspect(filename):
    p=pathlib.Path(filename); ext=p.suffix.lower()
    if p.stat().st_size>20*1024*1024: raise ValueError('size')
    if ext=='.pdf': return inspect_pdf(p)
    if ext not in ('.xlsx','.docx','.pptx'): raise ValueError('format')
    with zipfile.ZipFile(p) as z:
        entries=z.infolist()
        if len(entries)>5000 or sum(i.file_size for i in entries)>80*1024*1024: raise ValueError('size')
        if len({i.filename for i in entries})!=len(entries): raise ValueError('duplicate')
        for i in entries:
            if i.file_size>16*1024*1024 or i.flag_bits & 1: raise ValueError('size/encryption')
            if 'vbaproject' in i.filename.lower(): raise ValueError('macro')
            if i.filename.endswith(('.xml','.rels')):
                content=z.read(i)
                if b'<!DOCTYPE' in content or b'<!ENTITY' in content: raise ValueError('entity')
        required={'.xlsx':'xl/workbook.xml','.docx':'word/document.xml','.pptx':'ppt/presentation.xml'}[ext]
        if required not in z.namelist(): raise ValueError('format')
    lines=[]; truncated=False
    def add(text):
        nonlocal truncated
        if len(lines)>=3000 or sum(map(len,lines))>30000: truncated=True;return False
        lines.append(str(text)[:10000]);return True
    if ext=='.xlsx':
        from openpyxl import load_workbook
        wb=load_workbook(p,read_only=True,data_only=False,keep_links=False)
        for ws in wb.worksheets[:30]:
            add('工作表：'+ws.title)
            for row in ws.iter_rows(max_row=min(ws.max_row or 1,2000),max_col=min(ws.max_column or 1,100)):
                values=['%s=%s'%(c.coordinate,c.value) for c in row if c.value is not None]
                if values and not add(' | '.join(values)): break
            if (ws.max_row or 0)>2000 or (ws.max_column or 0)>100: truncated=True
        if len(wb.worksheets)>30: truncated=True
        wb.close()
    elif ext=='.docx':
        from docx import Document
        doc=Document(p)
        for paragraph in doc.paragraphs:
            if not add(paragraph.text): break
        for i,table in enumerate(doc.tables):
            if not add('表格 %d'%(i+1)): break
            for row in table.rows:
                if not add(' | '.join(c.text for c in row.cells)): break
    else:
        from pptx import Presentation
        deck=Presentation(p)
        for i,slide in enumerate(deck.slides):
            if not add('幻灯片 %d'%(i+1)): break
            for shape in slide.shapes:
                if shape.has_text_frame: add(shape.text)
                if shape.has_table:
                    for row in shape.table.rows: add(' | '.join(c.text for c in row.cells))
            if slide.has_notes_slide: add('备注：'+slide.notes_slide.notes_text_frame.text)
    return {'format':ext,'text':'\n'.join(lines)[:30000],'truncated':truncated,'notice':'提取文本、表格和公式；未渲染版式、图表或图片。Excel 公式不在此重新计算。'}

if __name__=='__main__':
    try: print(json.dumps(inspect(sys.argv[1]),ensure_ascii=True))
    except Exception: print(json.dumps({'error':'文档无法解析：请确认格式正确、未加密且未超出大小或解压限制'},ensure_ascii=True));sys.exit(1)

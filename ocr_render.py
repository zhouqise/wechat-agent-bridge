"""Render one bounded PDF page or normalize one image. No OCR subprocess children."""
import sys, math
from PIL import Image, ImageOps
Image.MAX_IMAGE_PIXELS=20_000_000
source,target,index=sys.argv[1],sys.argv[2],int(sys.argv[3])
if index<0:
    with Image.open(source) as im:
        if im.width*im.height>20_000_000: raise ValueError('pixels')
        im=ImageOps.exif_transpose(im).convert('RGB')
        im.thumbnail((3000,3000));im.save(target)
else:
    import pypdfium2 as pdfium
    with pdfium.PdfDocument(source) as doc:
        page=doc[index]
        try:
            w,h=page.get_size()
            if not all(math.isfinite(v) and 0<v<100000 for v in (w,h)): raise ValueError('dimensions')
            scale=min(2.5,3000/max(w,h))
            bitmap=page.render(scale=scale)
            try:
                with bitmap.to_pil() as im: im.save(target)
            finally: bitmap.close()
        finally: page.close()

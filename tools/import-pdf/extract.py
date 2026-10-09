"""Extract text from diet PDFs: python extract.py <pdf_dir> <txt_dir>  (requires: pip install pypdf)"""
import glob, os, re, sys
import pypdf

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for f in sorted(glob.glob(os.path.join(src, 'dieta*.pdf'))):
    n = int(re.search(r'\((\d+)\)', f).group(1))
    with open(os.path.join(dst, 'd%02d.txt' % n), 'w') as o:
        for i, p in enumerate(pypdf.PdfReader(f).pages):
            o.write('\n=====PAGE %d=====\n' % (i + 1))
            o.write(p.extract_text() or '')

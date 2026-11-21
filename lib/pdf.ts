// Turns the drawing sheet SVG into a vector PDF in the browser (no server). Geist is embedded from
// /fonts so the PDF looks like the preview.

const toBase64 = (buf: ArrayBuffer) => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

let fontCache: Promise<[string, string]> | null = null;
const fonts = () =>
  (fontCache ??= Promise.all(
    ['/fonts/Geist-Regular.ttf', '/fonts/Geist-Medium.ttf'].map((u) => fetch(u).then((r) => r.arrayBuffer()).then(toBase64)),
  ) as Promise<[string, string]>);

export async function sheetToPdf(svg: string, w: number, h: number): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }, [regular, medium]] = await Promise.all([import('jspdf'), import('svg2pdf.js'), fonts()]);
  const doc = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'mm', format: [w, h], compress: true });
  doc.addFileToVFS('Geist-Regular.ttf', regular);
  doc.addFont('Geist-Regular.ttf', 'Geist', 'normal');
  doc.addFileToVFS('Geist-Medium.ttf', medium);
  doc.addFont('Geist-Medium.ttf', 'GeistMedium', 'normal');

  // jsPDF has no weight 500: give medium text its own family. Everything else stays as drawn.
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
  el.setAttribute('font-family', 'Geist');
  el.querySelectorAll('text').forEach((t) => {
    if (t.getAttribute('font-weight') === '500') t.setAttribute('font-family', 'GeistMedium');
    t.setAttribute('font-weight', 'normal');
  });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
  host.appendChild(el);
  document.body.appendChild(host);
  try {
    await svg2pdf(el, doc, { x: 0, y: 0, width: w, height: h });
  } finally {
    host.remove();
  }
  return doc.output('blob');
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

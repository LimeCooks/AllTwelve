import { wrapPrintText } from '@/lib/print-layout';
import type { DesignerPlay } from '@/lib/play-designer';

export type TeachingPdfOptions = {
  paper: 'letter' | 'a4';
  landscape: boolean;
  notes: boolean;
  assignments: boolean;
};
type Sheet = { play: DesignerPlay; svg: SVGSVGElement | null };

async function diagramImage(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = svg.viewBox.baseVal;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.ceil(box.width * 2)));
  clone.setAttribute('height', String(Math.ceil(box.height * 2)));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], {
      type: 'image/svg+xml;charset=utf-8',
    }),
  );
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () =>
          reject(
            new Error('The diagram took too long to prepare. Please retry.'),
          ),
        15000,
      );
      image.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error('A saved diagram could not be prepared. Please retry.'),
        );
      };
      image.src = url;
    });
    return { image, ratio: box.width / box.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Browser-native text rendering preserves the coach's Unicode terminology.
// Pages are embedded as high-resolution images so no external font upload is required.
export async function createTeachingPdf(
  sheets: Sheet[],
  options: TeachingPdfOptions,
  onProgress: (completed: number) => void = () => {},
) {
  if (!sheets.length || sheets.length > 25)
    throw new Error('Choose between 1 and 25 plays per PDF.');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle('ChalkTalk teaching sheet');
  pdf.setCreator('ChalkTalk');
  pdf.setProducer('ChalkTalk');
  const size = options.paper === 'a4' ? [595.28, 841.89] : [612, 792];
  const [width, height] = options.landscape ? [size[1], size[0]] : size;
  const margin = 36,
    contentWidth = width - margin * 2,
    bottom = height - 44;
  let canvas!: HTMLCanvasElement,
    context!: CanvasRenderingContext2D,
    y = 0,
    currentName = '',
    playNumber = 0;
  const newPage = (continued = false) => {
    canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * 2.5);
    canvas.height = Math.ceil(height * 2.5);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('PDF drawing is unavailable in this browser.');
    context = ctx;
    context.scale(2.5, 2.5);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#617385';
    context.font = '10px Arial, sans-serif';
    context.fillText('CHALKTALK  /  SAVED PLAY', margin, 30);
    context.fillText(
      `Play ${playNumber} of ${sheets.length}`,
      width - margin - 80,
      30,
    );
    y = 58;
    context.fillStyle = '#172c40';
    context.font = 'bold 21px Arial, sans-serif';
    for (const line of wrapPrintText(
      currentName + (continued ? ' (continued)' : ''),
      contentWidth,
      (text) => context.measureText(text).width,
    )) {
      if (y > bottom - 25)
        throw new Error(
          'This play name is too long to lay out. Shorten it before exporting.',
        );
      context.fillText(line, margin, y);
      y += 26;
    }
    y += 8;
  };
  const flush = async () => {
    if (pdf.getPageCount() >= 100)
      throw new Error(
        'This export exceeds 100 pages. Choose fewer plays or omit teaching details.',
      );
    context.fillStyle = '#708090';
    context.font = '9px Arial, sans-serif';
    context.fillText(
      `ChalkTalk  |  Page ${pdf.getPageCount() + 1}`,
      margin,
      height - 20,
    );
    const image = await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.95));
    pdf
      .addPage([width, height])
      .drawImage(image, { x: 0, y: 0, width, height });
    canvas.width = 0;
    canvas.height = 0;
  };
  const text = async (value: string, bold = false, size = 11) => {
    context.font = `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
    const lines = wrapPrintText(
      value,
      contentWidth,
      (part) => context.measureText(part).width,
    );
    for (const line of lines) {
      if (y + size > bottom) {
        await flush();
        newPage(true);
      }
      context.font = `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
      context.fillStyle = bold ? '#172c40' : '#33485b';
      context.fillText(line, margin, y);
      y += size * 1.5;
    }
    y += 5;
  };
  for (const [index, sheet] of sheets.entries()) {
    onProgress(index);
    currentName = sheet.play.name;
    playNumber = index + 1;
    newPage();
    await text(
      [
        sheet.play.unit,
        sheet.play.formation,
        sheet.play.family === 'Unassigned' ? '' : sheet.play.family,
        sheet.play.concept,
      ]
        .filter(Boolean)
        .join(' / '),
      false,
      10,
    );
    if (sheet.svg) {
      const diagram = await diagramImage(sheet.svg),
        available = Math.max(
          120,
          Math.min(options.landscape ? 280 : 420, bottom - y - 30),
        ),
        imageWidth = Math.min(contentWidth, available * diagram.ratio),
        imageHeight = imageWidth / diagram.ratio;
      context.drawImage(
        diagram.image,
        margin + (contentWidth - imageWidth) / 2,
        y,
        imageWidth,
        imageHeight,
      );
      y += imageHeight + 20;
      diagram.image.src = '';
    } else {
      context.strokeStyle = '#a9b7c4';
      context.strokeRect(margin, y, contentWidth, 70);
      y += 28;
      await text('No diagram saved for this play.');
      y += 35;
    }
    if (options.notes && sheet.play.notes?.trim()) {
      await text('Coaching notes', true, 12);
      await text(sheet.play.notes);
    }
    if (options.assignments && sheet.play.assignments?.length) {
      await text('Position assignments', true, 12);
      for (const assignment of sheet.play.assignments) {
        await text(`${assignment.position}: ${assignment.title}`, true);
        if (assignment.detail) await text(assignment.detail);
      }
    }
    await flush();
  }
  onProgress(sheets.length);
  return pdf.save();
}

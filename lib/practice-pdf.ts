import { drawPrintBrand } from '@/lib/brand-print';
import {
  layoutPracticePrint,
  type PracticePlanRecord,
  type PracticePrintOptions,
} from '@/lib/practice-print';

// Native browser fonts preserve team terminology without uploading text or fonts.
export async function createPracticePdf(
  plan: PracticePlanRecord,
  teamName: string,
  options: PracticePrintOptions,
) {
  await document.fonts?.ready;
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  if (!measureContext)
    throw new Error('PDF drawing is unavailable in this browser.');
  const layout = layoutPracticePrint(
    plan,
    teamName,
    options,
    (text, size, bold) => {
      measureContext.font = `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
      return measureContext.measureText(text).width;
    },
  );
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(plan.title);
  pdf.setCreator('AllTwelve');
  pdf.setProducer('AllTwelve');
  for (const [index, page] of layout.pages.entries()) {
    const canvas = document.createElement('canvas');
    try {
      canvas.width = Math.ceil(layout.width * 2.5);
      canvas.height = Math.ceil(layout.height * 2.5);
      const context = canvas.getContext('2d');
      if (!context)
        throw new Error('PDF drawing is unavailable in this browser.');
      context.scale(2.5, 2.5);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, layout.width, layout.height);
      context.strokeStyle = '#d2d9df';
      context.lineWidth = 0.6;
      for (const y of page.rules) {
        context.beginPath();
        context.moveTo(36, y);
        context.lineTo(layout.width - 36, y);
        context.stroke();
      }
      for (const line of page.lines) {
        context.font = `${line.bold ? 'bold ' : ''}${line.size}px Arial, sans-serif`;
        context.fillStyle = line.muted ? '#526373' : '#172c40';
        context.fillText(line.text, line.x, line.y);
      }
      context.font = '9px Arial, sans-serif';
      context.fillStyle = '#526373';
      drawPrintBrand(context, 36, layout.height - 35);
      context.fillText(
        `AllTwelve  |  Saved practice  |  Page ${index + 1} of ${layout.pages.length}`,
        76,
        layout.height - 21,
      );
      const image = await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.95));
      pdf
        .addPage([layout.width, layout.height])
        .drawImage(image, {
          x: 0,
          y: 0,
          width: layout.width,
          height: layout.height,
        });
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return pdf.save();
}

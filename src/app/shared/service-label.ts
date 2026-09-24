import type { I18n } from '../core/i18n/i18n.service';
import type { MaintenanceRecord } from '../core/models/maintenance.model';
import type { Vehicle } from '../core/models/vehicle.model';

export interface ServiceLabel {
  vehicle: Vehicle;
  /** Lo hecho en esa visita: todos los registros del mismo día. */
  records: MaintenanceRecord[];
  /** El próximo mantenimiento de esas tareas, si se conoce. */
  nextKm?: number;
  nextDate?: string;
}

const WIDTH = 100;
const MARGIN = 6;
const LINE = 5;
/** Tinta que se lee bien impresa en papel blanco. */
const INK: [number, number, number] = [22, 22, 29];
const MUTED: [number, number, number] = [106, 106, 120];
const ACCENT: [number, number, number] = [163, 94, 0];

/**
 * Etiqueta en PDF de un mantenimiento, del tamaño de las pegatinas que
 * ponen los talleres (100 mm de ancho; el alto crece con los trabajos).
 * jsPDF se carga solo al pedirla, para no pesar en el arranque de la app.
 */
export async function downloadServiceLabel(label: ServiceLabel, i18n: I18n): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { vehicle, records } = label;
  const first = records[0];

  const height = Math.max(70, 58 + records.length * LINE + (hasExtras(records) ? LINE : 0));
  const doc = new jsPDF({ unit: 'mm', format: [WIDTH, height], orientation: height > WIDTH ? 'p' : 'l' });
  const number = (n: number) => new Intl.NumberFormat(i18n.locale()).format(Math.round(n));
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.locale(), { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(iso));

  // Franja superior con el color del coche.
  doc.setFillColor(...hexToRgb(vehicle.color ?? '#e74c3c'));
  doc.rect(0, 0, WIDTH, 3, 'F');

  let y = MARGIN + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT);
  doc.text(i18n.t('label.title'), MARGIN, y);

  y += 5.5;
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  const car = `${vehicle.nickname} · ${vehicle.make} ${vehicle.model}`;
  doc.text(doc.splitTextToSize(car, WIDTH - MARGIN * 2 - 24)[0], MARGIN, y);
  if (vehicle.plate) {
    doc.setFont('courier', 'bold');
    doc.text(vehicle.plate.toUpperCase(), WIDTH - MARGIN, y, { align: 'right' });
  }

  // Fecha y kilómetros de la visita, en dos columnas.
  y += 4;
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y, WIDTH - MARGIN, y);
  y += 5;
  field(doc, i18n.t('label.date'), date(first.date), MARGIN, y);
  field(doc, i18n.t('label.mileage'), `${number(first.mileage)} km`, WIDTH / 2, y);

  // Trabajos, cada uno con su marca.
  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(i18n.t('label.work').toUpperCase(), MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  for (const record of records) {
    y += LINE;
    tick(doc, MARGIN + 0.5, y - 2.6);
    doc.text(doc.splitTextToSize(record.title, WIDTH - MARGIN * 2 - 6)[0], MARGIN + 5.5, y);
  }

  // Taller y coste, si se apuntaron.
  const workshop = records.find((r) => r.workshop)?.workshop;
  const cost = records.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  if (workshop || cost) {
    y += LINE + 1;
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const parts = [
      workshop && `${i18n.t('label.workshop')}: ${workshop}`,
      cost && `${i18n.t('label.cost')}: ${number(cost)} €`,
    ].filter(Boolean);
    doc.text(doc.splitTextToSize(parts.join('   ·   '), WIDTH - MARGIN * 2)[0], MARGIN, y);
  }

  // Próximo mantenimiento, destacado abajo.
  const boxHeight = 12;
  const boxY = height - MARGIN - boxHeight;
  doc.setFillColor(248, 241, 230);
  doc.roundedRect(MARGIN, boxY, WIDTH - MARGIN * 2, boxHeight, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...ACCENT);
  doc.text(i18n.t('label.next').toUpperCase(), MARGIN + 3, boxY + 4.5);
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  const next = [
    label.nextKm !== undefined && `${number(label.nextKm)} km`,
    label.nextDate && date(label.nextDate),
  ].filter(Boolean);
  doc.text(next.length ? next.join('  ·  ') : i18n.t('label.nextUnknown'), MARGIN + 3, boxY + 9.5);

  const day = first.date.slice(0, 10);
  doc.save(`${i18n.t('label.file')}-${slug(vehicle.nickname)}-${day}.pdf`);
}

function field(doc: import('jspdf').jsPDF, label: string, value: string, x: number, y: number): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x, y);
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(value, x, y + 4.5);
}

/** Casilla marcada dibujada a mano: las fuentes del PDF no traen el ✓. */
function tick(doc: import('jspdf').jsPDF, x: number, y: number): void {
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, 3.2, 3.2, 0.5, 0.5, 'S');
  doc.line(x + 0.7, y + 1.7, x + 1.4, y + 2.4);
  doc.line(x + 1.4, y + 2.4, x + 2.6, y + 0.8);
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.2);
}

function hasExtras(records: MaintenanceRecord[]): boolean {
  return records.some((r) => r.workshop || r.cost);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function slug(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'car';
}

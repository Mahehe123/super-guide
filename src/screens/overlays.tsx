import type { Overlay } from '../lib/nav';
import { Sheet } from '../ui/Sheet';
import { ConfirmDialog, type ConfirmOpts } from '../ui/feedback';
import { KiraImportSheet } from './KiraImport';
import { EntryForm, ReceiptViewer } from './EntryForm';
import { TripDetail, TripForm, TripsSheet } from './Trips';
import { RecurringForm, RecurringSheet } from './Recurring';
import { BudgetsSheet } from './Budgets';
import { SettingsSheet } from './Settings';
import { CategoriesSheet, CategoryForm } from './Categories';
import { CurrenciesSheet } from './Currencies';
import { CsvImportSheet } from './CsvImport';

/** Maps overlay kinds to full-screen sheets and dialogs. */
export function OverlayHost({ overlays }: { overlays: Overlay[] }) {
  return (
    <>
      {overlays.map((o, i) => {
        const p = (o.props ?? {}) as Record<string, any>;
        switch (o.kind) {
          case 'entry':
            return <EntryForm key={i} id={p.id} type={p.type} />;
          case 'receipt':
            return <ReceiptViewer key={i} url={p.url} />;
          case 'confirm':
            return <ConfirmDialog key={i} {...(p as ConfirmOpts & { id: number })} />;
          case 'kira-import':
            return <KiraImportSheet key={i} />;
          case 'trips':
            return <TripsSheet key={i} />;
          case 'trip':
            return <TripDetail key={i} id={p.id} />;
          case 'trip-edit':
            return <TripForm key={i} id={p.id} />;
          case 'recurring':
            return <RecurringSheet key={i} />;
          case 'recurring-edit':
            return <RecurringForm key={i} id={p.id} from={p.from} />;
          case 'budgets':
            return <BudgetsSheet key={i} />;
          case 'settings':
            return <SettingsSheet key={i} />;
          case 'categories':
            return <CategoriesSheet key={i} />;
          case 'category-edit':
            return <CategoryForm key={i} id={p.id} type={p.type} />;
          case 'currencies':
            return <CurrenciesSheet key={i} />;
          case 'csv-import':
            return <CsvImportSheet key={i} file={p.file} />;
          default:
            return (
              <Sheet key={i} title="Hiyo" icon="back">
                <div class="empty">
                  <b>Page not found</b>
                </div>
              </Sheet>
            );
        }
      })}
    </>
  );
}

import { getTranslations } from 'next-intl/server';

export async function Footer() {
  const t = await getTranslations('common');

  return (
    <footer className="mt-auto border-t border-border bg-bg">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-2 px-4 py-6 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{t('disclaimer')}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* lightweight-charts Apache 2.0 attribution: the in-chart logo
              is disabled (see attributionLogo: false in each chart
              component) so we surface the equivalent credit here. */}
          <span>Charts powered by TradingView</span>
          <p className="tabular">
            {t('updated')} · {new Date().toISOString().slice(0, 10)}
          </p>
        </div>
      </div>
    </footer>
  );
}

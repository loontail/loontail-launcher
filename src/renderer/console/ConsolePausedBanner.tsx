import { useTranslation } from 'react-i18next';

export const ConsolePausedBanner = () => {
  const { t } = useTranslation();

  return (
    <div className="border-b border-edge bg-chip px-4 py-1.5 text-center text-eyebrow text-foreground/65">
      {t('console.pausedBanner')}
    </div>
  );
};

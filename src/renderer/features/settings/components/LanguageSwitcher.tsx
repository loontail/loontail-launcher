import { changeLanguage, type Language, SUPPORTED_LANGUAGES } from '@renderer/i18n';
import { cn } from '@renderer/shared/lib/cn';
import { GbFlagIcon } from '@renderer/shared/ui/icons/GbFlagIcon';
import { UaFlagIcon } from '@renderer/shared/ui/icons/UaFlagIcon';
import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';

type LanguageOption = {
  Flag: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
};

const LANGUAGE_OPTIONS: Record<Language, LanguageOption> = {
  en: { Flag: GbFlagIcon, label: 'EN' },
  uk: { Flag: UaFlagIcon, label: 'UA' },
};

const isLanguage = (value: string): value is Language =>
  (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

export const LanguageSwitcher = () => {
  const { i18n } = useTranslation();
  // Read i18n.language so the active highlight re-renders on switch.
  const current = isLanguage(i18n.language) ? i18n.language : 'en';

  return (
    <div className="inline-flex gap-1 rounded-full border border-edge bg-canvas p-1">
      {SUPPORTED_LANGUAGES.map((lang) => {
        const { Flag, label } = LANGUAGE_OPTIONS[lang];
        const isActive = current === lang;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => changeLanguage(lang)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              isActive ? 'bg-cta text-on-cta' : 'text-text-mute hover:text-text-hi',
            )}
          >
            <span className="inline-flex size-4 shrink-0 overflow-hidden rounded-full">
              <Flag className="size-full" />
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
};

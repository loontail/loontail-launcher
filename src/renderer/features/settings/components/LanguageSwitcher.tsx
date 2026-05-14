import {
  type Language,
  SUPPORTED_LANGUAGES,
  changeLanguage,
  getCurrentLanguage,
} from '@renderer/i18n';
import { cn } from '@renderer/shared/lib/cn';
import { GbFlagIcon } from '@renderer/shared/ui/icons/GbFlagIcon';
import { UaFlagIcon } from '@renderer/shared/ui/icons/UaFlagIcon';
import type { ComponentType, ReactElement, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';

type LanguageOption = {
  Flag: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
};

const LANGUAGE_OPTIONS: Record<Language, LanguageOption> = {
  en: { Flag: GbFlagIcon, label: 'EN' },
  uk: { Flag: UaFlagIcon, label: 'UA' },
};

export const LanguageSwitcher = (): ReactElement => {
  const { i18n } = useTranslation();
  const current = getCurrentLanguage();
  void i18n.language;

  return (
    <div className="inline-flex gap-1 rounded-full border border-border bg-background p-1">
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
              isActive
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
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

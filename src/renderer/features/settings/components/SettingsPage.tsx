import { type TabItem, Tabs } from '@renderer/shared/ui/Tabs';
import { Cpu, Gamepad2, User, Wrench } from 'lucide-react';
import { type ComponentType, type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountSection } from './sections/AccountSection';
import { GameSection } from './sections/GameSection';
import { LauncherSection } from './sections/LauncherSection';
import { SystemSection } from './sections/SystemSection';

type SettingsTab = 'account' | 'game' | 'system' | 'launcher';

const SECTION_RENDERERS: Record<SettingsTab, ComponentType> = {
  account: AccountSection,
  game: GameSection,
  system: SystemSection,
  launcher: LauncherSection,
};

export const SettingsPage = (): ReactElement => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>('account');
  const Section = SECTION_RENDERERS[tab];

  const tabs: ReadonlyArray<TabItem<SettingsTab>> = [
    { id: 'account', label: t('settings.tabs.account'), icon: User },
    { id: 'game', label: t('settings.tabs.game'), icon: Gamepad2 },
    { id: 'system', label: t('settings.tabs.system'), icon: Cpu },
    { id: 'launcher', label: t('settings.tabs.launcher'), icon: Wrench },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8">
          <Tabs tabs={tabs} selected={tab} onSelect={setTab} className="w-full" />
          <Section />
        </div>
      </div>
    </div>
  );
};

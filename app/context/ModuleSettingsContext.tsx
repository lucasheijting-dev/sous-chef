import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ModuleMode = 'lite' | 'full';

export type ModuleSettings = {
  calendar_mode: ModuleMode;
  habits_mode: ModuleMode;
  lists_enabled: boolean;
  notes_enabled: boolean;
  receipts_enabled: boolean;
  timer_enabled: boolean;
  timer_break_minutes: number;
  timer_default_minutes: number;
  onboarding_done: boolean;
  user_name: string;
  habits_onboarding_done: boolean;
  getting_started_dismissed: boolean;
  week_start: 'monday' | 'sunday';
};

const DEFAULTS: ModuleSettings = {
  calendar_mode: 'full',
  habits_mode: 'full',
  lists_enabled: true,
  notes_enabled: true,
  receipts_enabled: false,
  timer_enabled: false,
  timer_break_minutes: 5,
  timer_default_minutes: 25,
  onboarding_done: false,
  user_name: '',
  habits_onboarding_done: false,
  getting_started_dismissed: false,
  week_start: 'monday',
};

type ModuleSettingsContextType = {
  settings: ModuleSettings;
  updateSetting: <K extends keyof ModuleSettings>(key: K, value: ModuleSettings[K]) => Promise<void>;
  updateSettings: (patch: Partial<ModuleSettings>) => Promise<void>;
  isLoading: boolean;
};

const ModuleSettingsContext = createContext<ModuleSettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'module_settings_v2';

export function ModuleSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ModuleSettings>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try { setSettings({ ...DEFAULTS, ...JSON.parse(raw) }); } catch {}
      }
      setIsLoading(false);
    });
  }, []);

  async function updateSetting<K extends keyof ModuleSettings>(key: K, value: ModuleSettings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function updateSettings(patch: Partial<ModuleSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  return (
    <ModuleSettingsContext.Provider value={{ settings, updateSetting, updateSettings, isLoading }}>
      {children}
    </ModuleSettingsContext.Provider>
  );
}

export function useModuleSettings() {
  const ctx = useContext(ModuleSettingsContext);
  if (!ctx) throw new Error('useModuleSettings must be used within ModuleSettingsProvider');
  return ctx;
}

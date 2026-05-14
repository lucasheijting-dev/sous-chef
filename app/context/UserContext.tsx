import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { User, UserPrefs } from '@/lib/types';

const DEV_PIN = '2409';

const DEV_USER: User = {
  id: 'dev',
  whatsapp_number: 'dev',
  created_at: new Date().toISOString(),
};

const DEFAULT_PREFS: UserPrefs = {
  user_id: 'dev',
  habits_enabled: true,
  habits_reminder_time: '20:00:00',
  suggestions_enabled: true,
  suggestions_frequency: 'weekly',
};

type UserContextType = {
  user: User | null;
  prefs: UserPrefs | null;
  isLoading: boolean;
  setWhatsAppNumber: (number: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshPrefs: () => Promise<void>;
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    try {
      const storedNumber = await AsyncStorage.getItem('whatsapp_number');
      if (storedNumber === DEV_PIN) {
        setUser(DEV_USER);
        setPrefs(DEFAULT_PREFS);
      } else if (storedNumber) {
        await fetchUser(storedNumber);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchUser(whatsappNumber: string): Promise<boolean> {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('whatsapp_number', whatsappNumber)
      .single();

    if (data) {
      setUser(data);
      await fetchPrefs(data.id);
      return true;
    }
    return false;
  }

  async function fetchPrefs(userId: string) {
    const { data } = await supabase
      .from('user_prefs')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (data) setPrefs(data);
  }

  async function setWhatsAppNumber(number: string): Promise<boolean> {
    if (number === DEV_PIN) {
      await AsyncStorage.setItem('whatsapp_number', DEV_PIN);
      setUser(DEV_USER);
      setPrefs(DEFAULT_PREFS);
      return true;
    }

    const normalized = number.trim().replace(/^\+/, '').replace(/\s/g, '');

    // Try existing user first (fast Supabase lookup)
    const found = await fetchUser(normalized);
    if (found) {
      await AsyncStorage.setItem('whatsapp_number', normalized);
      return true;
    }

    // New user — register via backend (creates user + sends welcome WhatsApp)
    try {
      const apiBase = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';
      const res = await fetch(`${apiBase}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsapp_number: normalized }),
      });
      if (!res.ok) return false;
      const { user: newUser } = await res.json();
      if (!newUser) return false;
      setUser(newUser);
      await AsyncStorage.setItem('whatsapp_number', normalized);
      return true;
    } catch {
      return false;
    }
  }

  async function logout() {
    await AsyncStorage.removeItem('whatsapp_number');
    setUser(null);
    setPrefs(null);
  }

  async function refreshPrefs() {
    if (user) await fetchPrefs(user.id);
  }

  return (
    <UserContext.Provider value={{ user, prefs, isLoading, setWhatsAppNumber, logout, refreshPrefs }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}

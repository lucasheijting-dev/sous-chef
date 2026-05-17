export type User = {
  id: string;
  whatsapp_number: string;
  created_at: string;
};

export type UserPrefs = {
  user_id: string;
  habits_enabled: boolean;
  habits_reminder_time: string;
  suggestions_enabled: boolean;
  suggestions_frequency: 'daily' | 'weekly' | 'never';
};

export type List = {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  sort_order: number;
  created_at: string;
  list_type?: 'checklist' | 'links' | 'tips';
};

export type ListItem = {
  id: string;
  list_id: string;
  text: string;
  checked: boolean;
  created_at: string;
};

export type Note = {
  id: string;
  user_id: string;
  title: string | null;
  body: string;
  created_at: string;
};

export type CalEvent = {
  id: string;
  user_id: string;
  title: string;
  date: string | null;
  time: string | null;
  recurrence: 'yearly' | 'monthly' | 'weekly' | null;
  reminder_days_before: number;
  created_at: string;
};

export type Habit = {
  id: string;
  user_id: string;
  name: string;
  mini_goal: string;
  good_goal: string;
  elite_goal: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type HabitLog = {
  id: string;
  habit_id: string;
  user_id: string;
  date: string;
  level: 'mini' | 'good' | 'elite';
  logged_at: string;
};

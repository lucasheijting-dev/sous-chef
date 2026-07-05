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
  image_url?: string | null;
  list_item_sources?: { recipe_id: string; recipes: { title: string } | null }[];
};

export type Note = {
  id: string;
  user_id: string;
  title: string | null;
  body: string;
  created_at: string;
  updated_at?: string;
  image_url?: string | null;
  category_id?: string | null;
};

export type NoteCategory = {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  color: string;
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
  level: 'mini' | 'good' | 'elite' | 'not_done' | 'skip';
  logged_at: string;
};

export type HabitGoal = {
  id: string;
  user_id: string;
  habit_id: string;
  period: 'month' | 'year';
  goal_type: 'frequency' | 'elite_count';
  target: number;
  created_at: string;
  habits?: {
    id: string;
    name: string;
    mini_goal: string | null;
    good_goal: string | null;
    elite_goal: string | null;
  };
};

export type NotifPrefs = {
  weekoverzicht?: { enabled: boolean };
  habit_herinnering?: { enabled: boolean };
  afspraak_herinnering?: { enabled: boolean };
  verjaardag_herinnering?: { enabled: boolean };
  wekelijkse_suggesties?: { enabled: boolean };
  agenda_sync_waarschuwing?: { enabled: boolean };
};

export type TimerCategory = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
};

export type TimerSession = {
  id: string;
  user_id: string;
  category_id: string | null;
  task_name: string | null;
  planned_duration: number;
  actual_duration: number | null;
  status: 'running' | 'completed' | 'abandoned';
  mood_score: number | null;
  reflection_note: string | null;
  abandon_reason: 'distraction' | 'too_long' | 'done' | 'other' | null;
  abandon_note: string | null;
  started_at: string;
  ended_at: string | null;
};

export type TimerBreak = {
  id: string;
  session_id: string;
  planned_duration: number;
  actual_duration: number | null;
  started_at: string;
  ended_at: string | null;
};

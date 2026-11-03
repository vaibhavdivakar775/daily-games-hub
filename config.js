// Supabase project that holds the leaderboard (free plan, Mumbai region).
// The anon key is the PUBLIC key, meant to be in website code: what it can do is limited by the
// security rules in supabase/schema.sql (read scores; post sensible scores for recent dates).
// Leave SUPABASE_URL empty to run in DEMO MODE (data stays in this browser, with fake friends).
export const SUPABASE_URL = 'https://vrlcdwzailluiboagkte.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZybGNkd3phaWxsdWlib2Fna3RlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2ODUxODIsImV4cCI6MjEwOTI2MTE4Mn0.N7NrXphC5y93hvmAzDdqaJtL2tS46ZT7Id6kpLN03ck';

// Everyone using this site shares one leaderboard under this name (players never see it).
// Change it only if you want to start a fresh leaderboard.
export const GROUP = 'squad';

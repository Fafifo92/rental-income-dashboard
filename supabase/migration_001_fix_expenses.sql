-- Migration 001: Fix expenses table
-- ► Run this in your Supabase Dashboard → SQL Editor → New query
-- Safe to run: it drops the incorrectly-structured table and recreates it.
-- (There is no real data to lose yet.)

-- Drop old table (wrong schema — missing category column)
DROP TABLE IF EXISTS expenses CASCADE;

-- Recreate with correct schema:
-- owner_id    → direct user link for RLS (auto-filled by Supabase via DEFAULT auth.uid())
-- property_id → optional FK — expenses can exist without being tied to a property
CREATE TABLE expenses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL DEFAULT auth.uid(),
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  category    TEXT NOT NULL,
  type        TEXT CHECK (type IN ('fixed', 'variable')) NOT NULL DEFAULT 'variable',
  amount      NUMERIC(12, 2) NOT NULL,
  currency    TEXT DEFAULT 'COP',
  date        DATE NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'partial')),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Users can only see and edit their own expenses
CREATE POLICY "Users manage own expenses"
  ON expenses FOR ALL USING (auth.uid() = owner_id);

-- Table to store Web Push subscriptions for operators/admins
CREATE TABLE IF NOT EXISTS public.admin_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.admin_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop any old policies first (safe to run multiple times)
DROP POLICY IF EXISTS "Allow public insert and read for push subscriptions" ON public.admin_push_subscriptions;
DROP POLICY IF EXISTS "Allow anon insert" ON public.admin_push_subscriptions;
DROP POLICY IF EXISTS "Allow anon read" ON public.admin_push_subscriptions;

-- Allow the browser (anon key) to INSERT/UPSERT its own subscription
CREATE POLICY "anon can upsert push subscriptions"
ON public.admin_push_subscriptions
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Allow the browser to UPDATE its own subscription (upsert path)
CREATE POLICY "anon can update push subscriptions"
ON public.admin_push_subscriptions
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Service role bypasses RLS automaticallyno SELECT policy needed for server reads.
-- But add one so the anon key can also read (useful for debugging in Supabase UI):
CREATE POLICY "anon can read push subscriptions"
ON public.admin_push_subscriptions
FOR SELECT
TO anon, authenticated
USING (true);

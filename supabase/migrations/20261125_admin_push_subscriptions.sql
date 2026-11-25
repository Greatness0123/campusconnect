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

-- Enable Row Level Security (RLS)
ALTER TABLE public.admin_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow anon insert and read for operator registration
CREATE POLICY "Allow public insert and read for push subscriptions"
ON public.admin_push_subscriptions
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

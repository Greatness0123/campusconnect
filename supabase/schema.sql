-- =========================================================
-- Campus Prints - Supabase Database & Storage Setup
-- =========================================================

-- 1. Device Sessions Table
-- Stores user identity linked to their device session ID
CREATE TABLE IF NOT EXISTS public.device_sessions (
    device_id TEXT PRIMARY KEY,
    user_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    device_id TEXT,
    status TEXT NOT NULL DEFAULT 'New', -- 'New', 'Printing', 'Ready', 'Completed'
    total_amount NUMERIC NOT NULL DEFAULT 0,
    pickup_area TEXT NOT NULL,
    pickup_location TEXT NOT NULL,
    print_mode TEXT NOT NULL,
    sides TEXT NOT NULL,
    stapling TEXT NOT NULL,
    binding TEXT NOT NULL,
    copies INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Order Documents Table
CREATE TABLE IF NOT EXISTS public.order_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT REFERENCES public.orders(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    total_pages INTEGER NOT NULL DEFAULT 1,
    color_pages INTEGER NOT NULL DEFAULT 0,
    bw_pages INTEGER NOT NULL DEFAULT 1,
    selected_pages TEXT DEFAULT 'all',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Keep-Alive Heartbeat Table
-- Pinged 3 times daily to ensure project stays active and never pauses
CREATE TABLE IF NOT EXISTS public.keep_alive (
    id SERIAL PRIMARY KEY,
    service_name TEXT NOT NULL DEFAULT 'campus-prints',
    pinged_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'ok'
);

-- Ensure a row exists for easy updates
INSERT INTO public.keep_alive (id, service_name, pinged_at, status)
VALUES (1, 'campus-prints', NOW(), 'ok')
ON CONFLICT (id) DO NOTHING;

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keep_alive ENABLE ROW LEVEL SECURITY;

-- Anonymous public policies for customer flow (insert & read their own or all orders for demo admin)
CREATE POLICY "Public can upsert device_sessions" ON public.device_sessions
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public can insert orders" ON public.orders
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can read orders" ON public.orders
    FOR SELECT USING (true);

CREATE POLICY "Public can update orders status" ON public.orders
    FOR UPDATE USING (true);

CREATE POLICY "Public can insert documents" ON public.order_documents
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can read documents" ON public.order_documents
    FOR SELECT USING (true);

CREATE POLICY "Public can ping keep_alive" ON public.keep_alive
    FOR ALL USING (true) WITH CHECK (true);

-- 6. Enable Realtime on Orders Table
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;

-- 7. Supabase Storage: Create Private Bucket for print documents
-- Run this in Supabase Dashboard -> Storage -> Create new bucket 'print-documents' (Private)
-- or execute:
INSERT INTO storage.buckets (id, name, public) 
VALUES ('print-documents', 'print-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies:
CREATE POLICY "Anyone can upload print documents" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'print-documents');

CREATE POLICY "Anyone with order access can read documents" ON storage.objects
    FOR SELECT USING (bucket_id = 'print-documents');

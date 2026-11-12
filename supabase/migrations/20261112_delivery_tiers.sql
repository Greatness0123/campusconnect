-- =========================================================
-- Delivery tiers (Standard / Express) + night-rate pricing
-- Run this against an existing database that predates these columns.
-- New databases created from schema.sql already include them.
-- =========================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_option TEXT; -- 'standard' | 'express' (NULL = collection)

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC NOT NULL DEFAULT 0; -- ₦200 express, 0 otherwise

CREATE SEQUENCE IF NOT EXISTS public.order_id_sequence START WITH 1;

CREATE OR REPLACE FUNCTION public.next_order_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    next_number BIGINT;
    generated_id TEXT;
BEGIN
    LOOP
        next_number := nextval('public.order_id_sequence');
        generated_id := 'CP-' || CASE
            WHEN next_number < 10000 THEN LPAD(next_number::TEXT, 4, '0')
            ELSE next_number::TEXT
        END;
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.orders WHERE id = generated_id
        );
    END LOOP;
    RETURN generated_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_order_id() TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'order_documents_file_path_nonempty'
          AND conrelid = 'public.order_documents'::regclass
    ) THEN
        ALTER TABLE public.order_documents
            ADD CONSTRAINT order_documents_file_path_nonempty
            CHECK (length(btrim(file_path)) > 0) NOT VALID;
    END IF;
END;
$$;
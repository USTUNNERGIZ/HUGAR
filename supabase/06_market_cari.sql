-- HUGAR Market cari modülü. Önce veritabanı yedeği alın. Mevcut finance_* verilerini değiştirmez.
BEGIN;
CREATE TABLE IF NOT EXISTS public.hugar_market_suppliers (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 group_id bigint NOT NULL DEFAULT 1 CHECK (group_id = 1),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
 opening_debt numeric(16,2) NOT NULL DEFAULT 0 CHECK (opening_debt >= 0),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(group_id,name)
);
CREATE TABLE IF NOT EXISTS public.hugar_market_invoices (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 supplier_id bigint NOT NULL REFERENCES public.hugar_market_suppliers(id),
 invoice_date date NOT NULL, invoice_no text NOT NULL DEFAULT '', amount numeric(16,2) NOT NULL CHECK (amount > 0),
 note text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.hugar_market_tasks (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 supplier_id bigint NOT NULL REFERENCES public.hugar_market_suppliers(id),
 due_date date NOT NULL, planned_amount numeric(16,2) NOT NULL CHECK (planned_amount > 0),
 planned_method text NOT NULL CHECK (planned_method IN ('cash','card','bank')),
 note text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.hugar_market_payments (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 supplier_id bigint NOT NULL REFERENCES public.hugar_market_suppliers(id),
 task_id bigint REFERENCES public.hugar_market_tasks(id),
 paid_on date NOT NULL, amount numeric(16,2) NOT NULL CHECK (amount > 0),
 method text NOT NULL CHECK (method IN ('cash','card','bank')),
 account_note text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.hugar_market_task_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 task_id bigint NOT NULL REFERENCES public.hugar_market_tasks(id),
 status text NOT NULL CHECK (status IN ('partial','paid','failed','overpaid')),
 note text NOT NULL DEFAULT '', actor uuid NOT NULL REFERENCES auth.users(id), at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.hugar_market_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 entity text NOT NULL, entity_id bigint NOT NULL, action text NOT NULL,
 before_data jsonb, after_data jsonb, actor uuid NOT NULL REFERENCES auth.users(id), at timestamptz NOT NULL DEFAULT now()
);
-- Tabloya doğrudan erişim yok. Yalnızca kontrol edilmiş RPC'ler kullanılır.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['hugar_market_suppliers','hugar_market_invoices','hugar_market_tasks','hugar_market_payments','hugar_market_task_events','hugar_market_audit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.hugar_market_access(p_write boolean DEFAULT false, p_admin boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.finance_user_roles r WHERE r.user_id = (SELECT auth.uid())
 AND (r.role='admin' OR (NOT p_admin AND r.role='employee' AND r.username='iso')));
$$;
REVOKE ALL ON FUNCTION public.hugar_market_access(boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hugar_market_access(boolean,boolean) TO authenticated;
-- Bu fonksiyon yalnızca cari modülünün verilerini döndürür. Gelir, genel hesap veya diğer işletmeler yok.
CREATE OR REPLACE FUNCTION public.hugar_market_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.hugar_market_access(false,false) THEN RAISE EXCEPTION 'Yetkisiz' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
 'suppliers',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name) FROM public.hugar_market_suppliers s), '[]'::jsonb),
 'invoices',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.invoice_date DESC,i.id DESC) FROM public.hugar_market_invoices i), '[]'::jsonb),
 'payments',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.paid_on DESC,p.id DESC) FROM public.hugar_market_payments p), '[]'::jsonb),
 'tasks',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.due_date,t.id) FROM public.hugar_market_tasks t), '[]'::jsonb),
 'events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.at,e.id) FROM public.hugar_market_task_events e), '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.hugar_market_read() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hugar_market_read() TO authenticated;
CREATE OR REPLACE FUNCTION public.hugar_market_write(p_action text,p_data jsonb)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint; v_supplier bigint; v_task bigint; v_amount numeric; v_before jsonb; v_after jsonb;
 v_uid uuid := auth.uid(); v_admin boolean; v_status text; v_paid numeric; v_plan numeric;
BEGIN
 IF NOT public.hugar_market_access(true,false) THEN RAISE EXCEPTION 'Yetkisiz' USING ERRCODE='42501'; END IF;
 v_admin := public.hugar_market_access(true,true);
 IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR length(p_data::text)>6000 THEN RAISE EXCEPTION 'Geçersiz veri'; END IF;
 IF p_action='supplier_add' THEN
  IF NOT v_admin THEN RAISE EXCEPTION 'Firma ve açılış borcunu yalnızca yönetici oluşturur' USING ERRCODE='42501'; END IF;
  INSERT INTO public.hugar_market_suppliers(name,opening_debt,created_by)
  VALUES (btrim(p_data->>'name'),(p_data->>'opening_debt')::numeric,v_uid) RETURNING id INTO v_id;
 ELSIF p_action='invoice_add' THEN
  v_supplier := (p_data->>'supplier_id')::bigint;
  IF NOT EXISTS (SELECT 1 FROM public.hugar_market_suppliers WHERE id=v_supplier) THEN RAISE EXCEPTION 'Firma bulunamadı'; END IF;
  INSERT INTO public.hugar_market_invoices(supplier_id,invoice_date,invoice_no,amount,note,created_by)
  VALUES (v_supplier,(p_data->>'invoice_date')::date,left(coalesce(p_data->>'invoice_no',''),100),
  (p_data->>'amount')::numeric,left(coalesce(p_data->>'note',''),500),v_uid) RETURNING id INTO v_id;
 ELSIF p_action='invoice_edit' THEN
  v_id := (p_data->>'id')::bigint;
  SELECT to_jsonb(i) INTO v_before FROM public.hugar_market_invoices i WHERE i.id=v_id FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Fatura bulunamadı'; END IF;
  v_supplier := (p_data->>'supplier_id')::bigint;
  IF NOT EXISTS (SELECT 1 FROM public.hugar_market_suppliers WHERE id=v_supplier) THEN RAISE EXCEPTION 'Firma bulunamadı'; END IF;
  UPDATE public.hugar_market_invoices SET supplier_id=v_supplier,invoice_date=(p_data->>'invoice_date')::date,
   invoice_no=left(coalesce(p_data->>'invoice_no',''),100),amount=(p_data->>'amount')::numeric,
   note=left(coalesce(p_data->>'note',''),500),updated_at=now() WHERE id=v_id;
 ELSIF p_action='task_add' THEN
  IF NOT v_admin THEN RAISE EXCEPTION 'Görevi yalnızca yönetici planlar' USING ERRCODE='42501'; END IF;
  v_supplier := (p_data->>'supplier_id')::bigint;
  IF NOT EXISTS (SELECT 1 FROM public.hugar_market_suppliers WHERE id=v_supplier) THEN RAISE EXCEPTION 'Firma bulunamadı'; END IF;
  INSERT INTO public.hugar_market_tasks(supplier_id,due_date,planned_amount,planned_method,note,created_by)
  VALUES(v_supplier,(p_data->>'due_date')::date,(p_data->>'planned_amount')::numeric,p_data->>'planned_method',left(coalesce(p_data->>'note',''),500),v_uid) RETURNING id INTO v_id;
 ELSIF p_action='payment_add' THEN
  v_supplier := (p_data->>'supplier_id')::bigint;
  v_task := nullif(p_data->>'task_id','')::bigint;
  v_amount := (p_data->>'amount')::numeric;
  IF NOT EXISTS (SELECT 1 FROM public.hugar_market_suppliers WHERE id=v_supplier) THEN RAISE EXCEPTION 'Firma bulunamadı'; END IF;
  IF v_task IS NOT NULL THEN
   SELECT planned_amount INTO v_plan FROM public.hugar_market_tasks WHERE id=v_task AND supplier_id=v_supplier FOR UPDATE;
   IF v_plan IS NULL THEN RAISE EXCEPTION 'Görev-firma eşleşmiyor'; END IF;
  END IF;
  INSERT INTO public.hugar_market_payments(supplier_id,task_id,paid_on,amount,method,account_note,note,created_by)
  VALUES(v_supplier,v_task,(p_data->>'paid_on')::date,v_amount,p_data->>'method',
   left(coalesce(p_data->>'account_note',''),160),left(coalesce(p_data->>'note',''),500),v_uid) RETURNING id INTO v_id;
  IF v_task IS NOT NULL THEN
   SELECT coalesce(sum(amount),0) INTO v_paid FROM public.hugar_market_payments WHERE task_id=v_task;
   v_status := CASE WHEN v_paid>v_plan THEN 'overpaid' WHEN v_paid=v_plan THEN 'paid' ELSE 'partial' END;
   INSERT INTO public.hugar_market_task_events(task_id,status,note,actor)
   VALUES(v_task,v_status,left(coalesce(p_data->>'note',''),500),v_uid);
  END IF;
 ELSIF p_action='task_failed' THEN
  v_task := (p_data->>'task_id')::bigint;
  IF NOT EXISTS (SELECT 1 FROM public.hugar_market_tasks WHERE id=v_task) THEN RAISE EXCEPTION 'Görev bulunamadı'; END IF;
  INSERT INTO public.hugar_market_task_events(task_id,status,note,actor)
  VALUES(v_task,'failed',left(coalesce(p_data->>'note',''),500),v_uid) RETURNING id INTO v_id;
 ELSE RAISE EXCEPTION 'Bilinmeyen işlem'; END IF;
 IF p_action='invoice_edit' THEN SELECT to_jsonb(i) INTO v_after FROM public.hugar_market_invoices i WHERE id=v_id;
 ELSIF p_action='invoice_add' THEN SELECT to_jsonb(i) INTO v_after FROM public.hugar_market_invoices i WHERE id=v_id;
 ELSIF p_action='supplier_add' THEN SELECT to_jsonb(s) INTO v_after FROM public.hugar_market_suppliers s WHERE id=v_id;
 ELSIF p_action='task_add' THEN SELECT to_jsonb(t) INTO v_after FROM public.hugar_market_tasks t WHERE id=v_id;
 ELSIF p_action='payment_add' THEN SELECT to_jsonb(p) INTO v_after FROM public.hugar_market_payments p WHERE id=v_id;
 ELSE SELECT to_jsonb(e) INTO v_after FROM public.hugar_market_task_events e WHERE id=v_id; END IF;
 INSERT INTO public.hugar_market_audit(entity,entity_id,action,before_data,after_data,actor)
 VALUES(split_part(p_action,'_',1),v_id,p_action,v_before,v_after,v_uid);
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.hugar_market_write(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hugar_market_write(text,jsonb) TO authenticated;
COMMIT;
-- Eski finans tablolarındaki olası başka izinler olsa bile iso bu tablolara erişemez.
BEGIN;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['finance_groups','finance_categories','finance_accounts','finance_parties','finance_documents','finance_movements'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS hugar_legacy_admin_only ON public.%I',t);
  EXECUTE format('CREATE POLICY hugar_legacy_admin_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.hugar_market_access(false,true)) WITH CHECK (public.hugar_market_access(false,true))',t);
 END LOOP;
END $$;
COMMIT;

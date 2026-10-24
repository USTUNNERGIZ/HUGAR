-- HUGAR V7: Kalıcı hesap/kategori ve Market ödemelerinde tekil hesap bağlantısı.
-- SQL Editor'da önce mevcut veritabanı yedeğini alın. Mevcut kayıtları silmez.
BEGIN;
CREATE TABLE IF NOT EXISTS public.hugar_market_accounts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 group_id bigint NOT NULL DEFAULT 1 CHECK (group_id=1),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
 kind text NOT NULL CHECK (kind IN ('cash','bank','card')),
 opening_balance numeric(16,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(group_id,name)
);
ALTER TABLE public.hugar_market_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hugar_market_accounts FROM PUBLIC,anon,authenticated;
ALTER TABLE public.hugar_market_payments ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES public.hugar_market_accounts(id);
ALTER TABLE public.hugar_market_payments ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS hugar_market_payments_request_unique ON public.hugar_market_payments(request_id) WHERE request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.hugar_expense_categories (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 group_id bigint NOT NULL REFERENCES public.finance_groups(id),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(group_id,name)
);
ALTER TABLE public.hugar_expense_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hugar_expense_categories FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.hugar_categories_read(p_group_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.hugar_market_access(false,true) THEN RAISE EXCEPTION 'Yönetici gerekli' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM public.hugar_expense_categories WHERE group_id=p_group_id),'[]'::jsonb);
END;$$;
CREATE OR REPLACE FUNCTION public.hugar_categories_add(p_group_id bigint,p_name text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id bigint;
BEGIN
 IF NOT public.hugar_market_access(false,true) THEN RAISE EXCEPTION 'Yönetici gerekli' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Kategori adı geçersiz'; END IF;
 INSERT INTO public.hugar_expense_categories(group_id,name,created_by) VALUES(p_group_id,btrim(p_name),auth.uid())
 ON CONFLICT (group_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id INTO v_id;
 RETURN v_id;
END;$$;
-- Eski finans hesapları için mevcut şemadaki zorunlu alanları kullanan yönetici ekleme fonksiyonu.
CREATE OR REPLACE FUNCTION public.hugar_finance_account_add(p_group_id bigint,p_name text,p_type text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id bigint;
BEGIN
 IF NOT public.hugar_market_access(false,true) THEN RAISE EXCEPTION 'Yönetici gerekli' USING ERRCODE='42501'; END IF;
 IF p_type NOT IN ('cash','bank') OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Hesap bilgisi geçersiz'; END IF;
 INSERT INTO public.finance_accounts(group_id,name,account_type,opening_date)
 VALUES(p_group_id,btrim(p_name),p_type,current_date) RETURNING id INTO v_id;
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.hugar_market_read_v2()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_base jsonb;
BEGIN
 IF NOT public.hugar_market_access(false,false) THEN RAISE EXCEPTION 'Yetkisiz' USING ERRCODE='42501'; END IF;
 v_base:=public.hugar_market_read();
 RETURN v_base || jsonb_build_object('accounts',COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'opening_balance',a.opening_balance,
   'balance',CASE WHEN a.kind='card' THEN a.opening_balance+COALESCE((SELECT SUM(p.amount) FROM public.hugar_market_payments p WHERE p.account_id=a.id),0)
                  ELSE a.opening_balance-COALESCE((SELECT SUM(p.amount) FROM public.hugar_market_payments p WHERE p.account_id=a.id),0) END)
   ORDER BY a.name) FROM public.hugar_market_accounts a),'[]'::jsonb));
END;$$;

-- Eski yazma fonksiyonu authenticated için kapatılır; tüm yeni çağrılar kontrol edilen V2'ye yönlenir.
CREATE OR REPLACE FUNCTION public.hugar_market_write_v2(p_action text,p_data jsonb)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id bigint; v_account bigint; v_kind text; v_request uuid; v_amount numeric;
BEGIN
 IF NOT public.hugar_market_access(true,false) THEN RAISE EXCEPTION 'Yetkisiz' USING ERRCODE='42501'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR length(p_data::text)>6000 THEN RAISE EXCEPTION 'Geçersiz veri'; END IF;
 IF p_action='account_add' THEN
  IF NOT public.hugar_market_access(true,true) THEN RAISE EXCEPTION 'Hesabı yalnızca yönetici ekler' USING ERRCODE='42501'; END IF;
  IF p_data->>'kind' NOT IN ('cash','bank','card') OR length(btrim(coalesce(p_data->>'name',''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Hesap bilgisi geçersiz'; END IF;
  INSERT INTO public.hugar_market_accounts(name,kind,opening_balance,created_by)
  VALUES(btrim(p_data->>'name'),p_data->>'kind',(p_data->>'opening_balance')::numeric,auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.hugar_market_audit(entity,entity_id,action,after_data,actor)
  VALUES('account',v_id,'account_add',(SELECT to_jsonb(a) FROM public.hugar_market_accounts a WHERE a.id=v_id),auth.uid());
  RETURN v_id;
 END IF;
 IF p_action='payment_add' THEN
  v_account:=(p_data->>'account_id')::bigint;
  v_request:=(p_data->>'request_id')::uuid;
  v_amount:=(p_data->>'amount')::numeric;
  IF v_request IS NULL OR v_account IS NULL OR v_amount IS NULL OR v_amount<=0 THEN RAISE EXCEPTION 'Hesap, istek kimliği ve tutar zorunlu'; END IF;
  SELECT kind INTO v_kind FROM public.hugar_market_accounts WHERE id=v_account;
  IF v_kind IS NULL OR v_kind IS DISTINCT FROM p_data->>'method' THEN RAISE EXCEPTION 'Ödeme yöntemi ile hesap türü uyuşmuyor'; END IF;
  -- Aynı isteğin tekrar kaydedilmesini engellemek için işlem boyunca advisory lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_request::text,0));
  SELECT id INTO v_id FROM public.hugar_market_payments WHERE request_id=v_request;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_id:=public.hugar_market_write('payment_add',p_data || jsonb_build_object('account_note',(SELECT name FROM public.hugar_market_accounts WHERE id=v_account)));
  UPDATE public.hugar_market_payments SET account_id=v_account,request_id=v_request WHERE id=v_id;
  RETURN v_id;
 END IF;
 RETURN public.hugar_market_write(p_action,p_data);
END;$$;
DO $$ DECLARE sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY[
 'hugar_categories_read(bigint)','hugar_categories_add(bigint,text)',
 'hugar_finance_account_add(bigint,text,text)','hugar_market_read_v2()',
 'hugar_market_write_v2(text,jsonb)'] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon',sig);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated',sig);
 END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.hugar_market_write(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;

-- HUGAR v8: cari iptali, hesap bakiyesi düzeltmesi, genel bakışa güvenli özet.
-- Yalnızca mevcut Market Cari tabloları; eski finance_* hareketlerini DEĞİŞTİRMEZ.
BEGIN;
ALTER TABLE public.hugar_market_invoices ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.hugar_market_invoices ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id);
ALTER TABLE public.hugar_market_invoices ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.hugar_market_payments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.hugar_market_payments ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id);
ALTER TABLE public.hugar_market_payments ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.hugar_market_tasks ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.hugar_market_tasks ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id);
ALTER TABLE public.hugar_market_tasks ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE OR REPLACE FUNCTION public.hugar_market_summary_v3()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_open numeric;v_net numeric;v_advance numeric;v_inv numeric;v_pay numeric;v_cash numeric;v_card numeric;v_count integer;
BEGIN
 IF NOT public.hugar_market_access(false,true) THEN RAISE EXCEPTION 'Yönetici gerekli' USING ERRCODE='42501'; END IF;
 WITH balances AS (
  SELECT s.id, s.opening_debt
   + COALESCE((SELECT SUM(i.amount) FROM public.hugar_market_invoices i WHERE i.supplier_id=s.id AND i.cancelled_at IS NULL),0)
   - COALESCE((SELECT SUM(p.amount) FROM public.hugar_market_payments p WHERE p.supplier_id=s.id AND p.cancelled_at IS NULL),0) AS bal
  FROM public.hugar_market_suppliers s
 ) SELECT COALESCE(SUM(GREATEST(bal,0)),0),COALESCE(SUM(bal),0),COALESCE(SUM(GREATEST(-bal,0)),0)
 INTO v_open,v_net,v_advance FROM balances;
 SELECT COALESCE(SUM(amount),0) INTO v_inv FROM public.hugar_market_invoices WHERE cancelled_at IS NULL;
 SELECT COALESCE(SUM(amount),0) INTO v_pay FROM public.hugar_market_payments WHERE cancelled_at IS NULL;
 SELECT COALESCE(SUM(CASE WHEN a.kind IN ('cash','bank') THEN a.opening_balance-COALESCE(p.paid,0) ELSE 0 END),0),
        COALESCE(SUM(CASE WHEN a.kind='card' THEN a.opening_balance+COALESCE(p.paid,0) ELSE 0 END),0), COUNT(*)
 INTO v_cash,v_card,v_count FROM public.hugar_market_accounts a
 LEFT JOIN (SELECT account_id,SUM(amount) paid FROM public.hugar_market_payments WHERE cancelled_at IS NULL GROUP BY account_id) p ON p.account_id=a.id;
 RETURN jsonb_build_object('open_debt',v_open,'net_debt',v_net,'advance',v_advance,'invoices',v_inv,'payments',v_pay,'cash_balance',v_cash,'card_debt',v_card,'accounts_count',v_count);
END;$$;

CREATE OR REPLACE FUNCTION public.hugar_market_read_v3()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
 IF NOT public.hugar_market_access(false,false) THEN RAISE EXCEPTION 'Yetkisiz' USING ERRCODE='42501'; END IF;
 v_result:=public.hugar_market_read_v2();
 RETURN v_result || jsonb_build_object(
  'invoices',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.invoice_date DESC,i.id DESC) FROM public.hugar_market_invoices i WHERE i.cancelled_at IS NULL),'[]'::jsonb),
  'payments',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.paid_on DESC,p.id DESC) FROM public.hugar_market_payments p WHERE p.cancelled_at IS NULL),'[]'::jsonb),
  'tasks',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.due_date,t.id) FROM public.hugar_market_tasks t WHERE t.cancelled_at IS NULL),'[]'::jsonb),
  'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'opening_balance',a.opening_balance,
    'balance',CASE WHEN a.kind='card' THEN a.opening_balance+COALESCE(p.paid,0) ELSE a.opening_balance-COALESCE(p.paid,0) END) ORDER BY a.name)
    FROM public.hugar_market_accounts a LEFT JOIN (SELECT account_id,SUM(amount) paid FROM public.hugar_market_payments WHERE cancelled_at IS NULL GROUP BY account_id) p ON p.account_id=a.id),'[]'::jsonb));
END;$$;

CREATE OR REPLACE FUNCTION public.hugar_market_write_v3(p_action text,p_data jsonb)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id bigint;v_before jsonb;v_after jsonb;v_reason text;v_table text;v_entity text;
BEGIN
 IF NOT public.hugar_market_access(true,false) THEN RAISE EXCEPTION 'Yetkisiz' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('invoice_cancel','payment_cancel','task_cancel') THEN
  RETURN public.hugar_market_write_v2(p_action,p_data);
 END IF;
 -- İptal işlemleri sadece SABRI kullanıcı adına sahip yönetici tarafından yapılır.
 IF NOT public.hugar_market_access(true,true) OR NOT EXISTS (
   SELECT 1 FROM public.finance_user_roles r WHERE r.user_id=auth.uid() AND r.role='admin' AND r.username='sabri'
 ) THEN RAISE EXCEPTION 'İptal yalnızca sabri hesabına açıktır' USING ERRCODE='42501'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR length(p_data::text)>6000 THEN RAISE EXCEPTION 'Geçersiz veri'; END IF;
 v_id:=(p_data->>'id')::bigint;
 v_reason:=btrim(COALESCE(p_data->>'reason',''));
 IF v_id IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'En az 3 karakterlik iptal gerekçesi gerekli'; END IF;
 IF p_action='invoice_cancel' THEN
  SELECT to_jsonb(i) INTO v_before FROM public.hugar_market_invoices i WHERE id=v_id AND cancelled_at IS NULL FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Fatura bulunamadı veya zaten iptal'; END IF;
  UPDATE public.hugar_market_invoices SET cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=v_reason,updated_at=now() WHERE id=v_id;
  SELECT to_jsonb(i) INTO v_after FROM public.hugar_market_invoices i WHERE id=v_id;
  v_entity:='invoice';
 ELSIF p_action='payment_cancel' THEN
  SELECT to_jsonb(p) INTO v_before FROM public.hugar_market_payments p WHERE id=v_id AND cancelled_at IS NULL FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Ödeme bulunamadı veya zaten iptal'; END IF;
  UPDATE public.hugar_market_payments SET cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=v_reason WHERE id=v_id;
  SELECT to_jsonb(p) INTO v_after FROM public.hugar_market_payments p WHERE id=v_id;
  v_entity:='payment';
 ELSIF p_action='task_cancel' THEN
  SELECT to_jsonb(t) INTO v_before FROM public.hugar_market_tasks t WHERE id=v_id AND cancelled_at IS NULL FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Görev bulunamadı veya zaten iptal'; END IF;
  IF EXISTS(SELECT 1 FROM public.hugar_market_payments p WHERE p.task_id=v_id AND p.cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'Ödenmiş görev iptal edilemez; önce ilgili ödemeyi iptal edin';
  END IF;
  UPDATE public.hugar_market_tasks SET cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=v_reason WHERE id=v_id;
  SELECT to_jsonb(t) INTO v_after FROM public.hugar_market_tasks t WHERE id=v_id;
  v_entity:='task';
 END IF;
 INSERT INTO public.hugar_market_audit(entity,entity_id,action,before_data,after_data,actor)
 VALUES(v_entity,v_id,p_action,v_before,v_after,auth.uid());
 RETURN v_id;
END;$$;
REVOKE ALL ON FUNCTION public.hugar_market_summary_v3() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.hugar_market_read_v3() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.hugar_market_write_v3(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hugar_market_summary_v3() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hugar_market_read_v3() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hugar_market_write_v3(text,jsonb) TO authenticated;
COMMIT;

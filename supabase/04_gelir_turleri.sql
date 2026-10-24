-- HUGAR V6: Hesaba bağlı, gerçekleşmiş gelir/gider kayıtları.
-- Sadece finance_user_roles.role='admin' kullanıcısı yazabilir.
-- Mevcut tablolardaki satırları silmez, var olan SELECT politikalarını değiştirmez.
BEGIN;
ALTER TABLE public.finance_documents ADD COLUMN IF NOT EXISTS income_channel text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_documents_income_channel_check' AND conrelid = 'public.finance_documents'::regclass) THEN
    ALTER TABLE public.finance_documents ADD CONSTRAINT finance_documents_income_channel_check CHECK (income_channel IS NULL OR income_channel IN ('cash','pos','other'));
  END IF;
END $$;
ALTER TABLE public.finance_documents ADD COLUMN IF NOT EXISTS entry_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS finance_documents_entry_request_unique ON public.finance_documents(entry_request_id) WHERE entry_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.finance_record_entry(
  p_group_id bigint, p_account_id bigint, p_document_type text,
  p_description text, p_amount numeric, p_date date, p_request_id uuid,
  p_income_channel text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc_id bigint; v_opening_date date;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.finance_user_roles r
    WHERE r.user_id = (SELECT auth.uid()) AND r.role = 'admin'
  ) THEN RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekli.' USING ERRCODE='42501'; END IF;

  IF p_document_type NOT IN ('income','expense') OR p_document_type IS NULL
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount > 999999999999
     OR p_amount <> round(p_amount,2)
     OR p_description IS NULL OR length(btrim(p_description)) NOT BETWEEN 1 AND 500
     OR p_date IS NULL OR p_request_id IS NULL OR p_group_id IS NULL OR p_account_id IS NULL
     OR (p_document_type = 'income' AND (p_income_channel IS NULL OR p_income_channel NOT IN ('cash','pos','other')))
     OR (p_document_type = 'expense' AND p_income_channel IS NOT NULL)
  THEN RAISE EXCEPTION 'Geçersiz gelir/gider bilgileri.'; END IF;

  SELECT a.opening_date INTO v_opening_date FROM public.finance_accounts a
    WHERE a.id = p_account_id AND a.group_id = p_group_id;
  IF v_opening_date IS NULL THEN RAISE EXCEPTION 'Hesap seçilen gruba ait değil.'; END IF;
  IF p_date < v_opening_date THEN RAISE EXCEPTION 'İşlem tarihi hesap açılışından önce olamaz.'; END IF;
  IF p_document_type='income' AND p_income_channel='cash' AND NOT EXISTS (SELECT 1 FROM public.finance_accounts WHERE id=p_account_id AND group_id=p_group_id AND account_type='cash') THEN RAISE EXCEPTION 'Nakit gelir kasa hesabına yazılmalıdır.'; END IF;
  IF p_document_type='income' AND p_income_channel='pos' AND NOT EXISTS (SELECT 1 FROM public.finance_accounts WHERE id=p_account_id AND group_id=p_group_id AND account_type='bank') THEN RAISE EXCEPTION 'POS geliri banka hesabına yazılmalıdır.'; END IF;

  INSERT INTO public.finance_documents
    (group_id, document_type, description, document_date, amount, entry_request_id, income_channel)
  VALUES (p_group_id, p_document_type, btrim(p_description), p_date, p_amount, p_request_id, p_income_channel)
  ON CONFLICT (entry_request_id) WHERE entry_request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_doc_id;

  IF v_doc_id IS NULL THEN
    SELECT d.id INTO v_doc_id FROM public.finance_documents d
    WHERE d.entry_request_id = p_request_id AND d.group_id = p_group_id
      AND d.document_type = p_document_type AND d.amount = p_amount
      AND d.document_date = p_date AND d.description = btrim(p_description)
      AND d.income_channel IS NOT DISTINCT FROM p_income_channel;
    IF v_doc_id IS NULL THEN RAISE EXCEPTION 'İstek kimliği başka işlem için kullanılmış.'; END IF;
    RETURN v_doc_id;
  END IF;

  INSERT INTO public.finance_movements
    (group_id, account_id, document_id, movement_date, amount, direction, movement_type, payment_method, note)
  VALUES (p_group_id, p_account_id, v_doc_id, p_date, p_amount,
          CASE WHEN p_document_type='income' THEN 'in' ELSE 'out' END,
          CASE WHEN p_document_type='income' THEN 'collection' ELSE 'payment' END,
          (SELECT CASE WHEN p_document_type='income' AND p_income_channel='pos' THEN 'card' WHEN account_type='cash' THEN 'cash' WHEN account_type='bank' THEN 'bank' ELSE 'card' END
           FROM public.finance_accounts WHERE id=p_account_id AND group_id=p_group_id),
          btrim(p_description));
  RETURN v_doc_id;
END;
$$;
REVOKE ALL ON FUNCTION public.finance_record_entry(bigint,bigint,text,text,numeric,date,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_record_entry(bigint,bigint,text,text,numeric,date,uuid,text) TO authenticated;
-- Disable legacy 7-argument function for authenticated clients if it exists.
DO $$ BEGIN
 IF to_regprocedure('public.finance_record_entry(bigint,bigint,text,text,numeric,date,uuid)') IS NOT NULL THEN
   REVOKE EXECUTE ON FUNCTION public.finance_record_entry(bigint,bigint,text,text,numeric,date,uuid) FROM authenticated, PUBLIC, anon;
 END IF;
END $$;
COMMIT;

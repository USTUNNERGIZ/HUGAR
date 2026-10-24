-- V5: Mevcut finance_user_roles tablosuna isim ve kullanıcı adı ekler.
-- Bu script erişimi SADECE giriş yapmış, rol tablosunda kayıtlı kullanıcılara okuma için açar.
-- Yazma/silme izinleri daha sonra işlem kontrolleriyle birlikte kurulacak.
ALTER TABLE public.finance_user_roles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.finance_user_roles ADD COLUMN IF NOT EXISTS display_name text;
CREATE UNIQUE INDEX IF NOT EXISTS finance_user_roles_username_unique ON public.finance_user_roles (lower(username)) WHERE username IS NOT NULL;
ALTER TABLE public.finance_user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.finance_is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.finance_user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','employee'));
$$;
REVOKE ALL ON FUNCTION public.finance_is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_is_staff() TO authenticated;

-- Mevcut açık policy'ler varsa bu script onları kaldırmaz: uygulama yayınından önce ayrıca denetlenmelidir.
DROP POLICY IF EXISTS finance_roles_self_read ON public.finance_user_roles;
CREATE POLICY finance_roles_self_read ON public.finance_user_roles FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS finance_groups_staff_read ON public.finance_groups;
CREATE POLICY finance_groups_staff_read ON public.finance_groups FOR SELECT TO authenticated USING (public.finance_is_staff());
DROP POLICY IF EXISTS finance_categories_staff_read ON public.finance_categories;
CREATE POLICY finance_categories_staff_read ON public.finance_categories FOR SELECT TO authenticated USING (public.finance_is_staff());
DROP POLICY IF EXISTS finance_accounts_staff_read ON public.finance_accounts;
CREATE POLICY finance_accounts_staff_read ON public.finance_accounts FOR SELECT TO authenticated USING (public.finance_is_staff());
DROP POLICY IF EXISTS finance_parties_staff_read ON public.finance_parties;
CREATE POLICY finance_parties_staff_read ON public.finance_parties FOR SELECT TO authenticated USING (public.finance_is_staff());
DROP POLICY IF EXISTS finance_documents_staff_read ON public.finance_documents;
CREATE POLICY finance_documents_staff_read ON public.finance_documents FOR SELECT TO authenticated USING (public.finance_is_staff());
DROP POLICY IF EXISTS finance_movements_staff_read ON public.finance_movements;
CREATE POLICY finance_movements_staff_read ON public.finance_movements FOR SELECT TO authenticated USING (public.finance_is_staff());

-- Yönetici hesabına görünen isim atamak için, yönetici UID'sini Users ekranından doğrulayıp
-- aşağıdaki örnek sorguyu ayrı çalıştırın:
-- UPDATE public.finance_user_roles SET display_name='Yönetici' WHERE user_id='GERCEK-UID';

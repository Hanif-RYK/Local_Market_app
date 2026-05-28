-- LocalMarket: Missing columns fix + RLS setup
-- Run this in Supabase Dashboard → SQL Editor

-- 1. Add missing columns to existing tables
ALTER TABLE products ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- 2. Helper function to check admin (SECURITY DEFINER = no recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_owner_or_admin(owner_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() = owner_id) OR public.is_admin();
$$;

-- 3. Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(COALESCE(NEW.email, ''), '@', 1), 'User'),
    NEW.email,
    NEW.raw_user_meta_data ->> 'phone',
    'customer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Enable RLS on all tables (safe to run multiple times)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE used_saman ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- 5. Drop old policies and create new ones
-- Profiles
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Enable read own profile" ON profiles;
DROP POLICY IF EXISTS "Enable insert own profile" ON profiles;
DROP POLICY IF EXISTS "Enable update own profile" ON profiles;
DROP POLICY IF EXISTS "Enable all for users" ON profiles;
CREATE POLICY "Users view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admin view all profiles" ON profiles FOR SELECT USING (public.is_admin());
CREATE POLICY "Users insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin delete profiles" ON profiles FOR DELETE USING (public.is_admin());

-- Services
DROP POLICY IF EXISTS "Enable read for all" ON services;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON services;
DROP POLICY IF EXISTS "Enable update for owners" ON services;
DROP POLICY IF EXISTS "Enable delete for owners" ON services;
CREATE POLICY "Anyone can view active services" ON services FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert services" ON services FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own services" ON services FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own services" ON services FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage services" ON services FOR ALL USING (public.is_admin());

-- Shops
DROP POLICY IF EXISTS "Enable read for all" ON shops;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON shops;
DROP POLICY IF EXISTS "Enable update for owners" ON shops;
DROP POLICY IF EXISTS "Enable delete for owners" ON shops;
CREATE POLICY "Anyone can view active shops" ON shops FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert shops" ON shops FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own shops" ON shops FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own shops" ON shops FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage shops" ON shops FOR ALL USING (public.is_admin());

-- Properties
CREATE POLICY "Anyone can view active properties" ON properties FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert properties" ON properties FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own properties" ON properties FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own properties" ON properties FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage properties" ON properties FOR ALL USING (public.is_admin());

-- Product Shops
CREATE POLICY "Anyone can view active product_shops" ON product_shops FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert product_shops" ON product_shops FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own product_shops" ON product_shops FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own product_shops" ON product_shops FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage product_shops" ON product_shops FOR ALL USING (public.is_admin());

-- Products
DROP POLICY IF EXISTS "Enable read for all" ON products;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON products;
DROP POLICY IF EXISTS "Enable update for owners" ON products;
DROP POLICY IF EXISTS "Enable delete for owners" ON products;
CREATE POLICY "Anyone can view products" ON products FOR SELECT USING (true);
CREATE POLICY "Owners insert products" ON products FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update products" ON products FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete products" ON products FOR DELETE USING (auth.uid() = owner_id);

-- Used Saman
CREATE POLICY "Anyone can view active used_saman" ON used_saman FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert used_saman" ON used_saman FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own used_saman" ON used_saman FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own used_saman" ON used_saman FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage used_saman" ON used_saman FOR ALL USING (public.is_admin());

-- Favorites
DROP POLICY IF EXISTS "Enable read for users" ON favorites;
DROP POLICY IF EXISTS "Enable insert for users" ON favorites;
DROP POLICY IF EXISTS "Enable delete for users" ON favorites;
CREATE POLICY "Users view own favorites" ON favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own favorites" ON favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own favorites" ON favorites FOR DELETE USING (auth.uid() = user_id);

-- Listing Photos
DROP POLICY IF EXISTS "Enable read for all" ON listing_photos;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON listing_photos;
CREATE POLICY "Anyone can view listing_photos" ON listing_photos FOR SELECT USING (true);
CREATE POLICY "Authenticated insert listing_photos" ON listing_photos FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Owners delete listing_photos" ON listing_photos FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM services WHERE services.id = listing_photos.listing_id AND services.owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM shops WHERE shops.id = listing_photos.listing_id AND shops.owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM properties WHERE properties.id = listing_photos.listing_id AND properties.owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM product_shops WHERE product_shops.id = listing_photos.listing_id AND product_shops.owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM used_saman WHERE used_saman.id = listing_photos.listing_id AND used_saman.owner_id = auth.uid()
  )
);

-- Reports
DROP POLICY IF EXISTS "Enable insert for all" ON reports;
DROP POLICY IF EXISTS "Enable read for admin" ON reports;
CREATE POLICY "Anyone insert reports" ON reports FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Admin view reports" ON reports FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin delete reports" ON reports FOR DELETE USING (public.is_admin());

-- Contact Logs
CREATE POLICY "Anyone insert contact_logs" ON contact_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Admin view contact_logs" ON contact_logs FOR SELECT USING (public.is_admin());

-- Notifications
DROP POLICY IF EXISTS "Enable read for users" ON notifications;
DROP POLICY IF EXISTS "Enable update for users" ON notifications;
CREATE POLICY "Users view own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "System insert notifications" ON notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Payment Requests
CREATE POLICY "Users view own payment_requests" ON payment_requests FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users insert payment_requests" ON payment_requests FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Admin view payment_requests" ON payment_requests FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin manage payment_requests" ON payment_requests FOR ALL USING (public.is_admin());

-- Plans
CREATE POLICY "Users view own plans" ON plans FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users insert own plans" ON plans FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Admin view all plans" ON plans FOR SELECT USING (public.is_admin());

-- App Settings
CREATE POLICY "Anyone view app_settings" ON app_settings FOR SELECT USING (true);
CREATE POLICY "Admin manage app_settings" ON app_settings FOR ALL USING (public.is_admin());

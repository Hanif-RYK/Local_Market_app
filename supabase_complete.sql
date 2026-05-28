-- ============================================================
-- LocalMarket Complete Supabase Setup
-- Run this ONCE in Supabase Dashboard → SQL Editor
-- Safe to run again (IF NOT EXISTS / IF NOT EXISTS)
-- ============================================================

-- 0. Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO NOTHING;

-- 1. Create ALL tables (IF NOT EXISTS = safe for existing)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT, phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','owner','admin')),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', description TEXT);
CREATE TABLE IF NOT EXISTS plans (
  id BIGSERIAL PRIMARY KEY, owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('free_launch','per_listing_10d','per_listing_20d','per_listing_30d','sub_1month','sub_3month','sub_6month')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  amount_paid INTEGER NOT NULL DEFAULT 0, listings_limit INTEGER, listings_used INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(), expires_at TIMESTAMPTZ, payment_ref TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS service_categories (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, icon TEXT NOT NULL, is_free_forever INTEGER NOT NULL DEFAULT 0, sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS services (
  id BIGSERIAL PRIMARY KEY, owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id BIGINT REFERENCES plans(id) ON DELETE SET NULL, provider_name TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES service_categories(id), experience_years INTEGER, description TEXT,
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','busy')), busy_until TEXT,
  area TEXT NOT NULL, city TEXT NOT NULL, lat REAL, lng REAL,
  mobile TEXT NOT NULL, whatsapp TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','rejected','expired')),
  rejection_reason TEXT, views_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_categories (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, icon TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS product_shops (
  id BIGSERIAL PRIMARY KEY, owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id BIGINT REFERENCES plans(id) ON DELETE SET NULL, shop_name TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES product_categories(id), description TEXT,
  opening_time TEXT, closing_time TEXT, weekly_off_day TEXT, half_open TEXT, half_close TEXT,
  area TEXT NOT NULL, city TEXT NOT NULL, lat REAL, lng REAL, mobile TEXT, whatsapp TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','expired')),
  rejection_reason TEXT, views_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY, shop_id BIGINT NOT NULL REFERENCES product_shops(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE, name TEXT NOT NULL,
  in_stock INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shops (
  id BIGSERIAL PRIMARY KEY, owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id BIGINT REFERENCES plans(id) ON DELETE SET NULL, title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rent','sale')), price INTEGER NOT NULL CHECK (price > 0),
  description TEXT, size_sqft INTEGER, floor TEXT CHECK (floor IN ('Ground','1st','2nd','Basement','Other')),
  corner_shop INTEGER DEFAULT 0, parking INTEGER DEFAULT 0,
  area TEXT NOT NULL, city TEXT NOT NULL, lat REAL, lng REAL, mobile TEXT NOT NULL, whatsapp TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','expired')),
  rejection_reason TEXT, views_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS properties (
  id BIGSERIAL PRIMARY KEY, owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id BIGINT REFERENCES plans(id) ON DELETE SET NULL, title TEXT NOT NULL,
  property_type TEXT NOT NULL CHECK (property_type IN ('house','apartment')),
  listing_type TEXT NOT NULL CHECK (listing_type IN ('rent','sale')), price INTEGER NOT NULL CHECK (price > 0),
  description TEXT, size_sqft INTEGER, size_marla REAL, bedrooms INTEGER NOT NULL DEFAULT 1,
  bathrooms INTEGER NOT NULL DEFAULT 1, floor_number INTEGER DEFAULT 0, total_floors INTEGER,
  furnished TEXT DEFAULT 'unfurnished' CHECK (furnished IN ('furnished','semi-furnished','unfurnished')),
  corner INTEGER DEFAULT 0, parking INTEGER DEFAULT 0,
  area TEXT NOT NULL, city TEXT NOT NULL, lat REAL, lng REAL, mobile TEXT NOT NULL, whatsapp TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','expired')),
  rejection_reason TEXT, views_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS used_saman_categories (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, icon TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS used_saman (
  id BIGSERIAL PRIMARY KEY, owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id BIGINT REFERENCES plans(id) ON DELETE SET NULL, title TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES used_saman_categories(id),
  condition TEXT NOT NULL CHECK (condition IN ('new_jesa','acha','theek_thak')),
  price INTEGER NOT NULL CHECK (price > 0), description TEXT,
  area TEXT NOT NULL, city TEXT NOT NULL, lat REAL, lng REAL, mobile TEXT NOT NULL, whatsapp TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','expired')),
  rejection_reason TEXT, views_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS listing_photos (
  id BIGSERIAL PRIMARY KEY, listing_type TEXT NOT NULL CHECK (listing_type IN ('shop','property','product_shop','used_saman','service')),
  listing_id BIGINT NOT NULL, url TEXT NOT NULL, order_num INTEGER DEFAULT 0 CHECK (order_num BETWEEN 0 AND 5), created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contact_logs (
  id BIGSERIAL PRIMARY KEY, listing_type TEXT NOT NULL CHECK (listing_type IN ('shop','property','product_shop','used_saman','service')),
  listing_id BIGINT NOT NULL, action_type TEXT NOT NULL CHECK (action_type IN ('call','whatsapp','view','directions')), created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
  message TEXT, listing_type TEXT, listing_id BIGINT, is_read INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY, listing_type TEXT NOT NULL, listing_id BIGINT NOT NULL,
  reporter_id UUID, reason TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_requests (
  id BIGSERIAL PRIMARY KEY, owner_id UUID NOT NULL, plan_id TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0, transaction_id TEXT, payer_number TEXT,
  gateway TEXT NOT NULL DEFAULT 'jazzcash',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','fraud')),
  created_at TIMESTAMPTZ DEFAULT now(), verified_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS favorites (
  id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_type TEXT NOT NULL, listing_id BIGINT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, listing_type, listing_id)
);

-- 2. Add any missing columns to existing tables
ALTER TABLE products ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_owner ON services(owner_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);
CREATE INDEX IF NOT EXISTS idx_services_city ON services(city);
CREATE INDEX IF NOT EXISTS idx_shops_status ON shops(status);
CREATE INDEX IF NOT EXISTS idx_shops_owner ON shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_shops_city ON shops(city);
CREATE INDEX IF NOT EXISTS idx_props_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_props_owner ON properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_props_city ON properties(city);
CREATE INDEX IF NOT EXISTS idx_pshops_status ON product_shops(status);
CREATE INDEX IF NOT EXISTS idx_pshops_owner ON product_shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_pshops_city ON product_shops(city);
CREATE INDEX IF NOT EXISTS idx_used_status ON used_saman(status);
CREATE INDEX IF NOT EXISTS idx_used_owner ON used_saman(owner_id);
CREATE INDEX IF NOT EXISTS idx_used_city ON used_saman(city);
CREATE INDEX IF NOT EXISTS idx_plans_owner ON plans(owner_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_photos_listing ON listing_photos(listing_type, listing_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_listing ON favorites(listing_type, listing_id);

-- 4. Security helpers (SECURITY DEFINER = no infinite recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'); $$;

CREATE OR REPLACE FUNCTION public.is_owner_or_admin(owner_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT (auth.uid() = owner_id) OR public.is_admin(); $$;

-- 5. Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, phone, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(COALESCE(NEW.email, ''), '@', 1), 'User'), NEW.email, NEW.raw_user_meta_data ->> 'phone', 'customer')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE OR REPLACE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Enable RLS + policies
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

-- Profiles
DROP POLICY IF EXISTS "Users view own profile" ON profiles;
CREATE POLICY "Users view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Admin view all profiles" ON profiles;
CREATE POLICY "Admin view all profiles" ON profiles FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS "Users insert own profile" ON profiles;
CREATE POLICY "Users insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Admin delete profiles" ON profiles;
CREATE POLICY "Admin delete profiles" ON profiles FOR DELETE USING (public.is_admin());

-- Services
DROP POLICY IF EXISTS "Anyone can view active services" ON services;
CREATE POLICY "Anyone can view active services" ON services FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert services" ON services FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own services" ON services FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own services" ON services FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage services" ON services FOR ALL USING (public.is_admin());

-- Shops
DROP POLICY IF EXISTS "Anyone can view active shops" ON shops;
CREATE POLICY "Anyone can view active shops" ON shops FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert shops" ON shops FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own shops" ON shops FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own shops" ON shops FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage shops" ON shops FOR ALL USING (public.is_admin());

-- Properties
DROP POLICY IF EXISTS "Anyone can view active properties" ON properties;
CREATE POLICY "Anyone can view active properties" ON properties FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert properties" ON properties FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own properties" ON properties FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own properties" ON properties FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage properties" ON properties FOR ALL USING (public.is_admin());

-- Product Shops
DROP POLICY IF EXISTS "Anyone can view active product_shops" ON product_shops;
CREATE POLICY "Anyone can view active product_shops" ON product_shops FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert product_shops" ON product_shops FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own product_shops" ON product_shops FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own product_shops" ON product_shops FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage product_shops" ON product_shops FOR ALL USING (public.is_admin());

-- Products
DROP POLICY IF EXISTS "Anyone can view products" ON products;
CREATE POLICY "Anyone can view products" ON products FOR SELECT USING (true);
CREATE POLICY "Owners insert products" ON products FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update products" ON products FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete products" ON products FOR DELETE USING (auth.uid() = owner_id);

-- Used Saman
DROP POLICY IF EXISTS "Anyone can view active used_saman" ON used_saman;
CREATE POLICY "Anyone can view active used_saman" ON used_saman FOR SELECT USING (status = 'active' OR public.is_owner_or_admin(owner_id));
CREATE POLICY "Owners insert used_saman" ON used_saman FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update own used_saman" ON used_saman FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete own used_saman" ON used_saman FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Admin manage used_saman" ON used_saman FOR ALL USING (public.is_admin());

-- Favorites
DROP POLICY IF EXISTS "Users view own favorites" ON favorites;
CREATE POLICY "Users view own favorites" ON favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own favorites" ON favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own favorites" ON favorites FOR DELETE USING (auth.uid() = user_id);

-- Listing Photos
DROP POLICY IF EXISTS "Anyone can view listing_photos" ON listing_photos;
CREATE POLICY "Anyone can view listing_photos" ON listing_photos FOR SELECT USING (true);
CREATE POLICY "Authenticated insert listing_photos" ON listing_photos FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Owners delete listing_photos" ON listing_photos FOR DELETE USING (
  EXISTS (SELECT 1 FROM services WHERE services.id = listing_photos.listing_id AND services.owner_id = auth.uid()
    UNION ALL SELECT 1 FROM shops WHERE shops.id = listing_photos.listing_id AND shops.owner_id = auth.uid()
    UNION ALL SELECT 1 FROM properties WHERE properties.id = listing_photos.listing_id AND properties.owner_id = auth.uid()
    UNION ALL SELECT 1 FROM product_shops WHERE product_shops.id = listing_photos.listing_id AND product_shops.owner_id = auth.uid()
    UNION ALL SELECT 1 FROM used_saman WHERE used_saman.id = listing_photos.listing_id AND used_saman.owner_id = auth.uid())
);

-- Contact Logs
CREATE POLICY "Anyone insert contact_logs" ON contact_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Admin view contact_logs" ON contact_logs FOR SELECT USING (public.is_admin());

-- Notifications
DROP POLICY IF EXISTS "Users view own notifications" ON notifications;
CREATE POLICY "Users view own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "System insert notifications" ON notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Reports
DROP POLICY IF EXISTS "Anyone insert reports" ON reports;
CREATE POLICY "Anyone insert reports" ON reports FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Admin view reports" ON reports FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin delete reports" ON reports FOR DELETE USING (public.is_admin());

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

-- 7. Seed data (ON CONFLICT DO NOTHING = safe)
INSERT INTO service_categories (name, icon, is_free_forever, sort_order) VALUES
  ('Mazdoor / Labour','👷',true,1), ('Mistri / Construction','🔨',false,2), ('Plumber','💧',false,3),
  ('Electrician','⚡',false,4), ('Carpenter','🪟',false,5), ('Painter','🎨',false,6),
  ('AC Mechanic','❄️',false,7), ('General Mechanic','🔧',false,8), ('Welder','🔩',false,9),
  ('Tile / Floor Work','🏗️',false,10), ('Roof Work','🏠',false,11), ('Other Service','🛠️',false,12)
ON CONFLICT (name) DO NOTHING;

INSERT INTO product_categories (name, icon, sort_order) VALUES
  ('Medical / Pharmacy','💊',1), ('Grocery / Kiryana','🛒',2), ('Mobile & Electronics','📱',3),
  ('Clothing & Fashion','👗',4), ('Food & Restaurant','🍔',5), ('Hardware & Tools','🔧',6),
  ('Books & Stationery','📚',7), ('Beauty & Saloon','💈',8), ('Fruits & Vegetables','🌿',9),
  ('Meat & Dairy','🐄',10), ('Medical Lab / Clinic','🏥',11), ('Electrical & Plumbing','🔌',12),
  ('Sports & Toys','🎮',13), ('Furniture','🛋️',14), ('General / Other','🏪',15)
ON CONFLICT (name) DO NOTHING;

INSERT INTO used_saman_categories (name, icon, sort_order) VALUES
  ('Mobile & Electronics','📱',1), ('Vehicles','🚗',2), ('Furniture','🛋️',3),
  ('Clothes & Fashion','👗',4), ('Books & Stationery','📚',5), ('Sports & Hobbies','🏏',6),
  ('Kitchen & Appliances','🍳',7), ('Kids & Baby Items','🧸',8), ('Tools & Hardware','🔧',9),
  ('Agriculture & Farming','🌿',10), ('Games & Toys','🎮',11), ('Beauty & Health','💄',12),
  ('Other','📦',13)
ON CONFLICT (name) DO NOTHING;

INSERT INTO app_settings (key, value, description) VALUES
  ('app_mode','free','free = sab free, billing = payment required'),
  ('billing_start_date','','Billing start date (auto-switch on this date)'),
  ('per_listing_10d_price','200','Per listing 10 din Rs.'),
  ('per_listing_20d_price','400','Per listing 20 din Rs.'),
  ('per_listing_30d_price','500','Per listing 30 din Rs.'),
  ('plan_1month_price','2500','1 month sub Rs.'),
  ('plan_3month_price','6000','3 month sub Rs.'),
  ('plan_6month_price','9000','6 month sub Rs.'),
  ('plan_1month_limit','7','1 month max listings'),
  ('plan_3month_limit','25','3 month max listings'),
  ('plan_6month_limit','60','6 month max listings'),
  ('max_photos','6','Max photos per listing'),
  ('default_expiry_days','30','Default listing expiry days'),
  ('approval_required','true','Admin approval required for all listings'),
  ('per_listing_10d_label','Per Listing — 10 Days',''),
  ('per_listing_20d_label','Per Listing — 20 Days',''),
  ('per_listing_30d_label','Per Listing — 30 Days',''),
  ('sub_1month_label','Subscription — 1 Month',''),
  ('sub_3month_label','Subscription — 3 Months',''),
  ('sub_6month_label','Subscription — 6 Months',''),
  ('plan_1month_label','Subscription — 1 Month',''),
  ('plan_3month_label','Subscription — 3 Months',''),
  ('plan_6month_label','Subscription — 6 Months',''),
  ('jazzcash_merchant_id','','JazzCash Merchant ID'),
  ('jazzcash_password','','JazzCash Password'),
  ('jazzcash_integrity_salt','','JazzCash Integrity Salt'),
  ('jazzcash_mode','test','Payment mode: test or live'),
  ('payment_enabled','false','Payment on/off'),
  ('mazdoor_approval_required','true','Mazdoor needs admin approval')
ON CONFLICT (key) DO NOTHING;

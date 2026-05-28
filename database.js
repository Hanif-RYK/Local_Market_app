const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'localmarket.db');
let db = null;

function getDb() { return db; }

async function initDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  return db;
}

async function initializeDb() {
  const db = await initDb();

  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT,
    phone TEXT, password TEXT,
    role TEXT NOT NULL DEFAULT 'customer'
      CHECK (role IN ('customer','owner','admin')),
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Add password column if missing (for existing DBs)
  try { db.run('ALTER TABLE profiles ADD COLUMN password TEXT'); } catch (e) {}

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, description TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
    plan_type TEXT NOT NULL CHECK (plan_type IN (
      'free_launch','per_listing_10d','per_listing_20d','per_listing_30d',
      'sub_1month','sub_3month','sub_6month'
    )),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
    amount_paid INTEGER NOT NULL DEFAULT 0,
    listings_limit INTEGER, listings_used INTEGER NOT NULL DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT, payment_ref TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS service_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL, is_free_forever INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    provider_name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES service_categories(id),
    experience_years INTEGER, description TEXT,
    availability TEXT NOT NULL DEFAULT 'available'
      CHECK (availability IN ('available','busy')),
    busy_until TEXT,
    area TEXT NOT NULL, city TEXT NOT NULL,
    lat REAL, lng REAL,
    mobile TEXT NOT NULL, whatsapp TEXT,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('pending','active','rejected','expired')),
    rejection_reason TEXT, views_count INTEGER DEFAULT 0,
    expires_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS product_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL, sort_order INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS product_shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    shop_name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES product_categories(id),
    description TEXT,
    opening_time TEXT, closing_time TEXT, weekly_off_day TEXT,
    half_open TEXT, half_close TEXT,
    area TEXT NOT NULL, city TEXT NOT NULL,
    lat REAL, lng REAL,
    mobile TEXT, whatsapp TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','active','rejected','expired')),
    rejection_reason TEXT, views_count INTEGER DEFAULT 0,
    expires_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL REFERENCES product_shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL, in_stock INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    title TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('rent','sale')),
    price INTEGER NOT NULL CHECK (price > 0),
    description TEXT, size_sqft INTEGER,
    floor TEXT CHECK (floor IN ('Ground','1st','2nd','Basement','Other')),
    corner_shop INTEGER DEFAULT 0, parking INTEGER DEFAULT 0,
    area TEXT NOT NULL, city TEXT NOT NULL,
    lat REAL, lng REAL,
    mobile TEXT NOT NULL, whatsapp TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','active','rejected','expired')),
    rejection_reason TEXT, views_count INTEGER DEFAULT 0,
    expires_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    property_type TEXT NOT NULL CHECK (property_type IN ('house','apartment')),
    listing_type TEXT NOT NULL CHECK (listing_type IN ('rent','sale')),
    price INTEGER NOT NULL CHECK (price > 0),
    description TEXT, size_sqft INTEGER, size_marla REAL,
    bedrooms INTEGER NOT NULL DEFAULT 1, bathrooms INTEGER NOT NULL DEFAULT 1,
    floor_number INTEGER DEFAULT 0, total_floors INTEGER,
    furnished TEXT DEFAULT 'unfurnished'
      CHECK (furnished IN ('furnished','semi-furnished','unfurnished')),
    corner INTEGER DEFAULT 0, parking INTEGER DEFAULT 0,
    area TEXT NOT NULL, city TEXT NOT NULL,
    lat REAL, lng REAL,
    mobile TEXT NOT NULL, whatsapp TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','active','rejected','expired')),
    rejection_reason TEXT, views_count INTEGER DEFAULT 0,
    expires_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS used_saman_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL, sort_order INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS used_saman (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES used_saman_categories(id),
    condition TEXT NOT NULL CHECK (condition IN ('new_jesa','acha','theek_thak')),
    price INTEGER NOT NULL CHECK (price > 0),
    description TEXT,
    area TEXT NOT NULL, city TEXT NOT NULL,
    lat REAL, lng REAL,
    mobile TEXT NOT NULL, whatsapp TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','active','rejected','expired')),
    rejection_reason TEXT, views_count INTEGER DEFAULT 0,
    expires_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS listing_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_type TEXT NOT NULL CHECK (listing_type IN
      ('shop','property','product_shop','used_saman','service')),
    listing_id INTEGER NOT NULL, url TEXT NOT NULL,
    order_num INTEGER DEFAULT 0 CHECK (order_num BETWEEN 0 AND 5),
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS contact_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_type TEXT NOT NULL CHECK (listing_type IN
      ('shop','property','product_shop','used_saman','service')),
    listing_id INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('call','whatsapp','view','directions')),
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    listing_type TEXT,
    listing_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_type TEXT NOT NULL,
    listing_id INTEGER NOT NULL,
    reporter_id TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payment_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    transaction_id TEXT,
    payer_number TEXT,
    gateway TEXT NOT NULL DEFAULT 'jazzcash',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','fraud')),
    created_at TEXT DEFAULT (datetime('now')),
    verified_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    listing_type TEXT NOT NULL,
    listing_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, listing_type, listing_id)
  )`);

  // Indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_services_status ON services(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_services_owner ON services(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_services_city ON services(city)');
  db.run('CREATE INDEX IF NOT EXISTS idx_services_avail ON services(availability)');

  db.run('CREATE INDEX IF NOT EXISTS idx_shops_status ON shops(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_shops_owner ON shops(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_shops_city ON shops(city)');
  db.run('CREATE INDEX IF NOT EXISTS idx_shops_type ON shops(type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_shops_price ON shops(price)');

  db.run('CREATE INDEX IF NOT EXISTS idx_props_status ON properties(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_props_owner ON properties(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_props_city ON properties(city)');
  db.run('CREATE INDEX IF NOT EXISTS idx_props_ltype ON properties(listing_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_props_ptype ON properties(property_type)');

  db.run('CREATE INDEX IF NOT EXISTS idx_pshops_status ON product_shops(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pshops_category ON product_shops(category_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pshops_city ON product_shops(city)');

  db.run('CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id)');

  db.run('CREATE INDEX IF NOT EXISTS idx_used_status ON used_saman(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_used_owner ON used_saman(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_used_category ON used_saman(category_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_used_city ON used_saman(city)');

  db.run('CREATE INDEX IF NOT EXISTS idx_plans_owner ON plans(owner_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status)');

  db.run('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)');

  db.run('CREATE INDEX IF NOT EXISTS idx_photos_listing ON listing_photos(listing_type, listing_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_logs_listing ON contact_logs(listing_type, listing_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_reports_listing ON reports(listing_type, listing_id)');

  // Seed service_categories
  const svcCatCount = db.exec("SELECT COUNT(*) FROM service_categories");
  if (!svcCatCount[0].values[0][0]) {
    const data = [
      ['Mazdoor / Labour','👷',1,1], ['Mistri / Construction','🔨',0,2],
      ['Plumber','💧',0,3], ['Electrician','⚡',0,4],
      ['Carpenter','🪟',0,5], ['Painter','🎨',0,6],
      ['AC Mechanic','❄️',0,7], ['General Mechanic','🔧',0,8],
      ['Welder','🔩',0,9], ['Tile / Floor Work','🏗️',0,10],
      ['Roof Work','🏠',0,11], ['Other Service','🛠️',0,12],
    ];
    for (const [n,i,f,s] of data)
      db.run('INSERT INTO service_categories(name,icon,is_free_forever,sort_order) VALUES(?,?,?,?)', [n,i,f,s]);
  }

  // Seed product_categories
  const prodCatCount = db.exec("SELECT COUNT(*) FROM product_categories");
  if (!prodCatCount[0].values[0][0]) {
    const data = [
      ['Medical / Pharmacy','💊',1], ['Grocery / Kiryana','🛒',2],
      ['Mobile & Electronics','📱',3], ['Clothing & Fashion','👗',4],
      ['Food & Restaurant','🍔',5], ['Hardware & Tools','🔧',6],
      ['Books & Stationery','📚',7], ['Beauty & Saloon','💈',8],
      ['Fruits & Vegetables','🌿',9], ['Meat & Dairy','🐄',10],
      ['Medical Lab / Clinic','🏥',11], ['Electrical & Plumbing','🔌',12],
      ['Sports & Toys','🎮',13], ['Furniture','🛋️',14],
      ['General / Other','🏪',15],
    ];
    for (const [n,i,s] of data)
      db.run('INSERT INTO product_categories(name,icon,sort_order) VALUES(?,?,?)', [n,i,s]);
  }

  // Seed used_saman_categories
  const usedCatCount = db.exec("SELECT COUNT(*) FROM used_saman_categories");
  if (!usedCatCount[0].values[0][0]) {
    const data = [
      ['Mobile & Electronics','📱',1], ['Vehicles','🚗',2],
      ['Furniture','🛋️',3], ['Clothes & Fashion','👗',4],
      ['Books & Stationery','📚',5], ['Sports & Hobbies','🏏',6],
      ['Kitchen & Appliances','🍳',7], ['Kids & Baby Items','🧸',8],
      ['Tools & Hardware','🔧',9], ['Agriculture & Farming','🌿',10],
      ['Games & Toys','🎮',11], ['Beauty & Health','💄',12],
      ['Other','📦',13],
    ];
    for (const [n,i,s] of data)
      db.run('INSERT INTO used_saman_categories(name,icon,sort_order) VALUES(?,?,?)', [n,i,s]);
  }

  // Seed app_settings
  const setCount = db.exec("SELECT COUNT(*) FROM app_settings");
  if (!setCount[0].values[0][0]) {
    const data = [
      ['app_mode','free','free = sab free, billing = payment required'],
      ['billing_start_date','','Billing start date (auto-switch on this date)'],
      ['per_listing_10d_price','200','Per listing 10 din Rs.'],
      ['per_listing_20d_price','400','Per listing 20 din Rs.'],
      ['per_listing_30d_price','500','Per listing 30 din Rs.'],
      ['plan_1month_price','2500','1 month sub Rs.'],
      ['plan_3month_price','6000','3 month sub Rs.'],
      ['plan_6month_price','9000','6 month sub Rs.'],
      ['plan_1month_limit','7','1 month max listings'],
      ['plan_3month_limit','25','3 month max listings'],
      ['plan_6month_limit','60','6 month max listings'],
      ['max_photos','6','Max photos per listing'],
      ['default_expiry_days','30','Default listing expiry days'],
      ['approval_required','true','Admin approval required for all listings'],
      ['per_listing_10d_label','Per Listing — 10 Days',''],
      ['per_listing_20d_label','Per Listing — 20 Days',''],
      ['per_listing_30d_label','Per Listing — 30 Days',''],
      ['sub_1month_label','Subscription — 1 Month',''],
      ['sub_3month_label','Subscription — 3 Months',''],
      ['sub_6month_label','Subscription — 6 Months',''],
      ['plan_1month_label','Subscription — 1 Month',''],
      ['plan_3month_label','Subscription — 3 Months',''],
      ['plan_6month_label','Subscription — 6 Months',''],
      ['jazzcash_merchant_id','','JazzCash Merchant ID'],
      ['jazzcash_password','','JazzCash Password'],
      ['jazzcash_integrity_salt','','JazzCash Integrity Salt'],
      ['jazzcash_mode','test','Payment mode: test or live'],
      ['payment_enabled','false','Payment on/off (toggle after free period)'],
      ['mazdoor_approval_required','true','Mazdoor needs admin approval'],
    ];
    for (const [k,v,d] of data)
      db.run('INSERT INTO app_settings(key,value,description) VALUES(?,?,?)', [k,v,d]);
  }
  // Seed missing settings (DB upgrade)
  const upgradeSettings = [
    ['plan_3month_limit','','3 month max listings (blank = unlimited)'],
    ['plan_6month_limit','','6 month max listings (blank = unlimited)'],
    ['max_photos','6','Max photos per listing'],
    ['default_expiry_days','30','Default listing expiry days'],
    ['approval_required','true','Admin approval required for all listings'],
    ['per_listing_10d_label','Per Listing — 10 Days',''],
    ['per_listing_20d_label','Per Listing — 20 Days',''],
    ['per_listing_30d_label','Per Listing — 30 Days',''],
    ['sub_1month_label','Subscription — 1 Month',''],
    ['sub_3month_label','Subscription — 3 Months',''],
    ['sub_6month_label','Subscription — 6 Months',''],
    ['plan_1month_label','Subscription — 1 Month',''],
    ['plan_3month_label','Subscription — 3 Months',''],
    ['plan_6month_label','Subscription — 6 Months',''],
    ['jazzcash_merchant_id','','JazzCash Merchant ID'],
    ['jazzcash_password','','JazzCash Password'],
    ['jazzcash_integrity_salt','','JazzCash Integrity Salt'],
    ['jazzcash_mode','test','Payment mode: test or live'],
    ['payment_enabled','false','Payment on/off (toggle after free period)'],
    ['app_mode','free','free = sab free, billing = payment required'],
    ['billing_start_date','','Billing start date (auto-switch on this date)'],
    ['mazdoor_approval_required','true','Mazdoor needs admin approval'],
  ];
  for (const [k,v,d] of upgradeSettings) {
    const existing = db.exec("SELECT COUNT(*) FROM app_settings WHERE key=?", [k]);
    if (!existing[0].values[0][0])
      db.run('INSERT INTO app_settings(key,value,description) VALUES(?,?,?)', [k,v,d]);
  }

  // Seed admin user
  const adminCount = db.exec("SELECT COUNT(*) FROM profiles WHERE role='admin'");
  if (!adminCount[0].values[0][0]) {
    db.run("INSERT INTO profiles(id,name,role) VALUES('admin','Admin','admin')");
  }

  // DB column upgrades
  try { db.run("ALTER TABLE product_shops ADD COLUMN half_open TEXT"); } catch (e) {}
  try { db.run("ALTER TABLE product_shops ADD COLUMN half_close TEXT"); } catch (e) {}

  saveDb();
  return db;
}

function saveDb() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

module.exports = { getDb, initDb, initializeDb, saveDb };

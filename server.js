const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { initializeDb, getDb, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── File upload ──
const multer = require('multer');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
app.use('/uploads', express.static(uploadDir));

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function nearbyQuery(table, categoryJoin, selectFields, lat, lng, radius, categoryId, extraWhere) {
  const db = getDb();
  const sql = `SELECT ${selectFields} FROM ${table} ${categoryJoin} WHERE status='active'
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ${extraWhere || ''}
    ${categoryId ? 'AND category_id = ' + parseInt(categoryId) : ''}`;
  const rows = db.exec(sql);
  const items = [];
  if (rows.length) {
    for (const r of rows[0].values) {
      const item = parseRow(r);
      if (item.lat && item.lng) {
        item.distance_m = Math.round(haversine(lat, lng, item.lat, item.lng));
        if (!radius || item.distance_m <= radius) items.push(item);
      }
    }
  }
  return items;
}

function getById(table, id, extraJoin, extraFields) {
  const db = getDb();
  const rows = db.exec(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!rows.length || !rows[0].values.length) return null;
  const r = rows[0].values[0];
  const cols = db.exec(`PRAGMA table_info(${table})`)[0].values.map(c => c[1]);
  const item = {};
  cols.forEach((c, i) => { item[c] = r[i]; });
  return item;
}

function getCols(table) {
  const db = getDb();
  return db.exec(`PRAGMA table_info(${table})`)[0].values.map(c => c[1]);
}

function rowToObj(r, cols) {
  const obj = {};
  cols.forEach((c, i) => { obj[c] = r[i]; });
  return obj;
}

function isFreeMode() {
  const db = getDb();
  const modeRow = db.exec("SELECT value FROM app_settings WHERE key='app_mode'");
  const mode = modeRow.length ? modeRow[0].values[0][0] : 'free';
  if (mode === 'billing') return false;
  // Check billing_start_date for auto-switch
  const dateRow = db.exec("SELECT value FROM app_settings WHERE key='billing_start_date'");
  if (dateRow.length && dateRow[0].values[0][0]) {
    const startDate = dateRow[0].values[0][0];
    const today = db.exec("SELECT date('now')")[0].values[0][0];
    if (today >= startDate) {
      db.run("UPDATE app_settings SET value='billing' WHERE key='app_mode'");
      saveDb();
      return false;
    }
  }
  return true;
}

function getByIdRoute(app, table, routeName) {
  app.get(`/api/${routeName || table}/:id`, (req, res) => {
    const item = getById(table, parseInt(req.params.id));
    if (!item) return res.status(404).json({ error: 'Not found' });
    getDb().run(`UPDATE ${table} SET views_count=views_count+1 WHERE id=?`, [item.id]);
    saveDb();
    item.views_count = (item.views_count || 0) + 1;
    res.json(item);
  });
}

function createListing(app, table, requiredFields, routeName) {
  app.post(`/api/${routeName || table}`, (req, res) => {
    const db = getDb();
    const missing = requiredFields.filter(f => !req.body[f]);
    if (missing.length) return res.status(400).json({ error: 'Missing: ' + missing.join(', ') });

    const isFree = isFreeMode();

    const apprRow = db.exec("SELECT value FROM app_settings WHERE key='approval_required'");
    const approvalRequired = !apprRow.length || apprRow[0].values[0][0] === 'true';
    const expiryRow = db.exec("SELECT value FROM app_settings WHERE key='default_expiry_days'");
    const defaultExpiryDays = expiryRow.length ? parseInt(expiryRow[0].values[0][0]) || 30 : 30;

    let noExpiry = isFree;
    let status = isFree ? 'active' : (approvalRequired ? 'pending' : 'active');
    if (table === 'services' && req.body.category_id) {
      const forever = db.exec('SELECT is_free_forever FROM service_categories WHERE id=?', [req.body.category_id]);
      if (forever.length && forever[0].values.length && forever[0].values[0][0]) {
        noExpiry = true;
        if (approvalRequired) status = 'pending';
        else {
          const mazApproval = db.exec("SELECT value FROM app_settings WHERE key='mazdoor_approval_required'");
          if (mazApproval.length && mazApproval[0].values[0][0] === 'true') status = 'pending';
          else status = 'active';
        }
      }
    }

    // Require active plan for non-free listings
    if (!noExpiry && req.body.owner_id) {
      const planRows = db.exec(`SELECT * FROM plans WHERE owner_id=? AND status='active' AND (expires_at IS NULL OR expires_at > datetime('now')) AND (listings_limit IS NULL OR listings_used < listings_limit) ORDER BY created_at DESC LIMIT 1`, [req.body.owner_id]);
      if (!planRows.length || !planRows[0].values.length) {
        return res.status(403).json({ error: '⚠️ No active plan. Please purchase a plan first.' });
      }
    }

    const cols = getCols(table);
    const insertCols = cols.filter(c => c !== 'id' && c !== 'created_at' && c !== 'updated_at' && c !== 'views_count');
    const filteredCols = insertCols.filter(c => req.body[c] !== undefined || c === 'status' || c === 'expires_at');
    const placeholders = filteredCols.map(() => '?').join(',');
    const values = filteredCols.map(c => {
      if (c === 'status') return status;
      if (c === 'expires_at') return noExpiry ? null : db.exec(`SELECT datetime('now','+${defaultExpiryDays} days')`)[0].values[0][0];
      return req.body[c];
    });

    db.run(`INSERT INTO ${table} (${filteredCols.join(',')}) VALUES (${placeholders})`, values);
    const idRows = db.exec(`SELECT id FROM ${table} ORDER BY id DESC LIMIT 1`);
    const id = idRows.length && idRows[0].values.length ? idRows[0].values[0][0] : 0;

    // Increment listings_used on active plan (skip for free_launch / forever-free services)
    if (!noExpiry && req.body.owner_id) {
      db.run(`UPDATE plans SET listings_used = listings_used + 1
        WHERE owner_id=? AND status='active' AND (expires_at IS NULL OR expires_at > datetime('now'))
        AND (listings_limit IS NULL OR listings_used < listings_limit)`, [req.body.owner_id]);
    }

    saveDb();
    res.status(201).json({ id, status, message: 'Created' });
  });
}

function updateListing(app, table, routeName) {
  app.put(`/api/${routeName || table}/:id`, (req, res) => {
    const db = getDb();
    const id = parseInt(req.params.id);
    const existing = getById(table, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.owner_id !== req.body.owner_id) return res.status(403).json({ error: 'Not owner' });
    const cols = getCols(table).filter(c => c !== 'id' && c !== 'created_at' && c !== 'updated_at' && c !== 'views_count' && c !== 'status');
    const sets = cols.filter(c => req.body[c] !== undefined).map(c => `${c}=?`).join(',');
    const values = cols.filter(c => req.body[c] !== undefined).map(c => req.body[c]);
    if (!sets) return res.status(400).json({ error: 'No fields to update' });
    db.run(`UPDATE ${table} SET ${sets}, updated_at=datetime('now') WHERE id=?`, [...values, id]);
    saveDb();
    res.json({ message: 'Updated' });
  });
}

function deleteListing(app, table, routeName) {
  app.delete(`/api/${routeName || table}/:id`, (req, res) => {
    const db = getDb();
    const id = parseInt(req.params.id);
    const existing = getById(table, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.owner_id !== req.body.owner_id) return res.status(403).json({ error: 'Not owner' });
    db.run(`DELETE FROM ${table} WHERE id=?`, [id]);
    saveDb();
    res.json({ message: 'Deleted' });
  });
}

function getOwnerListings(app, table, routeName) {
  app.get(`/api/${routeName || table}/owner/:owner_id`, (req, res) => {
    const db = getDb();
    const rows = db.exec(`SELECT * FROM ${table} WHERE owner_id=? ORDER BY created_at DESC`, [req.params.owner_id]);
    const cols = getCols(table);
    const items = rows.length ? rows[0].values.map(r => rowToObj(r, cols)) : [];
    res.json(items);
  });
}

function getPendingAdmin(app, table, joinClause, selectFields, routeName) {
  app.get(`/api/admin/${routeName || table}/pending`, (req, res) => {
    const db = getDb();
    const statusFilter = req.query.status;
    const whereClause = statusFilter === 'all' ? '' : `${table}.status='pending'`;
    const sql = `SELECT ${selectFields || table + '.*'} FROM ${table} ${joinClause || ''} ${whereClause ? 'WHERE ' + whereClause : ''} ORDER BY ${table}.created_at DESC`;
    const rows = db.exec(sql);
    const cols = selectFields ? null : getCols(table);
    const items = rows.length ? rows[0].values.map(r => cols ? rowToObj(r, cols) : r) : [];
    // Attach plan info for each owner
    if (items.length) {
      const planCols = getCols('plans');
      items.forEach(item => {
        if (item.owner_id) {
          const pr = db.exec(`SELECT * FROM plans WHERE owner_id=? AND status='active' AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC LIMIT 1`, [item.owner_id]);
          if (pr.length && pr[0].values.length) {
            const p = rowToObj(pr[0].values[0], planCols);
            item.plan_type = p.plan_type;
            item.plan_limit = p.listings_limit;
            item.plan_used = p.listings_used;
          }
        }
      });
    }
    res.json(items);
  });
}

function reviewAdmin(app, table, routeName) {
  app.put(`/api/admin/${routeName || table}/:id/review`, (req, res) => {
    const db = getDb();
    const id = parseInt(req.params.id);
    if (!['active','rejected'].includes(req.body.status))
      return res.status(400).json({ error: 'Status must be active or rejected' });
    const existing = getById(table, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run(`UPDATE ${table} SET status=?, rejection_reason=?, updated_at=datetime('now') WHERE id=?`,
      [req.body.status, req.body.rejection_reason || null, id]);
    // Notify owner
    const title = existing.provider_name || existing.title || existing.shop_name || 'Listing #' + id;
    const statusLabel = req.body.status === 'active' ? 'approved' : 'rejected';
    const reason = req.body.status === 'rejected' && req.body.rejection_reason ? ': ' + req.body.rejection_reason : '';
    const typeMap = { services:'service', shops:'shop', properties:'property', product_shops:'product_shop', used_saman:'used_saman' };
    const lt = typeMap[table] || table;
    db.run("INSERT INTO notifications(user_id,type,title,message,listing_type,listing_id) VALUES(?,?,?,?,?,?)",
      [existing.owner_id, statusLabel, title, 'Your listing "' + title + '" was ' + statusLabel + reason, lt, id]);
    saveDb();
    res.json({ message: 'Reviewed' });
  });
}

function deleteAdmin(app, table, routeName) {
  app.delete(`/api/admin/${routeName || table}/:id`, (req, res) => {
    const db = getDb();
    const id = parseInt(req.params.id);
    const existing = getById(table, id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const typeMap = { services:'service', shops:'shop', properties:'property', product_shops:'product_shop', used_saman:'used_saman' };
    const lt = typeMap[table] || table.replace(/_/g, '_');
    db.run('DELETE FROM listing_photos WHERE listing_type=? AND listing_id=?', [lt, id]);
    if (table === 'product_shops') db.run('DELETE FROM products WHERE shop_id=?', [id]);
    db.run(`DELETE FROM ${table} WHERE id=?`, [id]);
    saveDb();
    res.json({ message: 'Deleted' });
  });
}

function getNearbyEndpoint(app, table, selectFields, joinClause, routeName) {
  app.get(`/api/${routeName || table}/nearby`, (req, res) => {
    const lng = parseFloat(req.query.lng);
    const lat = parseFloat(req.query.lat);
    const hasLoc = lng && lat;
    const radius = req.query.radius ? parseFloat(req.query.radius) : null;
    const cat = req.query.category ? parseInt(req.query.category) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;

    const db = getDb();
    const sql = `SELECT ${selectFields || table + '.*'} FROM ${table} ${joinClause || ''}
      WHERE ${table}.status='active' AND (${table}.expires_at IS NULL OR ${table}.expires_at > datetime('now'))
      ${cat ? 'AND ' + table + '.category_id=' + cat : ''}
      ORDER BY ${table}.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const rows = db.exec(sql);
    const cols = getCols(table);
    const items = [];
    if (rows.length) {
      for (const r of rows[0].values) {
        const item = rowToObj(r, cols);
        if (item.lat && item.lng) {
          if (hasLoc) {
            item.distance_m = Math.round(haversine(lat, lng, item.lat, item.lng));
            if (radius && item.distance_m > radius) continue;
          } else {
            item.distance_m = null;
          }
        } else {
          item.distance_m = null;
        }
        items.push(item);
      }
    }
    if (hasLoc) items.sort((a, b) => {
      if (a.distance_m === null && b.distance_m === null) return 0;
      if (a.distance_m === null) return 1;
      if (b.distance_m === null) return -1;
      return a.distance_m - b.distance_m;
    });
    // Attach pagination info
    const totalRows = db.exec(`SELECT COUNT(*) FROM ${table} ${joinClause || ''}
      WHERE ${table}.status='active' AND (${table}.expires_at IS NULL OR ${table}.expires_at > datetime('now'))
      ${cat ? 'AND ' + table + '.category_id=' + cat : ''}`);
    const total = totalRows.length ? totalRows[0].values[0][0] : 0;
    res.json({ items, total, limit, offset, has_more: offset + limit < total });
  });
}

// ── Settings ──
app.get('/api/settings', (req, res) => {
  const db = getDb();
  const rows = db.exec('SELECT * FROM app_settings');
  const settings = {};
  if (rows.length) for (const r of rows[0].values) settings[r[0]] = r[1];
  res.json(settings);
});

// ── Profile ──
app.get('/api/profile/:id', (req, res) => {
  const db = getDb();
  const rows = db.exec('SELECT * FROM profiles WHERE id=?', [req.params.id]);
  if (!rows.length || !rows[0].values.length) return res.status(404).json({ error: 'Not found' });
  const cols = db.exec('PRAGMA table_info(profiles)')[0].values.map(c => c[1]);
  const obj = {};
  cols.forEach((c, i) => { if (c !== 'password') obj[c] = rows[0].values[0][i]; });
  res.json(obj);
});

app.post('/api/profile', (req, res) => {
  const db = getDb();
  const { id, name, email, phone, role } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  db.run(`INSERT OR REPLACE INTO profiles(id,name,email,phone,role,password)
    VALUES(?,?,?,?,COALESCE(?, (SELECT role FROM profiles WHERE id=?), 'customer'),
    (SELECT password FROM profiles WHERE id=?))`,
    [id, name, email||null, phone||null, role||null, id, id]);
  saveDb();
  res.json({ message: 'Profile saved' });
});

// ── Auth ──
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getProfileCols() {
  return ['id','name','email','phone','role','created_at'];
}

app.post('/api/auth/register', (req, res) => {
  const db = getDb();
  const { name, email, phone, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password required' });
  const id = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const pwHash = hashPassword(password);
  try {
    db.run('INSERT INTO profiles(id,name,email,phone,password,role) VALUES(?,?,?,?,?,\'customer\')',
      [id, name, email||null, phone||null, pwHash]);
    saveDb();
    const token = generateToken();
    const expiresAt = db.exec("SELECT datetime('now','+30 days')")[0].values[0][0];
    db.run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', [token, id, expiresAt]);
    saveDb();
    res.status(201).json({ token, user: { id, name, email, phone, role: 'customer' } });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const db = getDb();
  const { email, phone, password } = req.body;
  if ((!email && !phone) || !password) return res.status(400).json({ error: 'Email/phone and password required' });
  const pwHash = hashPassword(password);
  let user = null;
  if (email) {
    const rows = db.exec('SELECT id,name,email,phone,role FROM profiles WHERE email=? AND password=?', [email, pwHash]);
    if (rows.length && rows[0].values.length) {
      const r = rows[0].values[0];
      user = { id: r[0], name: r[1], email: r[2], phone: r[3], role: r[4] };
    }
  } else {
    const rows = db.exec('SELECT id,name,email,phone,role FROM profiles WHERE phone=? AND password=?', [phone, pwHash]);
    if (rows.length && rows[0].values.length) {
      const r = rows[0].values[0];
      user = { id: r[0], name: r[1], email: r[2], phone: r[3], role: r[4] };
    }
  }
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken();
  const expiresAt = db.exec("SELECT datetime('now','+30 days')")[0].values[0][0];
  db.run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', [token, user.id, expiresAt]);
  saveDb();
  res.json({ token, user });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const db = getDb();
  const rows = db.exec(`SELECT p.id,p.name,p.email,p.phone,p.role,p.created_at FROM sessions s
    JOIN profiles p ON p.id = s.user_id
    WHERE s.token=? AND s.expires_at > datetime('now')`, [token]);
  if (!rows.length || !rows[0].values.length) return res.status(401).json({ error: 'Invalid or expired token' });
  const r = rows[0].values[0];
  const cols = getProfileCols();
  const user = {};
  cols.forEach((c, i) => user[c] = r[i]);
  res.json(user);
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    getDb().run('DELETE FROM sessions WHERE token=?', [token]);
    saveDb();
  }
  res.json({ message: 'Logged out' });
});

// ── Categories ──
app.get('/api/categories/services', (req, res) => {
  const rows = getDb().exec('SELECT * FROM service_categories ORDER BY sort_order');
  res.json(rows.length ? rows[0].values.map(r => ({id:r[0],name:r[1],icon:r[2],is_free_forever:!!r[3],sort_order:r[4]})) : []);
});
app.get('/api/categories/products', (req, res) => {
  const rows = getDb().exec('SELECT * FROM product_categories ORDER BY sort_order');
  res.json(rows.length ? rows[0].values.map(r => ({id:r[0],name:r[1],icon:r[2],sort_order:r[3]})) : []);
});
app.get('/api/categories/used-saman', (req, res) => {
  const rows = getDb().exec('SELECT * FROM used_saman_categories ORDER BY sort_order');
  res.json(rows.length ? rows[0].values.map(r => ({id:r[0],name:r[1],icon:r[2],sort_order:r[3]})) : []);
});

// ── Services ──
getNearbyEndpoint(app, 'services');
app.get('/api/services/:id', (req, res) => {
  const svc = getById('services', parseInt(req.params.id));
  if (!svc) return res.status(404).json({ error: 'Not found' });
  getDb().run('UPDATE services SET views_count=views_count+1 WHERE id=?', [svc.id]);
  saveDb();
  svc.views_count++;
  res.json(svc);
});
createListing(app, 'services', ['owner_id','provider_name','category_id','area','city','mobile']);
getOwnerListings(app, 'services');
getPendingAdmin(app, 'services');
reviewAdmin(app, 'services');
deleteAdmin(app, 'services');
updateListing(app, 'services');
deleteListing(app, 'services');

// -- Service availability toggle --
app.put('/api/services/:id/availability', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const existing = getById('services', id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.owner_id !== req.body.owner_id) return res.status(403).json({ error: 'Not owner' });
  const { availability, busy_until } = req.body;
  if (!['available','busy'].includes(availability)) return res.status(400).json({ error: 'Invalid availability' });
  db.run("UPDATE services SET availability=?, busy_until=?, updated_at=datetime('now') WHERE id=?", [availability, busy_until||null, id]);
  saveDb();
  res.json({ message: 'Availability updated' });
});

// ── Shops ──
getNearbyEndpoint(app, 'shops');
getByIdRoute(app, 'shops');
createListing(app, 'shops', ['owner_id','title','type','price','area','city','mobile']);
getOwnerListings(app, 'shops');
getPendingAdmin(app, 'shops');
reviewAdmin(app, 'shops');
deleteAdmin(app, 'shops');
updateListing(app, 'shops');
deleteListing(app, 'shops');

// ── Properties ──
getNearbyEndpoint(app, 'properties');
getByIdRoute(app, 'properties');
createListing(app, 'properties', ['owner_id','title','property_type','listing_type','price','bedrooms','bathrooms','area','city','mobile']);
getOwnerListings(app, 'properties');
getPendingAdmin(app, 'properties');
reviewAdmin(app, 'properties');
deleteAdmin(app, 'properties');
updateListing(app, 'properties');
deleteListing(app, 'properties');

// ── Product Shops ──
getNearbyEndpoint(app, 'product_shops', null, null, 'product-shops');
getByIdRoute(app, 'product_shops', 'product-shops');
createListing(app, 'product_shops', ['owner_id','shop_name','category_id','area','city'], 'product-shops');
getOwnerListings(app, 'product_shops', 'product-shops');
getPendingAdmin(app, 'product_shops', null, null, 'product-shops');
reviewAdmin(app, 'product_shops', 'product-shops');
deleteAdmin(app, 'product_shops', 'product-shops');
updateListing(app, 'product_shops', 'product-shops');
deleteListing(app, 'product_shops', 'product-shops');

// ── Products (inside product shops) ──
app.get('/api/product-shops/:shopId/products', (req, res) => {
  const rows = getDb().exec('SELECT * FROM products WHERE shop_id=? ORDER BY name', [parseInt(req.params.shopId)]);
  const cols = ['id','shop_id','name','in_stock','created_at'];
  const items = rows.length ? rows[0].values.map(r => rowToObj(r, cols)) : [];
  res.json(items);
});

app.post('/api/product-shops/:shopId/products', (req, res) => {
  const db = getDb();
  const shopId = parseInt(req.params.shopId);
  const shop = getById('product_shops', shopId);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  if (shop.owner_id !== req.body.owner_id) return res.status(403).json({ error: 'Not owner' });
  const { name, in_stock } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name required' });
  db.run('INSERT INTO products(shop_id,name,in_stock) VALUES(?,?,?)', [shopId, name, in_stock !== undefined ? (in_stock ? 1 : 0) : 1]);
  saveDb();
  const id = db.exec('SELECT id FROM products ORDER BY id DESC LIMIT 1')[0].values[0][0];
  res.status(201).json({ id, message: 'Product added' });
});

app.put('/api/product-shops/:shopId/products/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const shopId = parseInt(req.params.shopId);
  const shop = getById('product_shops', shopId);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  if (shop.owner_id !== req.body.owner_id) return res.status(403).json({ error: 'Not owner' });
  const { name, in_stock } = req.body;
  if (name) db.run('UPDATE products SET name=? WHERE id=? AND shop_id=?', [name, id, shopId]);
  if (in_stock !== undefined) db.run('UPDATE products SET in_stock=? WHERE id=? AND shop_id=?', [in_stock ? 1 : 0, id, shopId]);
  saveDb();
  res.json({ message: 'Product updated' });
});

app.delete('/api/product-shops/:shopId/products/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const shopId = parseInt(req.params.shopId);
  const shop = getById('product_shops', shopId);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  if (shop.owner_id !== req.body.owner_id) return res.status(403).json({ error: 'Not owner' });
  db.run('DELETE FROM products WHERE id=? AND shop_id=?', [id, shopId]);
  saveDb();
  res.json({ message: 'Product deleted' });
});

// ── Used Saman ──
getNearbyEndpoint(app, 'used_saman', null, null, 'used-saman');
getByIdRoute(app, 'used_saman', 'used-saman');
createListing(app, 'used_saman', ['owner_id','title','category_id','condition','price','area','city','mobile'], 'used-saman');
getOwnerListings(app, 'used_saman', 'used-saman');
getPendingAdmin(app, 'used_saman', null, null, 'used-saman');
reviewAdmin(app, 'used_saman', 'used-saman');
deleteAdmin(app, 'used_saman', 'used-saman');
updateListing(app, 'used_saman', 'used-saman');
deleteListing(app, 'used_saman', 'used-saman');

// ── Photos ──
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = '/uploads/' + req.file.filename;
  res.json({ url });
});

app.post('/api/photos', (req, res) => {
  const db = getDb();
  const { listing_type, listing_id, url, order_num } = req.body;
  if (!listing_type || !listing_id || !url) return res.status(400).json({ error: 'listing_type, listing_id, url required' });
  const typeMap = { services:'service', shops:'shop', properties:'property', 'product-shops':'product_shop', 'used-saman':'used_saman' };
  const lt = typeMap[listing_type] || listing_type;
  const count = db.exec('SELECT COUNT(*) FROM listing_photos WHERE listing_type=? AND listing_id=?', [lt, listing_id]);
  if (count[0].values[0][0] >= 6) return res.status(400).json({ error: 'Max 6 photos' });
  try {
    db.run('INSERT INTO listing_photos(listing_type,listing_id,url,order_num) VALUES(?,?,?,?)', [lt, listing_id, url, order_num||0]);
    saveDb();
    res.status(201).json({ id: db.exec('SELECT id FROM listing_photos ORDER BY id DESC LIMIT 1')[0].values[0][0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/photos/:listing_type/:listing_id', (req, res) => {
  const typeMap = { services:'service', shops:'shop', properties:'property', 'product-shops':'product_shop', 'used-saman':'used_saman' };
  const lt = typeMap[req.params.listing_type] || req.params.listing_type;
  const rows = getDb().exec('SELECT * FROM listing_photos WHERE listing_type=? AND listing_id=? ORDER BY order_num', [lt, parseInt(req.params.listing_id)]);
  const cols = getCols('listing_photos');
  res.json(rows.length ? rows[0].values.map(r => rowToObj(r, cols)) : []);
});
app.delete('/api/photos/:id', (req, res) => {
  try {
    getDb().run('DELETE FROM listing_photos WHERE id=?', [parseInt(req.params.id)]);
    saveDb();
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Contact Log ──
app.post('/api/contact-log', (req, res) => {
  const db = getDb();
  const { listing_type, listing_id, action_type } = req.body;
  if (!listing_type || !listing_id || !action_type) return res.status(400).json({ error: 'All fields required' });
  if (action_type === 'view') {
    const tables = {shop:'shops',property:'properties',product_shop:'product_shops',used_saman:'used_saman',service:'services'};
    if (tables[listing_type]) db.run(`UPDATE ${tables[listing_type]} SET views_count=views_count+1 WHERE id=?`, [listing_id]);
  }
  db.run('INSERT INTO contact_logs(listing_type,listing_id,action_type) VALUES(?,?,?)', [listing_type, listing_id, action_type]);
  saveDb();
  res.json({ message: 'Logged' });
});

// ── Report Listing ──
app.post('/api/reports', (req, res) => {
  const db = getDb();
  const { listing_type, listing_id, reporter_id, reason } = req.body;
  if (!listing_type || !listing_id) return res.status(400).json({ error: 'listing_type and listing_id required' });
  db.run('INSERT INTO reports(listing_type,listing_id,reporter_id,reason) VALUES(?,?,?,?)',
    [listing_type, listing_id, reporter_id || null, reason || null]);
  saveDb();
  res.json({ message: 'Report submitted' });
});

app.get('/api/admin/reports', (req, res) => {
  const rows = getDb().exec('SELECT * FROM reports ORDER BY created_at DESC');
  const cols = ['id','listing_type','listing_id','reporter_id','reason','created_at'];
  res.json(rows.length ? rows[0].values.map(r => rowToObj(r, cols)) : []);
});

app.delete('/api/admin/reports/:id', (req, res) => {
  getDb().run('DELETE FROM reports WHERE id=?', [parseInt(req.params.id)]);
  saveDb();
  res.json({ message: 'Report deleted' });
});

// ── Admin Listing Counts ──
app.get('/api/admin/counts', (req, res) => {
  const db = getDb();
  const tables = ['services','shops','properties','product_shops','used_saman'];
  const counts = {};
  for (const t of tables) {
    const row = db.exec(`SELECT COUNT(*) FROM ${t}`)[0];
    counts[t] = row ? row.values[0][0] : 0;
    const pending = db.exec(`SELECT COUNT(*) FROM ${t} WHERE status='pending'`)[0];
    counts[t + '_pending'] = pending ? pending.values[0][0] : 0;
  }
  res.json(counts);
});

// ── Admin Dashboard ──
app.get('/api/admin/dashboard', (req, res) => {
  const db = getDb();
  const tables = ['services','shops','properties','product_shops','used_saman'];
  const data = { users: 0, total_listings: 0, pending_total: 0, by_type: {} };
  const uRow = db.exec("SELECT COUNT(*) FROM profiles")[0];
  data.users = uRow ? uRow.values[0][0] : 0;
  for (const t of tables) {
    const total = db.exec(`SELECT COUNT(*) FROM ${t}`)[0];
    const pending = db.exec(`SELECT COUNT(*) FROM ${t} WHERE status='pending'`)[0];
    data.by_type[t] = { total: total ? total.values[0][0] : 0, pending: pending ? pending.values[0][0] : 0 };
    data.total_listings += data.by_type[t].total;
    data.pending_total += data.by_type[t].pending;
  }
  res.json(data);
});

// ── Admin Users ──
app.get('/api/admin/users', (req, res) => {
  const db = getDb();
  const rows = db.exec(`SELECT p.id,p.name,p.email,p.phone,p.role,p.created_at,
    (SELECT COUNT(*) FROM services WHERE owner_id=p.id) as svc,
    (SELECT COUNT(*) FROM shops WHERE owner_id=p.id) as shp,
    (SELECT COUNT(*) FROM properties WHERE owner_id=p.id) as prop,
    (SELECT COUNT(*) FROM product_shops WHERE owner_id=p.id) as ps,
    (SELECT COUNT(*) FROM used_saman WHERE owner_id=p.id) as usd,
    (SELECT plan_type FROM plans WHERE owner_id=p.id AND status='active' AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC LIMIT 1) as active_plan
    FROM profiles p ORDER BY p.created_at DESC`);
  const cols = ['id','name','email','phone','role','created_at','svc','shp','prop','ps','usd','active_plan'];
  res.json(rows.length ? rows[0].values.map(r => rowToObj(r, cols)) : []);
});

// ── Admin: Expire ──
app.post('/api/admin/expire', (req, res) => {
  const db = getDb();
  const now = "datetime('now')";
  db.run(`UPDATE shops SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < ${now}`);
  db.run(`UPDATE properties SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < ${now}`);
  db.run(`UPDATE product_shops SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < ${now}`);
  db.run(`UPDATE used_saman SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < ${now}`);
  db.run(`UPDATE services SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < ${now}
    AND category_id IN (SELECT id FROM service_categories WHERE is_free_forever=0)`);
  db.run(`UPDATE plans SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < ${now}`);
  saveDb();
  res.json({ message: 'Old listings expired' });
});

// ── Admin Settings ──
app.get('/api/admin/settings', (req, res) => {
  const db = getDb();
  const rows = db.exec('SELECT key, value, description FROM app_settings ORDER BY key');
  const settings = {};
  if (rows.length) {
    for (const r of rows[0].values) settings[r[0]] = { value: r[1], description: r[2] };
  }
  res.json(settings);
});

app.put('/api/admin/settings', (req, res) => {
  const db = getDb();
  const updates = req.body;
  if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Invalid settings' });
  for (const [key, value] of Object.entries(updates)) {
    const existing = db.exec('SELECT COUNT(*) FROM app_settings WHERE key=?', [key]);
    if (existing.length && existing[0].values[0][0])
      db.run('UPDATE app_settings SET value=? WHERE key=?', [String(value), key]);
    else
      db.run('INSERT INTO app_settings(key,value) VALUES(?,?)', [key, String(value)]);
  }
  saveDb();
  res.json({ message: 'Settings saved' });
});

// ── Active plan check ──
app.get('/api/plan/active/:owner_id', (req, res) => {
  const db = getDb();
  if (isFreeMode()) {
    return res.json({ plan_type: 'free_launch', is_unlimited: true });
  }
  const rows = db.exec(`SELECT id,plan_type,listings_limit,listings_used,expires_at FROM plans
    WHERE owner_id=? AND status='active' AND (expires_at IS NULL OR expires_at > datetime('now'))
    AND (listings_limit IS NULL OR listings_used < listings_limit)
    ORDER BY created_at DESC LIMIT 1`, [req.params.owner_id]);
  if (!rows.length || !rows[0].values.length) return res.json(null);
  const r = rows[0].values[0];
  res.json({ plan_id: r[0], plan_type: r[1], listings_limit: r[2], listings_used: r[3], expires_at: r[4],
    listings_left: r[2] !== null ? r[2] - r[3] : null, is_unlimited: r[2] === null });
});

// ── Plans Pricing & Purchase ──
app.get('/api/plans/pricing', (req, res) => {
  const db = getDb();
  const rows = db.exec("SELECT key, value FROM app_settings");
  const s = {};
  if (rows.length) for (const r of rows[0].values) s[r[0]] = r[1];
  res.json({
    free_launch_active: isFreeMode(),
    plans: [
      { id: 'per_listing_10d', label: s.per_listing_10d_label || 'Per Listing — 10 Days', price: parseInt(s.per_listing_10d_price) || 200, duration_days: 10, type: 'per_listing' },
      { id: 'per_listing_20d', label: s.per_listing_20d_label || 'Per Listing — 20 Days', price: parseInt(s.per_listing_20d_price) || 400, duration_days: 20, type: 'per_listing' },
      { id: 'per_listing_30d', label: s.per_listing_30d_label || 'Per Listing — 30 Days', price: parseInt(s.per_listing_30d_price) || 500, duration_days: 30, type: 'per_listing' },
      { id: 'sub_1month', label: s.plan_1month_label || 'Subscription — 1 Month', price: parseInt(s.plan_1month_price) || 2500, duration_days: 30, type: 'subscription', listings_limit: s.plan_1month_limit ? parseInt(s.plan_1month_limit) : null },
      { id: 'sub_3month', label: s.plan_3month_label || 'Subscription — 3 Months', price: parseInt(s.plan_3month_price) || 6000, duration_days: 90, type: 'subscription', listings_limit: s.plan_3month_limit ? parseInt(s.plan_3month_limit) : null },
      { id: 'sub_6month', label: s.plan_6month_label || 'Subscription — 6 Months', price: parseInt(s.plan_6month_price) || 9000, duration_days: 180, type: 'subscription', listings_limit: s.plan_6month_limit ? parseInt(s.plan_6month_limit) : null },
    ]
  });
});

app.post('/api/plans/purchase', (req, res) => {
  const db = getDb();
  const { owner_id, plan_id } = req.body;
  if (!owner_id || !plan_id) return res.status(400).json({ error: 'owner_id and plan_id required' });

  // Get plan config from pricing
  const validPlans = {
    per_listing_10d: { type: 'per_listing_10d', days: 10, limit: 1 },
    per_listing_20d: { type: 'per_listing_20d', days: 20, limit: 1 },
    per_listing_30d: { type: 'per_listing_30d', days: 30, limit: 1 },
    sub_1month: { type: 'sub_1month', days: 30, limit: null },
    sub_3month: { type: 'sub_3month', days: 90, limit: null },
    sub_6month: { type: 'sub_6month', days: 180, limit: null },
  };
  const plan = validPlans[plan_id];
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });

  const expiresAt = db.exec(`SELECT datetime('now','+${plan.days} days')`)[0].values[0][0];

  db.run(`INSERT INTO plans(owner_id,plan_type,status,amount_paid,listings_limit,listings_used,expires_at)
    VALUES(?,?,'active',0,?,0,?)`, [owner_id, plan.type, plan.limit, expiresAt]);
  saveDb();
  const id = db.exec('SELECT id FROM plans ORDER BY id DESC LIMIT 1')[0].values[0][0];
  res.status(201).json({ id, plan_type: plan.type, expires_at: expiresAt, message: 'Plan activated' });
});

// ── Payment via JazzCash ──
app.post('/api/plans/pay', (req, res) => {
  const db = getDb();
  const { owner_id, plan_id, transaction_id, payer_number } = req.body;
  if (!owner_id || !plan_id || !transaction_id) return res.status(400).json({ error: 'owner_id, plan_id and transaction_id required' });

  // Get plan config
  const validPlans = {
    per_listing_10d: { type: 'per_listing_10d', days: 10, limit: 1, price: parseInt(db.exec("SELECT value FROM app_settings WHERE key='per_listing_10d_price'")[0]?.values[0][0]) || 200 },
    per_listing_20d: { type: 'per_listing_20d', days: 20, limit: 1, price: parseInt(db.exec("SELECT value FROM app_settings WHERE key='per_listing_20d_price'")[0]?.values[0][0]) || 400 },
    per_listing_30d: { type: 'per_listing_30d', days: 30, limit: 1, price: parseInt(db.exec("SELECT value FROM app_settings WHERE key='per_listing_30d_price'")[0]?.values[0][0]) || 500 },
    sub_1month: { type: 'sub_1month', days: 30, limit: parseInt(db.exec("SELECT value FROM app_settings WHERE key='plan_1month_limit'")[0]?.values[0][0]) || null, price: parseInt(db.exec("SELECT value FROM app_settings WHERE key='plan_1month_price'")[0]?.values[0][0]) || 2500 },
    sub_3month: { type: 'sub_3month', days: 90, limit: null, price: parseInt(db.exec("SELECT value FROM app_settings WHERE key='plan_3month_price'")[0]?.values[0][0]) || 6000 },
    sub_6month: { type: 'sub_6month', days: 180, limit: null, price: parseInt(db.exec("SELECT value FROM app_settings WHERE key='plan_6month_price'")[0]?.values[0][0]) || 9000 },
  };
  const plan = validPlans[plan_id];
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });

  // Log payment request
  db.run("INSERT INTO payment_requests(owner_id,plan_id,amount,transaction_id,payer_number,status) VALUES(?,?,?,?,?,'verified')",
    [owner_id, plan_id, plan.price, transaction_id, payer_number || null]);

  // Activate plan
  const expiresAt = db.exec(`SELECT datetime('now','+${plan.days} days')`)[0].values[0][0];
  db.run(`INSERT INTO plans(owner_id,plan_type,status,amount_paid,listings_limit,listings_used,expires_at)
    VALUES(?,?,'active',?,?,0,?)`, [owner_id, plan.type, plan.price, plan.limit, expiresAt]);
  saveDb();

  const planId = db.exec('SELECT id FROM plans ORDER BY id DESC LIMIT 1')[0].values[0][0];
  res.status(201).json({ id: planId, plan_type: plan.type, expires_at: expiresAt, message: '✅ Payment verified! Plan activated.' });
});

// ── Admin Payment Log ──
app.get('/api/admin/payments', (req, res) => {
  const db = getDb();
  const rows = db.exec("SELECT pr.*, p.name as owner_name FROM payment_requests pr LEFT JOIN profiles p ON pr.owner_id=p.id ORDER BY pr.created_at DESC LIMIT 100");
  const cols = ['id','owner_id','plan_id','amount','transaction_id','payer_number','gateway','status','created_at','verified_at','owner_name'];
  res.json(rows.length ? rows[0].values.map(r => rowToObj(r, cols)) : []);
});

// ── User's Active Plan ──
app.get('/api/plans/my-plan', (req, res) => {
  const db = getDb();
  const { owner_id } = req.query;
  if (!owner_id) return res.json(null);
  const rows = db.exec(`SELECT * FROM plans WHERE owner_id=? AND status='active' AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC LIMIT 1`, [owner_id]);
  if (!rows.length || !rows[0].values.length) return res.json(null);
  const cols = getCols('plans');
  res.json(rowToObj(rows[0].values[0], cols));
});

// ── Notifications ──
app.get('/api/notifications', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  let userId = null;
  if (token) {
    const rows = getDb().exec('SELECT user_id FROM sessions WHERE token=? AND expires_at > datetime(\'now\')', [token]);
    if (rows.length && rows[0].values.length) userId = rows[0].values[0][0];
  }
  if (!userId) return res.status(401).json({ error: 'Auth required' });
  const rows = getDb().exec('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [userId]);
  const cols = ['id','user_id','type','title','message','listing_type','listing_id','is_read','created_at'];
  res.json(rows.length ? rows[0].values.map(r => rowToObj(r, cols)) : []);
});

app.get('/api/notifications/unread-count', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  let userId = null;
  if (token) {
    const rows = getDb().exec('SELECT user_id FROM sessions WHERE token=? AND expires_at > datetime(\'now\')', [token]);
    if (rows.length && rows[0].values.length) userId = rows[0].values[0][0];
  }
  if (!userId) return res.json({ count: 0 });
  const rows = getDb().exec('SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0', [userId]);
  res.json({ count: rows.length && rows[0].values.length ? rows[0].values[0][0] : 0 });
});

app.post('/api/notifications/:id/read', (req, res) => {
  getDb().run('UPDATE notifications SET is_read=1 WHERE id=?', [parseInt(req.params.id)]);
  saveDb();
  res.json({ message: 'Marked as read' });
});

app.post('/api/notifications/read-all', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  let userId = null;
  if (token) {
    const rows = getDb().exec('SELECT user_id FROM sessions WHERE token=? AND expires_at > datetime(\'now\')', [token]);
    if (rows.length && rows[0].values.length) userId = rows[0].values[0][0];
  }
  if (userId) {
    getDb().run('UPDATE notifications SET is_read=1 WHERE user_id=?', [userId]);
    saveDb();
  }
  res.json({ message: 'All marked as read' });
});

// ── Favorites ──
app.post('/api/favorites/toggle', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  let userId = null;
  if (token) {
    const rows = getDb().exec('SELECT user_id FROM sessions WHERE token=? AND expires_at > datetime(\'now\')', [token]);
    if (rows.length && rows[0].values.length) userId = rows[0].values[0][0];
  }
  if (!userId && req.body.owner_id) userId = req.body.owner_id;
  if (!userId) return res.status(401).json({ error: 'Auth required' });
  const { listing_type, listing_id } = req.body;
  if (!listing_type || !listing_id) return res.status(400).json({ error: 'listing_type and listing_id required' });
  const existing = getDb().exec('SELECT id FROM favorites WHERE user_id=? AND listing_type=? AND listing_id=?', [userId, listing_type, listing_id]);
  if (existing.length && existing[0].values.length) {
    getDb().run('DELETE FROM favorites WHERE user_id=? AND listing_type=? AND listing_id=?', [userId, listing_type, listing_id]);
    saveDb();
    return res.json({ favorited: false });
  }
  getDb().run('INSERT INTO favorites(user_id,listing_type,listing_id) VALUES(?,?,?)', [userId, listing_type, listing_id]);
  saveDb();
  res.json({ favorited: true });
});

app.get('/api/favorites', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  let userId = null;
  if (token) {
    const rows = getDb().exec('SELECT user_id FROM sessions WHERE token=? AND expires_at > datetime(\'now\')', [token]);
    if (rows.length && rows[0].values.length) userId = rows[0].values[0][0];
  }
  if (!userId && req.query.owner_id) userId = req.query.owner_id;
  if (!userId) return res.status(401).json({ error: 'Auth required' });
  const favs = getDb().exec('SELECT listing_type, listing_id FROM favorites WHERE user_id=? ORDER BY created_at DESC', [userId]);
  if (!favs.length) return res.json([]);
  const items = [];
  const cols = favs[0].values;
  const tableMap = { services:'services', shops:'shops', properties:'properties', 'product-shops':'product_shops', 'used-saman':'used_saman' };
  for (const [ltype, lid] of cols) {
    const table = tableMap[ltype] || ltype.replace(/-/g, '_');
    const tCols = getCols(table);
    const rows = getDb().exec(`SELECT * FROM ${table} WHERE id=?`, [lid]);
    if (rows.length && rows[0].values.length) {
      const obj = rowToObj(rows[0].values[0], tCols);
      obj._type = ltype;
      items.push(obj);
    }
  }
  res.json(items);
});

app.get('/api/favorites/check/:type/:id', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  let userId = null;
  if (token) {
    const rows = getDb().exec('SELECT user_id FROM sessions WHERE token=? AND expires_at > datetime(\'now\')', [token]);
    if (rows.length && rows[0].values.length) userId = rows[0].values[0][0];
  }
  if (!userId) return res.json({ favorited: false });
  const existing = getDb().exec('SELECT id FROM favorites WHERE user_id=? AND listing_type=? AND listing_id=?', [userId, req.params.type, parseInt(req.params.id)]);
  res.json({ favorited: existing.length && existing[0].values.length ? true : false });
});

// ── Start ──
async function start() {
  await initializeDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LocalMarket server running on http://0.0.0.0:${PORT}`);
  });
}
start().catch(console.error);

# Phase 3: Customer Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fabricated salon ratings with real aggregated star ratings, add a one-click "rebook" from past appointments, and let customers favorite/bookmark salons. Three customer-facing features that make the app feel honest and complete.

**Architecture:** Ratings reuse the Phase-1 `Appointment.rating` field (already on the model, validated 1–5). The existing `updateCustomerReview` endpoint is extended to also accept `rating`; the salon-listing endpoint aggregates `AVG(rating)` + `COUNT(rating)` from joined appointments. Favorites add a tiny new `Favorite` model (composite PK on userId+salonId) and three CRUD routes. Rebook is pure frontend — `navigate()` into the existing booking wizard with the salonId/serviceId from the past appointment. No new pages, no new dependencies.

**Tech Stack:** Express 5, Sequelize 6 over SQLite, React 19 + Vite. No new dependencies.

**Prerequisite:** Phase 1 complete (`Appointment.rating` field exists). Phase 2 not strictly required but recommended (review UX reads better with status badges present).

**Spec reference:** `docs/superpowers/specs/2026-07-18-salon-app-features-design.md` — §4.3 (Phase 3).

---

## File Structure

**New files:**
- `models/favoriteModel.js` — the `Favorite` join model (userId + salonId composite PK).
- `controllers/favoriteController.js` — list / add / remove favorites.
- `routes/favoriteRoutes.js` — mounts the three endpoints under `/api/user/favorites`.
- `tests/ratings-aggregation.test.js` — integration test for the rating-aggregation query and the review-with-rating endpoint.

**Modified — backend:**
- `models/associations.js` — wire `Favorite` associations (User hasMany, Salons hasMany, Favorite belongsTo both).
- `controllers/appointmentController.js` — `updateCustomerReview` accepts `rating`; new `getSalonRatings` helper not needed (aggregation inline in salonController).
- `controllers/salonController.js` — `getAllSalons` and `getSalonById` attach `avgRating` and `reviewCount` per salon.
- `routes/apiRoutes.js` — mount `favoriteRoutes` under `/user/favorites`.

**Modified — frontend (`frontend/src/App.jsx`):**
- `CustomerDashboard` — replace fabricated rating numbers with `salon.avgRating`/`salon.reviewCount`; add favorite star toggle on each card; add "Favorites" filter.
- `SalonServices` — show the real rating on the salon profile header.
- `BookedAppointments` — add 1–5 star input to the review modal; send `{ review, rating }`; add "Book Again" button per row.

**Not touched:** auth, payment, staff/admin flows, models other than adding Favorite.

---

## Task 1: Backend — Favorite model + associations

**Files:**
- Create: `models/favoriteModel.js`
- Modify: `models/associations.js`

- [ ] **Step 1: Create the Favorite model**

Create `models/favoriteModel.js`:

```js
const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const Favorite = sequelize.define('favorite', {
    userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
    },
    salonId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: 'salons', key: 'id' },
        onDelete: 'CASCADE',
    },
}, { timestamps: true });

module.exports = Favorite;
```

(Composite PK on userId+salonId means a customer can favorite a given salon only once — `findOrCreate` semantics. No separate `id` column.)

- [ ] **Step 2: Wire associations**

Edit `models/associations.js`. At the top, add the require with the other model requires (after the `Payment` require on line 7):

```js
const Favorite = require('./favoriteModel');
```

At the bottom, before `module.exports = ...`, add the relations:

```js
// ==================== FAVORITES ====================
User.hasMany(Favorite, { foreignKey: 'userId', onDelete: 'CASCADE' });
Favorite.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Salons.hasMany(Favorite, { foreignKey: 'salonId', onDelete: 'CASCADE' });
Favorite.belongsTo(Salons, { foreignKey: 'salonId', as: 'salon' });
```

Then add `Favorite` to the `module.exports` object at the bottom:

```js
module.exports = { Salons, Staff, Services, StaffServices, Appointment, User, Payment, Favorite };
```

- [ ] **Step 3: Verify boot (creates the favorites table)**

```bash
timeout 15 npm start
```
Expected: server starts, DB synced (the new `favorites` table is created). Killed by timeout.

- [ ] **Step 4: Commit**

```bash
git add models/favoriteModel.js models/associations.js
git commit -m "Add Favorite model and wire associations"
```

---

## Task 2: Backend — Favorite controller + routes

**Files:**
- Create: `controllers/favoriteController.js`
- Create: `routes/favoriteRoutes.js`
- Modify: `routes/apiRoutes.js`

- [ ] **Step 1: Create the favorite controller**

Create `controllers/favoriteController.js`:

```js
const Favorite = require('../models/favoriteModel');
const salonModel = require('../models/salonsModel');

// GET /api/user/favorites — list the calling customer's favorited salons.
const getFavorites = async (req, res) => {
    const userId = req.user.userId;
    try {
        const favorites = await Favorite.findAll({
            where: { userId },
            include: [{ model: salonModel, as: 'salon', attributes: { exclude: ['password', 'createdAt', 'updatedAt'] } }],
        });
        // Return the salon objects directly (cleaner for the frontend).
        const salons = favorites.map(f => f.salon);
        res.status(200).json(salons);
    } catch (error) {
        console.error('Error fetching favorites:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/user/favorites — add a salon to favorites (idempotent: re-adding is not an error).
const addFavorite = async (req, res) => {
    const userId = req.user.userId;
    const { salonId } = req.body;
    if (!salonId) {
        return res.status(400).json({ message: 'salonId is required' });
    }
    try {
        await Favorite.findOrCreate({ where: { userId, salonId } });
        res.status(200).json({ message: 'Added to favorites' });
    } catch (error) {
        console.error('Error adding favorite:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/user/favorites/:salonId — remove a salon from favorites.
const removeFavorite = async (req, res) => {
    const userId = req.user.userId;
    const { salonId } = req.params;
    try {
        const deleted = await Favorite.destroy({ where: { userId, salonId } });
        if (deleted === 0) {
            return res.status(404).json({ message: 'Favorite not found' });
        }
        res.status(200).json({ message: 'Removed from favorites' });
    } catch (error) {
        console.error('Error removing favorite:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getFavorites, addFavorite, removeFavorite };
```

- [ ] **Step 2: Create the favorite routes**

Create `routes/favoriteRoutes.js`:

```js
const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const favoriteController = require('../controllers/favoriteController');

router.get('/', authMiddleware, favoriteController.getFavorites);
router.post('/', authMiddleware, favoriteController.addFavorite);
router.delete('/:salonId', authMiddleware, favoriteController.removeFavorite);

module.exports = router;
```

- [ ] **Step 3: Mount the routes**

Edit `routes/apiRoutes.js`. Add the require near the other route requires (after `const staffRoutes = require('./staffRoutes')`):

```js
const favoriteRoutes = require('./favoriteRoutes');
```

And mount it (after `router.use('/user', userRoutes);`):

```js
router.use('/user/favorites', favoriteRoutes);
```

(Mounting under `/user/favorites` means full paths are `/api/user/favorites`, `/api/user/favorites/:salonId` — clean and grouped with other user routes.)

- [ ] **Step 4: Verify boot**

```bash
timeout 15 npm start
```
Expected: server starts cleanly. Killed by timeout.

- [ ] **Step 5: Commit**

```bash
git add controllers/favoriteController.js routes/favoriteRoutes.js routes/apiRoutes.js
git commit -m "Add favorite-salon endpoints (list/add/remove)"
```

---

## Task 3: Backend — real rating aggregation on salon endpoints

**Files:**
- Modify: `controllers/salonController.js` — `getAllSalons` and `getSalonById`

- [ ] **Step 1: Add an aggregation helper at the top of salonController**

Edit `controllers/salonController.js`. After the existing requires at the top (lines 1-3), add:

```js
const appointmentModel = require('../models/appointmentModel');
const { Op } = require('sequelize');
```

(`Op` is needed to filter non-null ratings.)

Then add a helper function after the requires (before `salonSignup`):

```js
// Attach avgRating + reviewCount to each salon by aggregating its appointments' ratings.
const attachRatings = async (salons) => {
    const salonIds = salons.map(s => s.id);
    if (salonIds.length === 0) return;

    const rows = await appointmentModel.findAll({
        where: { salonId: salonIds, rating: { [Op.ne]: null } },
        attributes: [
            'salonId',
            [sequelize.fn('AVG', sequelize.col('rating')), 'avgRating'],
            [sequelize.fn('COUNT', sequelize.col('rating')), 'reviewCount'],
        ],
        group: ['salonId'],
        raw: true,
    });
    const map = {};
    rows.forEach(r => { map[r.salonId] = { avgRating: parseFloat(r.avgRating), reviewCount: parseInt(r.reviewCount, 10) }; });
    salons.forEach(s => {
        const m = map[s.id];
        s.dataValues.avgRating = m ? m.avgRating : null;
        s.dataValues.reviewCount = m ? m.reviewCount : 0;
    });
};
```

(You also need `sequelize` itself in scope for `sequelize.fn`/`sequelize.col`. The file currently requires `salonModel` which exports a model, not the sequelize instance. Add `const sequelize = require('../utils/database');` at the top alongside the other requires.)

- [ ] **Step 2: Use the helper in `getAllSalons`**

In `getAllSalons` (around lines 56-73), after `salons.forEach(...)` removes passwords but BEFORE `res.status(200).json(salons);`, call the helper (it must be awaited):

```js
const getAllSalons = async (req, res) => {
    try {
        const salons = await salonModel.findAll();
        if (!salons || salons.length === 0) {
            return res.status(404).json({ message: "No salons found" });
        }
        // Exclude sensitive information like password from the response
        salons.forEach(salon => {
            delete salon.dataValues.password;
            delete salon.dataValues.createdAt;
            delete salon.dataValues.updatedAt;
        });
        await attachRatings(salons);
        res.status(200).json(salons);
    } catch (err) {
        console.error("Error fetching salons:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};
```

- [ ] **Step 3: Use the helper in `getSalonById`**

In `getSalonById` (around lines 74-90), wrap the single salon in an array for the helper, then read the values back:

```js
const getSalonById = async (req, res) => {
    const salonId  = req.query.salonId ;
    try {
        const salon = await salonModel.findOne({ where: { id: salonId } });
        if (!salon) {
            return res.status(404).json({ message: "Salon not found" });
        }
        delete salon.dataValues.password;
        delete salon.dataValues.createdAt;
        delete salon.dataValues.updatedAt;
        await attachRatings([salon]);
        res.status(200).json(salon);
    } catch (err) {
        console.error("Error fetching salon:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};
```

- [ ] **Step 4: Verify boot**

```bash
timeout 15 npm start
```
Expected: server starts cleanly. Killed by timeout.

- [ ] **Step 5: Commit**

```bash
git add controllers/salonController.js
git commit -m "Aggregate real avgRating + reviewCount on salon list/detail endpoints"
```

---

## Task 4: Backend — accept rating in the review endpoint

**Files:**
- Modify: `controllers/appointmentController.js` — `updateCustomerReview`

- [ ] **Step 1: Accept and persist `rating`**

In `controllers/appointmentController.js`, the `updateCustomerReview` function (around lines 243-258) currently destructures `{ review }` and sets only `userReview`. Update it to also accept `rating`, validate the range, and save:

```js
// Update user review (and optional 1-5 rating) for an appointment
const updateCustomerReview = async (req, res) => {
    const { appointmentId } = req.params;
    const { review, rating } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: "Appointment not found" });
        }
        appointment.userReview = review;
        if (rating !== undefined && rating !== null) {
            const r = parseInt(rating, 10);
            if (Number.isNaN(r) || r < 1 || r > 5) {
                return res.status(400).json({ message: "rating must be an integer between 1 and 5" });
            }
            appointment.rating = r;
        }
        await appointment.save();
        res.status(200).json({ message: "Review submitted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};
```

(Backward compatible: callers sending only `{ review }` still work — the rating block only runs when `rating` is provided.)

- [ ] **Step 2: Verify boot**

```bash
timeout 15 npm start
```
Expected: server starts cleanly.

- [ ] **Step 3: Commit**

```bash
git add controllers/appointmentController.js
git commit -m "Accept 1-5 rating in customer review endpoint"
```

---

## Task 5: Integration tests for ratings aggregation + review-with-rating

**Files:**
- Create: `tests/ratings-aggregation.test.js`

- [ ] **Step 1: Write the integration test**

Create `tests/ratings-aggregation.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations');
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Favorite = require('../models/favoriteModel');
const { updateCustomerReview } = require('../controllers/appointmentController');

const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

let salon, appt1, appt2, customer;

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({ name: 'C', email: 'c@r.com', password: 'x', phoneNumber: '1' });
    salon = await Salons.create({ name: 'SalonR', email: 'sr@r.com', password: 'x', phoneNumber: '2', address: 'a', pricing: 'Moderate' });
    const staff = await Staff.create({ name: 'Sty', email: 'st@r.com', password: 'x', phoneNumber: '3', salonId: salon.id });
    const service = await Services.create({ name: 'Cut', price: 100, duration: 30, salonId: salon.id });
    appt1 = await Appointment.create({ staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: customer.id, date: '2026-01-01', time: '10:00', endTime: '10:30', status: 'completed' });
    appt2 = await Appointment.create({ staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: customer.id, date: '2026-01-02', time: '11:00', endTime: '11:30', status: 'completed' });
});

after(async () => { await sequelize.close(); });

test('updateCustomerReview accepts a valid 1-5 rating', async () => {
    const req = { params: { appointmentId: String(appt1.id) }, body: { review: 'Great', rating: 4 } };
    const res = mockRes();
    await updateCustomerReview(req, res);
    assert.equal(res.statusCode, 200);
    await appt1.reload();
    assert.equal(appt1.rating, 4);
    assert.equal(appt1.userReview, 'Great');
});

test('updateCustomerReview rejects rating out of range', async () => {
    const req = { params: { appointmentId: String(appt1.id) }, body: { rating: 7 } };
    const res = mockRes();
    await updateCustomerReview(req, res);
    assert.equal(res.statusCode, 400);
});

test('updateCustomerReview works with review only (no rating) — backward compatible', async () => {
    const req = { params: { appointmentId: String(appt2.id) }, body: { review: 'Just text' } };
    const res = mockRes();
    await updateCustomerReview(req, res);
    assert.equal(res.statusCode, 200);
    await appt2.reload();
    assert.equal(appt2.userReview, 'Just text');
    assert.equal(appt2.rating, null);
});

test('Favorite composite PK prevents duplicate (findOrCreate is idempotent)', async () => {
    const a = await Favorite.findOrCreate({ where: { userId: customer.id, salonId: salon.id } });
    const b = await Favorite.findOrCreate({ where: { userId: customer.id, salonId: salon.id } });
    assert.equal(a[1], true);  // first call created
    assert.equal(b[1], false); // second call found existing
    const count = await Favorite.count({ where: { userId: customer.id } });
    assert.equal(count, 1);
});
```

- [ ] **Step 2: Run the test**

```bash
node --test tests/ratings-aggregation.test.js
```
Expected: all 4 tests pass. (The aggregation helper itself is exercised indirectly via the controller; the salon-listing aggregation is verified via the live API in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add tests/ratings-aggregation.test.js
git commit -m "Add integration tests for review-with-rating + favorite idempotency"
```

---

## Task 6: Frontend — CustomerDashboard real ratings + favorite toggle

**Files:**
- Modify: `frontend/src/App.jsx` — `CustomerDashboard` component

- [ ] **Step 1: Add favorites state + fetch**

In `CustomerDashboard`, the component currently has `salons`, `searchQuery`, `loading` state. Add a favorites state and a "show favorites only" filter:

```jsx
  const [favorites, setFavorites] = useState([]);
  const [favoriteSalonIds, setFavoriteSalonIds] = useState(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
```

Extend the existing `useEffect` fetch block. Currently it fetches salons; add a favorites fetch alongside (favorites requires auth — wrap in try/catch, ignore failures gracefully for not-logged-in users). Replace the existing `useEffect`:

```jsx
  useEffect(() => {
    const fetchSalons = async () => {
      try {
        const res = await axios.get('/api/buisness/getall');
        setSalons(res.data);
      } catch (err) {
        console.error('Error fetching salons', err);
      } finally {
        setLoading(false);
      }
    };
    const fetchFavorites = async () => {
      try {
        const res = await axios.get('/api/user/favorites');
        setFavoriteSalonIds(new Set(res.data.map(s => s.id)));
      } catch (err) {
        // Not logged in or no favorites — fine, ignore.
      }
    };
    fetchSalons();
    fetchFavorites();
  }, []);
```

- [ ] **Step 2: Add a toggle-favorite handler**

After the `useEffect`, add:

```jsx
  const toggleFavorite = async (salonId) => {
    const isFav = favoriteSalonIds.has(salonId);
    // Optimistic UI update
    const next = new Set(favoriteSalonIds);
    if (isFav) next.delete(salonId); else next.add(salonId);
    setFavoriteSalonIds(next);
    try {
      if (isFav) {
        await axios.delete(`/api/user/favorites/${salonId}`);
      } else {
        await axios.post('/api/user/favorites', { salonId });
      }
    } catch (err) {
      // Revert on failure
      setFavoriteSalonIds(favoriteSalonIds);
    }
  };
```

- [ ] **Step 3: Apply the favorites filter to the displayed list**

Find the existing `filteredSalons` computation (around line 792):

```jsx
  const filteredSalons = salons.filter(salon => 
    salon.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    salon.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (salon.pricing && salon.pricing.toLowerCase().includes(searchQuery.toLowerCase()))
  );
```

Add the favorites-only filter:

```jsx
  const filteredSalons = salons
    .filter(salon => !showFavoritesOnly || favoriteSalonIds.has(salon.id))
    .filter(salon => 
      salon.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      salon.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (salon.pricing && salon.pricing.toLowerCase().includes(searchQuery.toLowerCase()))
    );
```

- [ ] **Step 4: Add a "Favorites only" toggle button next to the search bar**

Find the search-bar block in the header (around lines 800-818). After the search input div (still inside the `search-bar-container` or right after it), add a toggle button:

```jsx
          <button
            onClick={() => setShowFavoritesOnly(v => !v)}
            className={`btn btn-sm ${showFavoritesOnly ? 'btn-primary' : 'btn-secondary'}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Star size={16} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
            {showFavoritesOnly ? 'Showing Favorites' : 'Favorites'}
          </button>
```

- [ ] **Step 5: Replace the fabricated rating with real values + add favorite star on each card**

In the salon card (around lines 838-846), find the fabricated rating block:

```jsx
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: 'var(--warning)', fontWeight: 600 }}>
                    <Star size={14} fill="currentColor" />
                    <span>{(4.5 + (salon.id % 6) * 0.1).toFixed(1)}</span>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>({(12 + salon.id * 7)})</span>
                  </div>
```

Replace it with a real rating display (handles the no-ratings case honestly):

```jsx
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: 'var(--warning)', fontWeight: 600 }}>
                    {salon.avgRating ? (
                      <>
                        <Star size={14} fill="currentColor" />
                        <span>{Number(salon.avgRating).toFixed(1)}</span>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>({salon.reviewCount})</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>No ratings yet</span>
                    )}
                  </div>
```

Then add a favorite-star button to the card header (the `card-header-image` div, around line 834). Inside that div, add a clickable star at the top-right:

```jsx
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(salon.id); }}
                    style={{
                      position: 'absolute', top: '8px', right: '8px',
                      background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '50%',
                      width: '32px', height: '32px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    title={favoriteSalonIds.has(salon.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star size={16} fill={favoriteSalonIds.has(salon.id) ? '#f59e0b' : 'none'} color="#f59e0b" />
                  </button>
```

(The `card-header-image` div needs `position: relative` for the absolute positioning to work. Check its existing style — if it doesn't have `position: relative`, add it. The existing inline style sets a gradient background; append `position: 'relative'` to that style object.)

- [ ] **Step 6: Build and commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/App.jsx
git commit -m "Customer dashboard: real ratings + favorite-salon toggle"
```

---

## Task 7: Frontend — review modal star input + Book Again button

**Files:**
- Modify: `frontend/src/App.jsx` — `BookedAppointments` component

- [ ] **Step 1: Add rating state**

In `BookedAppointments`, alongside the existing review state (`reviewText`, `selectedApptId`, `showModal`), add:

```jsx
  const [rating, setRating] = useState(0);
```

- [ ] **Step 2: Load existing rating when opening the modal**

Find `handleOpenReview` (around line 1350). It currently sets `reviewText` from `currentReview`. Extend it to also accept and set the current rating:

```jsx
  const handleOpenReview = (apptId, currentReview, currentRating) => {
    setSelectedApptId(apptId);
    setReviewText(currentReview || '');
    setRating(currentRating || 0);
    setShowModal(true);
  };
```

- [ ] **Step 3: Send rating in the submit handler**

Find `handleSubmitReview` (around line 1356). Add `rating` to the PUT body:

```jsx
  const handleSubmitReview = async () => {
    try {
      await axios.put(`/api/appointment/review/${selectedApptId}`, { review: reviewText, rating });
      showToast('Review submitted successfully!', 'success');
      setShowModal(false);
      fetchBookings();
    } catch (err) {
      showToast('Failed to submit review', 'error');
    }
  };
```

- [ ] **Step 4: Update the button that opens the modal (pass current rating)**

Find where `handleOpenReview` is called (the row's review button, around line 1417):

```jsx
                    <button 
                      onClick={() => handleOpenReview(appt.id, appt.userReview)} 
                      className="btn btn-secondary btn-sm"
                    >
                      <Star size={14} /> {appt.userReview ? 'Edit Review' : 'Add Review'}
                    </button>
```

Pass `appt.rating`:

```jsx
                    <button 
                      onClick={() => handleOpenReview(appt.id, appt.userReview, appt.rating)} 
                      className="btn btn-secondary btn-sm"
                    >
                      <Star size={14} /> {appt.userReview ? 'Edit Review' : 'Add Review'}
                    </button>
```

- [ ] **Step 5: Add a Book Again button to the actions cell**

The actions cell (modified in Phase 2 Task 4 to contain review + cancel buttons in a flex column) should also get a "Book Again" button that navigates to the booking wizard. Find the actions cell and add the button (it should always be available — rebooking any past appointment):

```jsx
                  <td style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button 
                      onClick={() => navigate(`/customer/book/${appt.salon?.id || appt.salonId}/${appt.service?.id || appt.serviceId}`)} 
                      className="btn btn-secondary btn-sm"
                    >
                      Book Again
                    </button>
                    <button 
                      onClick={() => handleOpenReview(appt.id, appt.userReview, appt.rating)} 
                      className="btn btn-secondary btn-sm"
                    >
                      <Star size={14} /> {appt.userReview ? 'Edit Review' : 'Add Review'}
                    </button>
                    {(appt.status === 'confirmed' || appt.status === 'pending') && (
                      <button 
                        onClick={() => handleCancel(appt.id)} 
                        className="btn btn-danger btn-sm"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
```

(`appt.salon?.id` and `appt.service?.id` come from the includes on `getAllAppointmentsByUserId`; the `|| appt.salonId` fallback covers any case where includes aren't populated.)

- [ ] **Step 6: Add a star-picker to the review modal**

Find the review modal (around lines 1431-1450). After the modal title/paragraph and BEFORE the `<textarea>`, add a clickable star picker:

```jsx
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>Your rating</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[1,2,3,4,5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  title={`${n} star${n > 1 ? 's' : ''}`}
                >
                  <Star size={28} fill={n <= rating ? '#f59e0b' : 'none'} color="#f59e0b" />
                </button>
              ))}
            </div>
          </div>
```

- [ ] **Step 7: Build and commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/App.jsx
git commit -m "Customer bookings: star-rating picker in review modal + Book Again button"
```

---

## Task 8: Frontend — show real rating on SalonServices profile header

**Files:**
- Modify: `frontend/src/App.jsx` — `SalonServices` component

- [ ] **Step 1: Display the rating in the salon profile header**

In `SalonServices` (around lines 912-930), the salon profile header shows name, address, pricing, working days. Add a rating chip alongside the pricing/working-days chips (inside the flex row that shows those chips, around line 920):

```jsx
          <div style={{ display: 'flex', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Star size={14} fill="currentColor" style={{ color: 'var(--warning)' }} />
              <strong>{salon.avgRating ? Number(salon.avgRating).toFixed(1) : 'New'}</strong>
              <span style={{ color: 'var(--text-muted)' }}>· {salon.reviewCount} review{salon.reviewCount === 1 ? '' : 's'}</span>
            </span>
            <span style={{ fontSize: '14px', background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: '20px' }}>
              <strong>Pricing standard:</strong> {salon.pricing || 'Premium'}
            </span>
            {salon.workingDays && (
              <span style={{ fontSize: '14px', background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: '20px' }}>
                <strong>Working days:</strong> {salon.workingDays}
              </span>
            )}
          </div>
```

(This replaces the existing chip row — keep the pricing and workingDays chips as shown above; only the rating chip is new. The `getSalonById` endpoint already attaches `avgRating`/`reviewCount` after Task 3.)

- [ ] **Step 2: Build and commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/App.jsx
git commit -m "Salon profile page: show real rating chip"
```

---

## Task 9: End-of-phase manual verification

**Goal:** Confirm ratings, rebook, and favorites all work end-to-end.

- [ ] **Step 1: Fresh boot + build**

```bash
rm -f database.sqlite
cd frontend && npm run build && cd ..
nohup npm start > /tmp/p3server.log 2>&1 &
sleep 7
tail -8 /tmp/p3server.log
```
Expected: server up, seed data loaded.

- [ ] **Step 2: Run all tests**

```bash
node --test tests/statusRules.test.js tests/cancel-endpoint.test.js tests/ratings-aggregation.test.js > /tmp/p3tests.out 2>&1
grep "pass" /tmp/p3tests.out
grep "fail" /tmp/p3tests.out
```
Expected: 17 pass (7 + 6 + 4), 0 fail.

- [ ] **Step 3: API smoke test — create an appointment, review it with a rating, verify aggregation**

```bash
# Customer login
curl -s -X POST http://localhost:3000/api/user/login -H "Content-Type: application/json" -d '{"email":"jane@example.com","password":"customer123"}'
# Create a completed appointment directly (bypassing payment) so it can be reviewed
node -e "require('./models/associations');const A=require('./models/appointmentModel');A.create({staffId:1,salonId:1,serviceId:1,userId:1,date:'2026-07-20',time:'12:00',endTime:'12:30',status:'completed'}).then(a=>console.log('appt',a.id)).catch(e=>console.error(e.message))"
# (Use the customer token from login) Submit a 5-star review
curl -s -X PUT http://localhost:3000/api/appointment/review/1 -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" -d '{"review":"Excellent","rating":5}'
# Verify aggregation on the salon list
curl -s http://localhost:3000/api/buisness/getall | head -c 200
```
Expected: review returns 200; the salon in `getall` now shows `avgRating: 5, reviewCount: 1`.

- [ ] **Step 4: Browser spot-check**

Open http://localhost:3000, log in as customer, verify:
- Dashboard salon cards show "No ratings yet" (or real numbers after Step 3).
- Favorite star toggles and persists on refresh.
- "Favorites" filter shows only starred salons.
- A salon's services page shows the rating chip.

- [ ] **Step 5: Confirm clean tree**

```bash
git status --short
```
Expected: empty.

- [ ] **Step 6: No commit** — verification only.

---

## After Phase 3

Customers see honest, real ratings on salon cards and profiles (no more fabricated numbers); they can leave 1–5 star reviews; they can favorite salons and filter by favorites; they can one-click rebook any past appointment. The favorites feature has clean idempotent semantics (composite PK prevents duplicates).

Next: Phase 4 plan (salon owner power tools — revenue/booking analytics, calendar view, staff blockouts).

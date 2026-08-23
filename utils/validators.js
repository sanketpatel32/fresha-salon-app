/**
 * Request validation schemas and middleware.
 *
 * Validates the request body (or query) against a zod schema before the
 * controller runs. On failure, returns 400 with the first issue's message —
 * enough for the client to fix the input, without leaking schema internals.
 */
const { z } = require('zod');

const validate = (schema, source = 'body') => (req, _res, next) => {
  const target = source === 'query' ? req.query : req.body;
  const result = schema.safeParse(target);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const err = new Error(firstIssue ? firstIssue.message : 'Invalid request');
    err.status = 400;
    return next(err);
  }
  // Replace with the parsed (and coerced/trimmed) values.
  if (source === 'query') {
    req.query = result.data;
  } else {
    req.body = result.data;
  }
  next();
};

// ── Auth ───────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

const customerSignupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('A valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phoneNumber: z.string().min(7, 'A valid phone number is required').max(20),
});

const salonSignupSchema = z.object({
  name: z.string().min(1, 'Salon name is required').max(120),
  email: z.string().email('A valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phoneNumber: z.string().min(7, 'A valid phone number is required').max(20),
  address: z.string().min(1, 'Address is required').max(300),
  pricing: z.enum(['Affordable', 'Moderate', 'Premium']).optional(),
});

const adminLoginSchema = z.object({
  email: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// ── Password reset ─────────────────────────────────────────────────────
const forgotPasswordSchema = z.object({
  email: z.string().email('A valid email is required'),
});

// Both the token and email must match what was issued; the replacement
// password clears a stricter bar than signup (8 chars vs 6).
const resetPasswordSchema = z.object({
  email: z.string().email('A valid email is required'),
  token: z.string().min(1, 'Reset token is required').max(128),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// ── Email verification ────────────────────────────────────────────────
const verifyEmailSchema = z.object({
  email: z.string().email('A valid email is required'),
  token: z.string().min(1, 'Verification token is required').max(128),
});

const resendVerificationSchema = z.object({
  email: z.string().email('A valid email is required'),
});

// ── Services ───────────────────────────────────────────────────────────
const SERVICE_CATEGORIES = [
  'Hair', 'Spa & Massage', 'Facial & Skin', 'Nails',
  'Makeup', 'Bridal', "Men's Grooming", 'Other',
];

const serviceAddSchema = z.object({
  name: z.string().min(1, 'Service name is required').max(150),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  price: z.number().positive('Price must be a positive number'),
  duration: z.number().int().positive('Duration must be a positive integer (minutes)').max(600, 'Duration seems too long'),
});

const serviceUpdateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  price: z.number().positive('Price must be a positive number').optional(),
  duration: z.number().int().positive().max(600).optional(),
  statusbar: z.enum(['active', 'inactive']).optional(),
});

// ── Salon browse / discovery (GET query params) ─────────────────────────
const salonBrowseSchema = z.object({
  q: z.string().max(200).optional(),
  // Newer, portable case-insensitive text search (see getAllSalons): trimmed
  // so leading/trailing whitespace can't silently narrow a substring match.
  search: z.string().trim().max(200).optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  pricing: z.enum(['Affordable', 'Moderate', 'Premium']).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  sort: z.enum(['rating', 'price-low', 'price-high', 'newest', 'name']).optional(),
  page: z.coerce.number().int().positive().max(1000).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// ── Appointment check ──────────────────────────────────────────────────
const appointmentCheckSchema = z.object({
  dateSelect: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateSelect must be YYYY-MM-DD'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:mm'),
  salonId: z.coerce.number().int().positive(),
  serviceId: z.coerce.number().int().positive(),
  duration: z.coerce.number().int().positive().max(600),
});

// ── Payment order creation ─────────────────────────────────────────────
// Note: servicePrice is intentionally NOT here — the server looks it up.
// Numbers are coerced because the frontend may send stringified ids.
// Date-only strings (YYYY-MM-DD) are shared by promo windows + CSV export.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const paymentCreateSchema = z.object({
  serviceId: z.coerce.number().int().positive(),
  salonId: z.coerce.number().int().positive(),
  staffId: z.coerce.number().int().positive(),
  dateSelect: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.coerce.number().int().positive().max(600),
  // servicePrice is accepted but IGNORED — the server reads the real price
  // from the services table. Kept in the schema so the frontend's payload
  // isn't rejected, but it carries no authority.
  servicePrice: z.coerce.number().optional(),
  // Optional promo code. Trimmed + uppercased here so every downstream
  // lookup/uniqueness check sees one canonical form.
  promoCode: z.string().trim().toUpperCase().max(64, 'Promo code is too long').optional(),
  // Optional free-text note from the customer to the salon ("please use
  // hypoallergenic dye"). Trimmed so whitespace-only input can't masquerade
  // as a note; the controller stores null when it arrives empty. The note
  // rides on the Payment row until payment succeeds, then lands on the
  // Appointment (see finalizeAppointmentFromPayment).
  customerNote: z.string().trim()
    .max(500, 'Customer note cannot exceed 500 characters')
    .optional()
    .nullable(),
});

// ── Promo codes (salon management) ─────────────────────────────────────
// Code charset: letters/digits/hyphen/underscore, 3–20 chars, stored
// uppercase (the .toUpperCase() runs before the length/regex checks).
const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9\-_]*$/;
const promoBaseSchema = z.object({
  code: z.string().trim().toUpperCase()
    .min(3, 'Promo code must be 3-20 characters').max(20, 'Promo code must be 3-20 characters')
    .regex(PROMO_CODE_RE, 'Promo code may only contain letters, numbers, hyphens and underscores'),
  discountType: z.enum(['percent', 'flat'], { message: 'discountType must be percent or flat' }),
  discountValue: z.coerce.number().positive('Discount value must be greater than zero')
    .max(1000000, 'Discount value is too large'),
  maxDiscountAmount: z.coerce.number().positive('Max discount must be a positive number')
    .max(1000000).optional().nullable(),
  minOrderAmount: z.coerce.number().min(0, 'Minimum order amount cannot be negative').optional(),
  validFrom: z.string().regex(DATE_ONLY_RE, 'validFrom must be YYYY-MM-DD').optional().nullable(),
  validUntil: z.string().regex(DATE_ONLY_RE, 'validUntil must be YYYY-MM-DD').optional().nullable(),
  usageLimit: z.coerce.number().int('Usage limit must be a whole number')
    .positive('Usage limit must be a positive number').max(1000000).optional().nullable(),
}).superRefine((d, ctx) => {
  if (d.discountType === 'percent' && d.discountValue > 100) {
    ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Percent discount cannot exceed 100' });
  }
  if (d.validFrom && d.validUntil && d.validFrom > d.validUntil) {
    ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'validUntil must be on or after validFrom' });
  }
});
const promoCreateSchema = promoBaseSchema;

// PATCH /promos/:id — partial edit. `code`, `discountType` and salonId are
// deliberately immutable here (a code is what customers already know; type
 // changes silently rewrite the deal's meaning).
const promoUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  maxDiscountAmount: z.coerce.number().positive('Max discount must be a positive number')
    .max(1000000).optional().nullable(),
  minOrderAmount: z.coerce.number().min(0, 'Minimum order amount cannot be negative').optional(),
  validFrom: z.string().regex(DATE_ONLY_RE, 'validFrom must be YYYY-MM-DD').optional().nullable(),
  validUntil: z.string().regex(DATE_ONLY_RE, 'validUntil must be YYYY-MM-DD').optional().nullable(),
  usageLimit: z.coerce.number().int('Usage limit must be a whole number')
    .positive('Usage limit must be a positive number').max(1000000).optional().nullable(),
}).refine(
  (d) => !d.validFrom || !d.validUntil || d.validFrom <= d.validUntil,
  { message: 'validUntil must be on or after validFrom', path: ['validUntil'] }
);

// ── Reschedule ─────────────────────────────────────────────────────────
// New slot must be today-or-later (YYYY-MM-DD strings compare correctly);
// staffId is optional — omitted means "keep the currently assigned staff".
// customerNote is optional too: a non-empty value overwrites the booking's
// note, an empty (or whitespace-only) string CLEARS it — the controller
// stores null — and omitting it leaves any existing note untouched.
const rescheduleSchema = z.object({
  dateSelect: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateSelect must be YYYY-MM-DD').refine(
    (d) => d >= new Date().toISOString().slice(0, 10),
    { message: 'dateSelect must be today or later' }
  ),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:mm'),
  staffId: z.coerce.number().int().positive('staffId must be a positive integer').optional(),
  customerNote: z.string().trim()
    .max(500, 'Customer note cannot exceed 500 characters')
    .optional()
    .nullable(),
});

// ── Reviews ────────────────────────────────────────────────────────────
const customerReviewSchema = z.object({
  review: z.string().max(2000, 'Review is too long').optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
});

const staffReviewSchema = z.object({
  review: z.string().max(2000, 'Note is too long').optional().nullable(),
});

// Salon owner's public reply to a customer review. Required, non-empty,
// capped at 1000 chars.
const reviewReplySchema = z.object({
  reply: z.string().trim().min(1, 'Reply cannot be empty').max(1000, 'Reply is too long'),
});

// ── Status update ──────────────────────────────────────────────────────
const statusUpdateSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'declined', 'completed', 'cancelled']),
});

// ── Staff management ───────────────────────────────────────────────────
// A staff account is a login credential, so password length is enforced.
const staffAddSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('A valid email is required'),
  phoneNumber: z.string().min(7, 'A valid phone number is required').max(20),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const staffUpdateStatusSchema = z.object({
  staffId: z.coerce.number().int().positive(),
  status: z.enum(['active', 'inactive'], 'Status must be active or inactive'),
});

const staffAssignServicesSchema = z.object({
  staffId: z.coerce.number().int().positive(),
  services: z.array(z.coerce.number().int().positive()).max(100, 'Too many services'),
});

// ── Favorites ──────────────────────────────────────────────────────────
const favoriteAddSchema = z.object({
  salonId: z.coerce.number().int().positive('A valid salon id is required'),
});

// ── Salon details update (settings form) ───────────────────────────────
// workingDays must be an array of lowercase day codes — this is the shape
// availabilityService.validateSalonHours requires, and a bad shape here would
// silently disable the salon-hours enforcement on the booking flow.
const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const salonDetailsSchema = z.object({
  salonId: z.coerce.number().int().positive().optional(),
  name: z.string().min(1).max(120).optional(),
  phoneNumber: z.string().min(7).max(20).optional(),
  address: z.string().min(1).max(300).optional(),
  workingDays: z.array(z.enum(DAY_CODES)).min(1, 'Select at least one working day').optional(),
  openingTime: z.string().regex(TIME_RE, 'Opening time must be HH:mm').optional(),
  closingTime: z.string().regex(TIME_RE, 'Closing time must be HH:mm').optional(),
  requiresApproval: z.boolean().optional(),
}).refine(
  (d) => !(d.openingTime && d.closingTime) || d.closingTime > d.openingTime,
  { message: 'Closing time must be after opening time', path: ['closingTime'] }
);

// ── Salon photo gallery ────────────────────────────────────────────────
// Up to 10 http(s) image URLs per salon. Items are trimmed and duplicates
// collapse silently here (a repeated paste shouldn't 400). A regex pins the
// scheme to http/https instead of zod's .url(), which also accepts ftp://
// and other schemes we don't want to render as <img> sources.
const GALLERY_URL_RE = /^https?:\/\/\S+$/i;
const gallerySchema = z.object({
  images: z.array(
    z.string().trim()
      .min(1, 'Image URL cannot be empty')
      .max(2048, 'Image URL is too long')
      .regex(GALLERY_URL_RE, 'Each image must be a valid http(s) URL')
  ).max(10, 'A gallery can hold at most 10 images'),
}).transform((d) => ({ images: [...new Set(d.images)] }));

// ── Admin search ───────────────────────────────────────────────────────
// Used as a query schema. minLength guards against trivially broad LIKE scans.
const adminSearchSchema = z.object({
  searchTerm: z.string().trim().min(2, 'Search term must be at least 2 characters').max(100),
});

// ── Appointment CSV export (GET query params) ──────────────────────────
// Optional from/to bounds, YYYY-MM-DD each. Date-only strings compare
// correctly as plain text, so the from<=to guard needs no date parsing.
const csvExportSchema = z.object({
  from: z.string().regex(DATE_ONLY_RE, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_ONLY_RE, 'to must be YYYY-MM-DD').optional(),
}).refine(
  (d) => !d.from || !d.to || d.from <= d.to,
  { message: 'from must be on or before to', path: ['from'] }
);

// ── Public salon services lookup ───────────────────────────────────────
// The dashboard's services list takes salonId as a query param. Coerce +
// positive-int so garbage ids (empty strings, negatives, injection attempts)
// are rejected with 400 before reaching the DB.
const activeServicesBySalonSchema = z.object({
  salonId: z.coerce.number().int().positive('A valid salon id is required'),
});

// ── Booking config (lead time & slot grid) ─────────────────────────────
// Per-salon booking policy. Lead time is capped at 10080 minutes (7 days) so
// a salon can't set an absurd wall that silently blocks all bookings; the
// slot step is a closed enum so pickers stay on sane grids.
const SLOT_STEP_OPTIONS = [10, 15, 20, 30, 45, 60];
const bookingConfigSchema = z.object({
  bookingLeadTimeMinutes: z.coerce
    .number()
    .int('Booking lead time must be a whole number of minutes')
    .min(0, 'Booking lead time cannot be negative')
    .max(10080, 'Booking lead time cannot exceed 7 days (10080 minutes)'),
  slotStepMinutes: z.coerce
    .number()
    .int('Slot step must be a whole number of minutes')
    .refine((v) => SLOT_STEP_OPTIONS.includes(v), {
      message: `Slot step must be one of ${SLOT_STEP_OPTIONS.join(', ')} minutes`,
    })
    .nullable(), // explicit null = "use the default 30"
});

// ── Public salon staff directory ───────────────────────────────────────
// GET /business/staff?salonId=N. Same coerce + positive-int guard as the
// public services lookup, so garbage ids (empty strings, negatives,
// injection attempts) are rejected with 400 before reaching the DB.
const staffDirectorySchema = z.object({
  salonId: z.coerce.number().int().positive('A valid salon id is required'),
});

// ── Weekly working hours ───────────────────────────────────────────────
// Per-day schedule editor; once saved it replaces the legacy single-window
// model for that salon (see availabilityService.validateSalonHours). Exactly
// seven keys "0"-"6" (= Sunday..Saturday), each { open, close, closed }:
// strict 24h HH:mm times with open<close REQUIRED on days the salon is open;
// closed:true days may omit times entirely (enforcement ignores them). The
// parsed object is what gets JSON.stringify'd into Salons.weeklyHours, so
// the stored form is always canonical.
const weekDaySchema = z.object({
  open: z.string().regex(TIME_RE, 'Times must be 24h HH:mm').optional(),
  close: z.string().regex(TIME_RE, 'Times must be 24h HH:mm').optional(),
  closed: z.boolean('closed must be true or false'),
})
  .refine((d) => d.closed || d.open !== undefined, {
    message: 'Open time is required on days the salon is open', path: ['open'],
  })
  .refine((d) => d.closed || d.close !== undefined, {
    message: 'Close time is required on days the salon is open', path: ['close'],
  })
  .refine((d) => d.closed || !d.open || !d.close || d.close > d.open, {
    message: 'Closing time must be after opening time', path: ['close'],
  });

const weeklyHoursSchema = z.object({
  weeklyHours: z.object(Object.fromEntries(
    ['0', '1', '2', '3', '4', '5', '6'].map((k) => [k, weekDaySchema])
  )),
});

module.exports = {
  validate,
  SLOT_STEP_OPTIONS,
  SERVICE_CATEGORIES,
  DAY_CODES,
  loginSchema,
  customerSignupSchema,
  salonSignupSchema,
  adminLoginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  serviceAddSchema,
  serviceUpdateSchema,
  salonBrowseSchema,
  appointmentCheckSchema,
  paymentCreateSchema,
  customerReviewSchema,
  staffReviewSchema,
  reviewReplySchema,
  statusUpdateSchema,
  staffAddSchema,
  staffUpdateStatusSchema,
  staffAssignServicesSchema,
  favoriteAddSchema,
  salonDetailsSchema,
  gallerySchema,
  adminSearchSchema,
  activeServicesBySalonSchema,
  csvExportSchema,
  rescheduleSchema,
  promoCreateSchema,
  promoUpdateSchema,
  bookingConfigSchema,
  weeklyHoursSchema,
  staffDirectorySchema,
};

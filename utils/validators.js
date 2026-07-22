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

// ── Services ───────────────────────────────────────────────────────────
const serviceAddSchema = z.object({
  name: z.string().min(1, 'Service name is required').max(150),
  price: z.number().positive('Price must be a positive number'),
  duration: z.number().int().positive('Duration must be a positive integer (minutes)').max(600, 'Duration seems too long'),
});

const serviceUpdateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  price: z.number().positive('Price must be a positive number').optional(),
  duration: z.number().int().positive().max(600).optional(),
  statusbar: z.enum(['active', 'inactive']).optional(),
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
});

// ── Reviews ────────────────────────────────────────────────────────────
const customerReviewSchema = z.object({
  review: z.string().max(2000, 'Review is too long').optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
});

const staffReviewSchema = z.object({
  review: z.string().max(2000, 'Note is too long').optional().nullable(),
});

// ── Status update ──────────────────────────────────────────────────────
const statusUpdateSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'declined', 'completed', 'cancelled']),
});

module.exports = {
  validate,
  loginSchema,
  customerSignupSchema,
  salonSignupSchema,
  adminLoginSchema,
  serviceAddSchema,
  serviceUpdateSchema,
  appointmentCheckSchema,
  paymentCreateSchema,
  customerReviewSchema,
  staffReviewSchema,
  statusUpdateSchema,
};

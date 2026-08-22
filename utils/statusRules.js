// Pure status-transition rules for Appointment.status.
// Kept here (not in a controller) so every caller applies the same rules
// and they can be unit-tested without a database.

const CANCEL_WINDOW_HOURS = 24;

// Allowed forward transitions. Anything not listed is illegal.
const ALLOWED_TRANSITIONS = {
    pending:   ['confirmed', 'declined', 'cancelled'],   // no-show needs a confirmation first
    confirmed: ['completed', 'cancelled', 'no-show'],
    declined:  [],   // terminal
    completed: [],   // terminal
    cancelled: [],   // terminal
    'no-show': [],   // terminal
};

/**
 * Returns true if an appointment may move from `from` status to `to` status.
 * @param {string} from - current status
 * @param {string} to   - desired status
 */
function canTransition(from, to) {
    if (from === to) return false;
    const allowed = ALLOWED_TRANSITIONS[from];
    return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Returns true if a customer may cancel an appointment.
 * Rules: status must be cancellable, AND start must be > CANCEL_WINDOW_HOURS away.
 * @param {string} status    - current appointment status
 * @param {Date}   startAt   - the appointment's start Date (date + time combined)
 */
function canCancel(status, startAt) {
    if (!canTransition(status, 'cancelled')) return false;
    const now = Date.now();
    const msUntilStart = new Date(startAt).getTime() - now;
    return msUntilStart > CANCEL_WINDOW_HOURS * 3600 * 1000;
}

/**
 * Returns true if a customer may reschedule an appointment.
 * Same boundary semantics as canCancel: status must still be changeable
 * (pending or confirmed — declined/completed/cancelled are terminal) AND the
 * start must be strictly more than CANCEL_WINDOW_HOURS away.
 * `now` is injectable so tests/callers can freeze time.
 * @param {object}      appointment - row exposing `status`, `date`, `time`
 * @param {Date|number} [now]       - current time; defaults to Date.now()
 */
function canReschedule(appointment, now = Date.now()) {
    if (!appointment) return false;
    if (!canTransition(appointment.status, 'cancelled')) return false;
    const startAt = new Date(`${appointment.date}T${appointment.time}`);
    return new Date(startAt).getTime() - new Date(now).getTime() > CANCEL_WINDOW_HOURS * 3600 * 1000;
}

module.exports = {
    CANCEL_WINDOW_HOURS,
    canTransition,
    canCancel,
    canReschedule,
};

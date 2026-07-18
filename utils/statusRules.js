// Pure status-transition rules for Appointment.status.
// Kept here (not in a controller) so every caller applies the same rules
// and they can be unit-tested without a database.

const CANCEL_WINDOW_HOURS = 24;

// Allowed forward transitions. Anything not listed is illegal.
const ALLOWED_TRANSITIONS = {
    pending:   ['confirmed', 'declined', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
    declined:  [],   // terminal
    completed: [],   // terminal
    cancelled: [],   // terminal
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

module.exports = {
    CANCEL_WINDOW_HOURS,
    canTransition,
    canCancel,
};

/**
 * GreenLight pilot — email the driver (and the rider) when someone joins a trip.
 *
 * Paste this into the spreadsheet that receives BOTH form responses:
 *   Extensions → Apps Script → replace everything in Code.gs → Save.
 * Then:
 *   1. Run `checkSetup`  (allow access when Google asks) and read the log.
 *   2. Run `installTrigger` once. From then on it runs on every rider sign-up.
 * Optional: run `sendTestEmails` to email yourself a sample of both messages.
 *
 * Nothing here is shown on the website. The roster and responses stay private.
 */

// ---------------------------------------------------------------- settings
const SETTINGS = {
  senderName: "GreenLight",
  // Also send the rider a confirmation with the driver's name, email and car details.
  emailRider: true,
  // Copy every driver notification to the spreadsheet owner (for the pilot).
  bccOwner: false,

  // Rider form questions (exact titles from "GreenLight: Grab a Ride (riders)").
  rider: {
    name: "First and Last Name",
    email: "W&M email",
    year: "Class Year",
    trip: "Trip # you want to join",
  },

  // Driver form questions (exact titles from "GreenLight: Post a Ride (drivers)").
  driver: {
    name: "First and Last Name",
    email: "School email",
    destination: "Destination: Where are you driving?",
    date: "Date of trip",
    time: "Departure time",
    roundTrip: "Is this a round trip?",
    returnTime: "Return time",
    pickup: "Pickup spot",
    price: "Price per rider",
    car: "Car make & model",
    color: "Car color",
    plate: "License plate (optional)",
  },

  // Tab with "Trip #" and "Seats left" columns (your Public tab), so the driver
  // email can say how many seats remain. "" = find it automatically.
  seatsTab: "",
};

// ---------------------------------------------------------------- trigger
/** Runs on every form submission sent to this spreadsheet. */
function onFormSubmit(e) {
  const answers = e && e.namedValues ? flatten_(e.namedValues) : {};
  // Ignore driver submissions and anything else; only react to rider sign-ups.
  if (!(SETTINGS.rider.trip in answers)) return;

  const rider = {
    name: answers[SETTINGS.rider.name] || "A rider",
    email: (answers[SETTINGS.rider.email] || "").trim(),
    year: answers[SETTINGS.rider.year] || "",
  };
  const tripNo = cleanTrip_(answers[SETTINGS.rider.trip]);
  const trip = findTrip_(tripNo);

  if (!trip) {
    if (rider.email) {
      MailApp.sendEmail({
        to: rider.email,
        name: SETTINGS.senderName,
        subject: `GreenLight: we couldn't find Trip #${tripNo}`,
        body: `Hi ${firstName_(rider.name)},\n\nThanks for signing up! We couldn't find Trip #${tripNo} on the open rides list, so no driver was notified.\n\nPlease double-check the Trip # on the Open rides page and submit the form again.\n\n— GreenLight`,
      });
    }
    console.warn(`Trip #${tripNo} not found for rider ${rider.email}`);
    return;
  }

  SpreadsheetApp.flush();
  const seatsLeft = seatsLeft_(tripNo);
  notifyDriver_(trip, rider, tripNo, seatsLeft);
  if (SETTINGS.emailRider && rider.email) notifyRider_(trip, rider, tripNo);
}

// ---------------------------------------------------------------- emails
function notifyDriver_(trip, rider, tripNo, seatsLeft) {
  const lines = [
    `Hi ${firstName_(trip.name)},`,
    ``,
    `${rider.name} just asked to join your ride.`,
    ``,
    `RIDER`,
    `  Name: ${rider.name}`,
    `  Email: ${rider.email || "not given"}`,
    rider.year ? `  Class year: ${rider.year}` : null,
    ``,
    `YOUR TRIP (#${tripNo})`,
    ...tripLines_(trip),
    seatsLeft !== null ? `  Seats left: ${seatsLeft}` : null,
    ``,
    `Please reply to ${firstName_(rider.name)} to confirm the seat and pickup details. Replying to this email goes straight to them.`,
    ``,
    `— GreenLight`,
  ].filter((l) => l !== null);

  const opts = {
    to: trip.email,
    name: SETTINGS.senderName,
    subject: `GreenLight: ${rider.name} joined Trip #${tripNo} to ${trip.destination}`,
    body: lines.join("\n"),
  };
  if (rider.email) opts.replyTo = rider.email;
  if (SETTINGS.bccOwner) opts.bcc = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(opts);
}

function notifyRider_(trip, rider, tripNo) {
  const car = [trip.color, trip.car].filter(Boolean).join(" ");
  const lines = [
    `Hi ${firstName_(rider.name)},`,
    ``,
    `You're signed up for Trip #${tripNo}. We've let your driver know, and they'll reach out to confirm.`,
    ``,
    `TRIP`,
    ...tripLines_(trip),
    ``,
    `DRIVER`,
    `  Name: ${trip.name}`,
    `  Email: ${trip.email}`,
    car ? `  Car: ${car}` : null,
    trip.plate ? `  License plate: ${trip.plate}` : null,
    ``,
    `Questions or change of plans? Reply to this email to reach your driver.`,
    ``,
    `— GreenLight`,
  ].filter((l) => l !== null);

  MailApp.sendEmail({
    to: rider.email,
    name: SETTINGS.senderName,
    replyTo: trip.email,
    subject: `GreenLight: you're signed up for Trip #${tripNo} to ${trip.destination}`,
    body: lines.join("\n"),
  });
}

function tripLines_(t) {
  return [
    `  Destination: ${t.destination}`,
    t.date ? `  Date: ${t.date}` : null,
    t.time ? `  Departure: ${t.time}` : null,
    t.roundTrip ? `  ${t.roundTrip}${t.returnTime ? ` (return: ${t.returnTime})` : ""}` : null,
    t.pickup ? `  Pickup: ${t.pickup}` : null,
    t.price ? `  Price per rider: ${t.price}` : null,
  ].filter((l) => l !== null);
}

// ---------------------------------------------------------------- lookups
/** The driver responses tab: the one whose headers include the driver email + car questions. */
function driverSheet_() {
  const want = [SETTINGS.driver.email, SETTINGS.driver.car];
  return SpreadsheetApp.getActive().getSheets().find((sh) => {
    const head = headers_(sh);
    return want.every((w) => head.includes(w));
  }) || null;
}

/**
 * Finds a trip in the driver responses. Uses a "Trip #" column on that tab if
 * there is one; otherwise Trip # = response order (1st response = Trip #1).
 */
function findTrip_(tripNo) {
  const sh = driverSheet_();
  if (!sh || !tripNo) return null;
  const values = sh.getDataRange().getValues();
  const head = values.shift().map(String);
  const tripCol = head.findIndex((h) => /^trip\s*#?$|^trip\s*(no|number|id)\.?$/i.test(h.trim()));
  let row;
  if (tripCol > -1) row = values.find((r) => cleanTrip_(r[tripCol]) === tripNo);
  else row = values[Number(tripNo) - 1];
  if (!row || !row.some(String)) return null;

  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const get = (key) => {
    const i = head.indexOf(SETTINGS.driver[key]);
    if (i < 0) return "";
    const v = row[i];
    if (v instanceof Date) {
      if (key === "date") return Utilities.formatDate(v, tz, "EEE, MMM d, yyyy");
      if (key === "time") return Utilities.formatDate(v, tz, "h:mm a");
    }
    return String(v).trim();
  };
  const trip = {};
  Object.keys(SETTINGS.driver).forEach((k) => (trip[k] = get(k)));
  trip.tripColumn = tripCol > -1 ? head[tripCol] : null;
  return trip.email ? trip : null;
}

function seatsSheet_() {
  const ss = SpreadsheetApp.getActive();
  if (SETTINGS.seatsTab) return ss.getSheetByName(SETTINGS.seatsTab);
  return ss.getSheets().find((sh) => {
    const head = headers_(sh).map((h) => h.toLowerCase());
    return head.some((h) => /^trip/.test(h)) && head.some((h) => /seats left/.test(h));
  }) || null;
}

function seatsLeft_(tripNo) {
  const sh = seatsSheet_();
  if (!sh) return null;
  const values = sh.getDataRange().getValues();
  const head = values.shift().map((h) => String(h).trim().toLowerCase());
  const t = head.findIndex((h) => /^trip/.test(h));
  const s = head.findIndex((h) => /seats/.test(h));
  if (t < 0 || s < 0) return null;
  const row = values.find((r) => cleanTrip_(r[t]) === tripNo);
  return row ? row[s] : null;
}

// ---------------------------------------------------------------- helpers
function headers_(sh) {
  if (sh.getLastColumn() === 0) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h) => String(h).trim());
}
function flatten_(named) {
  const out = {};
  Object.keys(named).forEach((k) => (out[k.trim()] = [].concat(named[k]).join(", ").trim()));
  return out;
}
function cleanTrip_(v) {
  const m = String(v == null ? "" : v).match(/\d+/);
  return m ? String(Number(m[0])) : "";
}
function firstName_(full) {
  return String(full || "").trim().split(/\s+/)[0] || "there";
}

// ---------------------------------------------------------------- setup tools
/** Run this first. It reports what the script found, without sending anything. */
function checkSetup() {
  const ss = SpreadsheetApp.getActive();
  const log = [];
  log.push(`Spreadsheet: ${ss.getName()}`);
  log.push(`Tabs: ${ss.getSheets().map((s) => s.getName()).join(", ")}`);

  const drv = driverSheet_();
  if (!drv) {
    log.push(`✗ No tab has both "${SETTINGS.driver.email}" and "${SETTINGS.driver.car}" headers. Check the driver form is linked to this spreadsheet and the question titles in SETTINGS.driver match.`);
  } else {
    const head = headers_(drv);
    log.push(`✓ Driver responses tab: "${drv.getName()}" (${Math.max(0, drv.getLastRow() - 1)} rides)`);
    Object.keys(SETTINGS.driver).forEach((k) => {
      if (!head.includes(SETTINGS.driver[k])) log.push(`  ! Column not found for ${k}: "${SETTINGS.driver[k]}" (that detail will be left out)`);
    });
    const tripCol = head.find((h) => /^trip\s*#?$|^trip\s*(no|number|id)\.?$/i.test(h));
    log.push(tripCol
      ? `✓ Trip # comes from the "${tripCol}" column on that tab.`
      : `• No "Trip #" column on that tab, so Trip #1 = the 1st driver response, #2 = the 2nd, and so on. Make sure your Public tab numbers trips the same way.`);
    const t1 = findTrip_("1");
    log.push(t1 ? `✓ Trip #1 → ${t1.name}, ${t1.destination}, ${t1.date} ${t1.time}` : `• No Trip #1 found yet.`);
  }

  const riderTab = ss.getSheets().find((sh) => headers_(sh).includes(SETTINGS.rider.trip));
  log.push(riderTab
    ? `✓ Rider responses tab: "${riderTab.getName()}"`
    : `✗ No tab has a "${SETTINGS.rider.trip}" column. Link the rider form to this spreadsheet (Form → Responses → Link to Sheets → choose this spreadsheet).`);

  const seatsTab = seatsSheet_();
  log.push(seatsTab
    ? `✓ Seats left comes from the "${seatsTab.getName()}" tab.`
    : `• No tab with "Trip #" and "Seats left" columns, so driver emails won't include seats left.`);
  const triggers = ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "onFormSubmit");
  log.push(triggers.length ? `✓ Trigger installed: emails are live.` : `• Trigger not installed yet. Run installTrigger when the checks above look right.`);
  log.push(`Emails left today: ${MailApp.getRemainingDailyQuota()}`);
  console.log(log.join("\n"));
}

/** Run once to start sending emails on every rider sign-up. */
function installTrigger() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "onFormSubmit")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("onFormSubmit").forSpreadsheet(ss).onFormSubmit().create();
  console.log("✓ Installed. Rider sign-ups will now email the driver" + (SETTINGS.emailRider ? " and the rider." : "."));
}

/** Run to stop all emails. */
function removeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "onFormSubmit")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  console.log("Emails stopped.");
}

/** Emails YOU a sample of both messages using Trip #1, so you can see them. */
function sendTestEmails() {
  const me = Session.getEffectiveUser().getEmail();
  const trip = findTrip_("1");
  if (!trip) { console.log("Post at least one ride first (no Trip #1 found)."); return; }
  const sample = Object.assign({}, trip, { email: me });
  const rider = { name: "Test Rider", email: me, year: "Junior" };
  notifyDriver_(sample, rider, "1", seatsLeft_("1"));
  notifyRider_(sample, rider, "1");
  console.log(`Sent 2 test emails to ${me}.`);
}

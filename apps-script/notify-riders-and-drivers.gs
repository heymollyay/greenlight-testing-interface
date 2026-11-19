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

  // Only used if the driver responses tab has NO "Trip #" column: the Trip #
  // of the first driver response (then +1 for each response after it).
  // checkSetup suggests the right number if it doesn't match your Public tab.
  firstTripNumber: 1,

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
 * Every trip in the driver responses, as [{ tripNo, row, head }]. Uses a
 * "Trip #" column on that tab if there is one; otherwise numbers responses in
 * order starting at SETTINGS.firstTripNumber.
 */
function allTrips_() {
  const sh = driverSheet_();
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  const head = values.shift().map(String);
  const tripCol = head.findIndex((h) => /^trip\s*#?$|^trip\s*(no|number|id)\.?$/i.test(h.trim()));
  return values
    .map((row, i) => ({
      tripNo: tripCol > -1 ? cleanTrip_(row[tripCol]) : String(i + Number(SETTINGS.firstTripNumber || 1)),
      row,
      head,
      tripColumn: tripCol > -1 ? head[tripCol] : null,
    }))
    .filter((t) => t.tripNo && t.row.some((c) => String(c).trim()));
}

/** Finds one trip by its Trip #, with the driver's details. */
function findTrip_(tripNo) {
  if (!tripNo) return null;
  const hit = allTrips_().find((t) => t.tripNo === tripNo);
  if (!hit) return null;
  const { row, head } = hit;

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
  const trip = { tripNo };
  Object.keys(SETTINGS.driver).forEach((k) => (trip[k] = get(k)));
  return trip.email ? trip : null;
}

/** Trip numbers listed on the Public / seats tab, if there is one. */
function publicTripNumbers_() {
  const sh = seatsSheet_();
  if (!sh) return null;
  const values = sh.getDataRange().getValues();
  const head = values.shift().map((h) => String(h).trim().toLowerCase());
  const t = head.findIndex((h) => /^trip/.test(h));
  if (t < 0) return null;
  return values.map((r) => cleanTrip_(r[t])).filter(Boolean);
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
    const first = Number(SETTINGS.firstTripNumber || 1);
    log.push(tripCol
      ? `✓ Trip # comes from the "${tripCol}" column on that tab.`
      : `• No "Trip #" column on that tab, so the 1st driver response is Trip #${first}, the 2nd is #${first + 1}, and so on (firstTripNumber setting).`);

    const trips = allTrips_();
    if (!trips.length) log.push(`• No rides posted yet.`);
    trips.slice(0, 5).forEach((t) => {
      const d = findTrip_(t.tripNo);
      log.push(`  Trip #${t.tripNo} → ${d ? `${d.name}, ${d.destination}, ${d.date} ${d.time}` : "(row has no driver email)"}`);
    });
    if (trips.length > 5) log.push(`  …and ${trips.length - 5} more`);

    // Make sure the script and the Public tab use the same numbers.
    const pub = publicTripNumbers_();
    if (pub && pub.length && trips.length) {
      const mine = new Set(trips.map((t) => t.tripNo));
      const missing = pub.filter((n) => !mine.has(n));
      if (!missing.length) {
        log.push(`✓ Every Trip # on the "${seatsSheet_().getName()}" tab (${pub.map((n) => "#" + n).join(", ")}) matches a driver response.`);
      } else {
        log.push(`✗ The "${seatsSheet_().getName()}" tab lists ${pub.map((n) => "#" + n).join(", ")}, but the script numbers trips ${trips.map((t) => "#" + t.tripNo).join(", ")}. Riders would get the wrong driver.`);
        if (!tripCol) {
          const suggest = first + (Math.min(...pub.map(Number)) - Math.min(...trips.map((t) => Number(t.tripNo))));
          log.push(`  → If the Public tab lists every trip in the same order, set firstTripNumber: ${suggest} at the top of the script and run checkSetup again.`);
          log.push(`  → Or add a "Trip #" column to the driver responses tab with the same numbers the Public tab shows; the script will use it automatically.`);
        }
      }
    }
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

/** Emails YOU a sample of both messages using the first posted trip. */
function sendTestEmails() {
  const me = Session.getEffectiveUser().getEmail();
  const first = allTrips_()[0];
  const trip = first && findTrip_(first.tripNo);
  if (!trip) { console.log("No posted rides found yet. Post a ride with the driver form first."); return; }
  const sample = Object.assign({}, trip, { email: me });
  const rider = { name: "Test Rider", email: me, year: "Junior" };
  notifyDriver_(sample, rider, trip.tripNo, seatsLeft_(trip.tripNo));
  notifyRider_(sample, rider, trip.tripNo);
  console.log(`Sent 2 test emails to ${me} using Trip #${trip.tripNo} (${trip.destination}).`);
}

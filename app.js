/* GreenLight pilot — branded forms that submit to Google Forms, and a ride
   list read from the driver form's published response sheet.

   ============================ CONFIG ============================
   ridesCsv     Google Sheet → File → Share → Publish to web → (responses tab)
                → Comma-separated values (.csv). Paste that link here.
   driverForm / riderForm
     action     https://docs.google.com/forms/d/e/<FORM ID>/formResponse
     fields     one entry per question, in order:
                { entry: "entry.123", label, type, required, options, help }
                type: text | email | tel | number | paragraph | radio |
                      select | checkbox | date | time
   riderForm.rideEntry   entry of the rider question that says which ride
                         they're joining (filled in by "Join this ride").
   ================================================================ */
const CLASS_YEARS = ["Freshman", "Sophomore", "Junior", "Senior", "Grad"];
const CONFIG = {
  ridesCsv: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTPIRLo2J4ZxdP-7PNJr0oIAOHddzZu7uZC9vQea8mu0iQxlHzUGucuH_WdhQLx_bdXhztVa9snxqi9/pub?gid=0&single=true&output=csv",

  // "GreenLight: Post a Ride (drivers)"
  driverForm: {
    action: "https://docs.google.com/forms/d/e/1FAIpQLScbSWebAQRy9w9VQUhR6y4jnDKjNUoezq_k37X19HO12k_1Wg/formResponse",
    fields: [
      { entry: "entry.891814230", label: "First and last name", type: "text", required: true },
      { entry: "entry.420136623", label: "School email", type: "email", required: true },
      { entry: "entry.1417911234", label: "Class year", type: "radio", required: true, options: CLASS_YEARS },
      { entry: "entry.1945504748", label: "Destination: where are you driving?", type: "text", required: true, help: "E.g. Target, Richmond airport (RIC), home to NoVA" },
      { entry: "entry.1740888877", label: "Date of trip", type: "date", gDate: true, required: true },
      { entry: "entry.1286578297", label: "Departure time", type: "time", gTime: true, required: true },
      { entry: "entry.1202942766", label: "Is this a round trip?", type: "radio", required: true, options: ["One way", "Round trip"] },
      { entry: "entry.1361055587", label: "Return time", type: "text", help: "Put TBD if you're not sure yet or don't have to be back for an event." },
      { entry: "entry.889940948", label: "Pickup spot", type: "text", required: true, help: "E.g. Sadler Center, Zable Stadium lot, front of OTP, dorm (be specific)" },
      { entry: "entry.496914675", label: "How many open seats?", type: "number", required: true, min: 1, max: 8 },
      { entry: "entry.309499714", label: "Price per rider", type: "radio", required: true,
        options: ["0$ (free)", "$2", "$3", "$5", "$6", "$8", "$10", "$15", "$20", "$25"],
        help: "Each rider pays this amount. Suggested prices:\nAround Williamsburg (under 15 min): Free–$3\nAbout 30 min (e.g. Newport News): $5–8\nAbout 1 hour (e.g. Richmond airport): $10–15\n2+ hours (long trips home): $15–25+\nChoose Free if you're happy to just give a ride." },
      { entry: "entry.797561491", label: "Car make & model", type: "text", required: true, help: "Only shared with riders who claim a seat" },
      { entry: "entry.1450420201", label: "Car color", type: "text", required: true, help: "Only shared with riders who claim a seat" },
      { entry: "entry.355564399", label: "License plate (optional)", type: "text", help: "Only shared with riders who claim a seat, so they can confirm the right car." },
    ],
  },

  // "GreenLight: Grab a Ride (riders)"
  riderForm: {
    action: "https://docs.google.com/forms/d/e/1FAIpQLSd6l8p376HfBEIp8hCUHqyS89o_pTuwEtWoBItFi3c-O0nJIA/formResponse",
    rideEntry: "entry.1640271627",
    fields: [
      { entry: "entry.518492696", label: "First and last name", type: "text", required: true },
      { entry: "entry.98021149", label: "W&M email", type: "email", required: true },
      { entry: "entry.1327318132", label: "Class year", type: "radio", required: true, options: CLASS_YEARS },
      { entry: "entry.1640271627", label: "Trip # you want to join", type: "text", required: true, help: "Find the Trip # under Open rides, or tap “Join this ride” on a ride to fill it in." },
    ],
  },

  // Optional: if the sheet has a column with this name, only rows marked
  // yes / true / approved / x are shown.
  approvedColumn: "Approved",
  // Columns never shown on the page (case-insensitive, partial match). The
  // car details stay hidden because the form promises they're only shared
  // with riders who claim a seat.
  hiddenColumns: ["timestamp", "email", "phone", "approved", "car make", "car color", "license", "plate"],
};

(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- toast ---------- */
  const toastEl = $(".toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    requestAnimationFrame(() => toastEl.classList.add("is-visible"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 4000);
  }

  /* ---------- tabs ---------- */
  const tabs = $$(".tab");
  function selectTab(tab, focus) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $("#" + t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      selectTab(tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length], true);
    });
  });

  /* ---------- forms ---------- */
  function fieldHTML(f, i, formId) {
    const id = `${formId}-f${i}`;
    const req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : "";
    const help = f.help ? `<p class="help" id="${id}-help">${esc(f.help)}</p>` : "";
    const describe = `aria-describedby="${f.help ? id + "-help " : ""}${id}-err"`;
    const reqAttr = f.required ? " required" : "";
    const err = `<p class="err" id="${id}-err"></p>`;
    if (f.type === "radio" || f.type === "checkbox") {
      const opts = (f.options || []).map((o) =>
        `<label class="choice"><input type="${f.type}" name="${esc(f.entry)}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("");
      return `<div class="field" data-i="${i}"><fieldset ${describe}><legend>${esc(f.label)}${req}</legend>${help}<div class="choices">${opts}</div></fieldset>${err}</div>`;
    }
    let control;
    if (f.type === "paragraph") control = `<textarea id="${id}" name="${esc(f.entry)}"${reqAttr} ${describe}></textarea>`;
    else if (f.type === "select") control = `<select id="${id}" name="${esc(f.entry)}"${reqAttr} ${describe}><option value="">Choose…</option>${(f.options || []).map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
    else {
      const type = ["email", "tel", "number", "date", "time"].includes(f.type) ? f.type : "text";
      let extra = type === "email" ? ' autocomplete="email" inputmode="email"' : type === "tel" ? ' autocomplete="tel"' : "";
      if (type === "number") extra += ` inputmode="numeric"${f.min != null ? ` min="${f.min}"` : ""}${f.max != null ? ` max="${f.max}"` : ""}`;
      control = `<input id="${id}" name="${esc(f.entry)}" type="${type}"${extra}${reqAttr} ${describe}>`;
    }
    return `<div class="field" data-i="${i}"><label for="${id}">${esc(f.label)}${req}</label>${help}${control}${err}</div>`;
  }

  function buildForm(form, cfg, submitLabel, doneTitle, doneText) {
    const ready = /^https:\/\/docs\.google\.com\/forms\/.+\/formResponse$/.test(cfg.action) && cfg.fields.length;
    if (!ready) {
      form.innerHTML = `<p class="notice">This form isn't connected yet. Add its Google Form details in <code>app.js</code>.</p>`;
      return;
    }
    form.innerHTML =
      cfg.fields.map((f, i) => fieldHTML(f, i, form.id)).join("") +
      `<div class="gform__foot"><button class="btn btn--sun" type="submit">${esc(submitLabel)}</button>
       <p class="err" data-form-error role="alert"></p></div>
       <div class="done" hidden tabindex="-1"><img src="assets/car.webp" width="96" height="83" alt="">
       <h3>${esc(doneTitle)}</h3><p class="muted">${esc(doneText)}</p>
       <button class="btn btn--ghost" type="button" data-again>Submit another</button></div>`;

    const valueOf = (f, i) => {
      if (f.type === "radio") return ($(`input[name="${CSS.escape(f.entry)}"]:checked`, form) || {}).value || "";
      if (f.type === "checkbox") return $$(`input[name="${CSS.escape(f.entry)}"]:checked`, form).map((x) => x.value);
      return $(`#${form.id}-f${i}`).value.trim();
    };
    const setErr = (i, msg) => {
      const wrap = $(`.field[data-i="${i}"]`, form);
      $(".err", wrap).textContent = msg;
      const ctl = $("input, select, textarea, fieldset", wrap);
      msg ? ctl.setAttribute("aria-invalid", "true") : ctl.removeAttribute("aria-invalid");
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formErr = $("[data-form-error]", form);
      formErr.textContent = "";
      let firstBad = null;
      const body = new URLSearchParams();
      cfg.fields.forEach((f, i) => {
        const v = valueOf(f, i);
        const empty = Array.isArray(v) ? !v.length : !v;
        let msg = "";
        if (f.required && empty) msg = "This question is required.";
        else if (!empty && f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = "Enter a valid email, like name@wm.edu.";
        else if (!empty && f.type === "number" && (+v < (f.min ?? -Infinity) || +v > (f.max ?? Infinity))) msg = `Enter a number from ${f.min} to ${f.max}.`;
        setErr(i, msg);
        if (msg && firstBad === null) firstBad = i;
        if (empty) return;
        // Google Forms expects date/time questions split into parts.
        if (f.type === "date" && f.gDate) {
          const [y, m, d] = v.split("-");
          body.append(`${f.entry}_year`, y); body.append(`${f.entry}_month`, String(+m)); body.append(`${f.entry}_day`, String(+d));
        } else if (f.type === "time" && f.gTime) {
          const [h, mi] = v.split(":");
          body.append(`${f.entry}_hour`, h); body.append(`${f.entry}_minute`, mi);
        } else if (Array.isArray(v)) v.forEach((x) => body.append(f.entry, x));
        else body.append(f.entry, v);
      });
      if (firstBad !== null) {
        const wrap = $(`.field[data-i="${firstBad}"]`, form);
        ($("input, select, textarea", wrap) || wrap).focus();
        formErr.textContent = "Please fix the highlighted questions.";
        return;
      }
      const btn = $('button[type="submit"]', form);
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        // Google Forms can't be read cross-site; a completed request means it arrived.
        await fetch(cfg.action, { method: "POST", mode: "no-cors", body });
        $$(".field, .gform__foot", form).forEach((el) => (el.hidden = true));
        const done = $(".done", form);
        done.hidden = false; done.focus();
        toast(doneTitle);
      } catch (_) {
        formErr.textContent = "We couldn't send that. Check your connection and try again.";
      } finally {
        btn.disabled = false; btn.textContent = submitLabel;
      }
    });
    form.addEventListener("click", (e) => {
      if (!e.target.closest("[data-again]")) return;
      form.reset();
      $$(".field, .gform__foot", form).forEach((el) => (el.hidden = false));
      $(".done", form).hidden = true;
      ($("input, select, textarea", form) || form).focus();
    });
  }

  buildForm($("#driver-form"), CONFIG.driverForm, "Post my ride", "Ride posted!",
    "Thanks! Your ride will show under Open rides within a few minutes.");
  buildForm($("#rider-form"), CONFIG.riderForm, "Request a seat", "Request sent!",
    "Thanks! The driver will reach out to confirm your seat.");

  /* ---------- rides from the published sheet ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }

  const listEl = $("#ride-list"), emptyEl = $("#ride-empty"), metaEl = $("#ride-meta");
  let rides = [], headers = [];
  const isHidden = (h) => CONFIG.hiddenColumns.some((x) => h.toLowerCase().includes(x));
  const find = (re) => headers.find((h) => re.test(h));
  const cols = () => ({
    trip: find(/trip\s*(#|no\b|num|number|id)/i),
    to: find(/destination|\bwhere\b|\bto\b/i),
    date: find(/date|\bday\b/i),
    time: find(/departure|depart/i) || find(/^time$/i),
  });
  // Show names as "First L." on the public list.
  const shortName = (v) => {
    const parts = v.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : v;
  };
  const display = (h, v) => (/name/i.test(h) ? shortName(v) : v);

  function rideLabel(r) {
    const c = cols();
    if (c.trip && r[c.trip]) return r[c.trip];
    return [c.to && r[c.to], c.date && r[c.date], c.time && r[c.time]].filter(Boolean).join(" · ");
  }

  function render() {
    const q = $("#ride-search").value.trim().toLowerCase();
    const shown = rides.filter((r) => !q || Object.values(r).join(" ").toLowerCase().includes(q));
    const { trip, to, date, time } = cols();
    listEl.innerHTML = shown.map((r) => {
      const title = (to && r[to]) || r[headers.find((h) => !isHidden(h))] || "Ride";
      const when = [date && r[date], time && r[time]].filter(Boolean).join(" · ");
      const details = headers.filter((h) => !isHidden(h) && ![trip, to, date, time].includes(h) && r[h])
        .map((h) => `<div><dt>${esc(h)}</dt><dd>${esc(display(h, r[h]))}</dd></div>`).join("");
      const tripTag = trip && r[trip] ? `<span class="ride__trip">Trip #${esc(String(r[trip]).replace(/^#/, ""))}</span>` : "";
      return `<li class="ride"><div class="ride__head"><div>${tripTag}<h3 class="ride__title">${esc(title)}</h3></div>${when ? `<span class="ride__when">${esc(when)}</span>` : ""}</div>
        <div class="ride__body">${details ? `<dl>${details}</dl>` : ""}
        <div class="ride__actions"><button class="btn btn--sun" type="button" data-join="${rides.indexOf(r)}">Join this ride</button></div></div></li>`;
    }).join("");
    emptyEl.hidden = shown.length > 0;
    $("#ride-empty-text").textContent = rides.length ? "No rides match your search." : "No open rides yet. Check back soon!";
  }

  async function loadRides() {
    if (!CONFIG.ridesCsv) {
      metaEl.textContent = "";
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      $("#ride-empty-text").textContent = "The ride list isn't connected yet. Add the published sheet link in app.js.";
      return;
    }
    metaEl.textContent = "Loading rides…";
    try {
      const url = CONFIG.ridesCsv + (CONFIG.ridesCsv.includes("?") ? "&" : "?") + "t=" + Date.now();
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const rows = parseCSV(await res.text());
      headers = (rows.shift() || []).map((h) => h.trim());
      const approved = headers.find((h) => h.toLowerCase() === CONFIG.approvedColumn.toLowerCase());
      rides = rows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] || "").trim()])))
        .filter((r) => !approved || /^(y|yes|true|approved|x|✓)$/i.test(r[approved]));
      metaEl.textContent = `${rides.length} ${rides.length === 1 ? "ride" : "rides"} · updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      render();
    } catch (_) {
      metaEl.textContent = "Couldn't load rides right now. Try Refresh in a moment.";
    }
  }
  $("#ride-search").addEventListener("input", render);
  $("#ride-refresh").addEventListener("click", loadRides);
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-join]");
    if (!btn) return;
    const r = rides[+btn.dataset.join];
    selectTab($("#tab-join"), true);
    const idx = CONFIG.riderForm.fields.findIndex((f) => f.entry === CONFIG.riderForm.rideEntry);
    const input = idx > -1 && $(`#rider-form-f${idx}`);
    if (input && r) {
      input.value = rideLabel(r);
      toast("Ride details added to the form.");
    }
  });
  loadRides();
})();

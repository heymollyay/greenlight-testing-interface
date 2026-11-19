# GreenLight pilot (testing interface)

A barebones, GreenLight-branded test site for the pilot. It has three tabs:

- **Open rides**: reads the driver form's published response sheet and lists each ride.
- **Offer a ride**: a branded version of the "GreenLight: Post a Ride (drivers)" Google Form.
- **Join a ride**: a branded version of the "GreenLight: Grab a Ride (riders)" Google Form. "Join this ride" fills in the Trip #.

Answers go straight into the original Google Forms, so responses show up in the forms and their sheets as usual.

## Run it locally

```bash
python3 -m http.server 5174
```

Then open http://localhost:5174.

## Where to change things

Everything lives in the `CONFIG` block at the top of `app.js`:

| Setting | What it does |
| --- | --- |
| `ridesCsv` | Published CSV link of the sheet the ride list reads |
| `driverForm` / `riderForm` | Each form's `formResponse` link and its questions (`entry.…` ids, labels, choices) |
| `riderForm.rideEntry` | The rider question that "Join this ride" fills in (Trip #) |
| `approvedColumn` | If the sheet has this column, only rows marked yes / true / x are listed |
| `hiddenColumns` | Columns never shown on the page (timestamp, email, car details…) |

**If you edit a Google Form question**, update the matching field in `app.js`. Renaming a question is fine. Adding, removing or changing choices needs a code change.

## Privacy

Anyone with the published sheet link can download every column of that tab, even columns the page hides. Publish a separate tab that only has the public columns (Trip #, destination, date, time, pickup, seats, price, first name), not the raw responses tab.

## Emailing drivers when someone joins (Google Apps Script)

`apps-script/notify-riders-and-drivers.gs` runs inside the Google Sheet, not on the website. Each time someone submits the rider form, it:

- emails the **driver** the rider's name, email and class year, plus seats left (replying goes straight to the rider);
- emails the **rider** the trip details and the driver's name, email and car (make, color, plate), which the driver form promises are only shared with riders who claim a seat;
- if the Trip # doesn't exist, emails the rider to double-check it, and doesn't notify anyone else.

The roster and responses stay private in the sheet.

### Install (about 5 minutes)

Both forms must send responses to this spreadsheet (in each form: **Responses → Link to Sheets → Select existing spreadsheet**).

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Delete everything in `Code.gs`, paste in the whole contents of `apps-script/notify-riders-and-drivers.gs`, and click **Save**.
3. In the function menu at the top, choose **`checkSetup`** → **Run**. Google asks for permission the first time: **Review permissions** → choose your account → **Advanced → Go to (project) → Allow**. Then open **Execution log** and check every line has a ✓.
4. Optional: run **`sendTestEmails`** to get a sample of both emails (uses Trip #1) in your own inbox.
5. Run **`installTrigger`** once. Emails are now live.

To stop emails, run **`removeTrigger`**. Settings (sender name, whether riders get an email, question titles) are at the top of the script.

**Trip numbers:** if the driver responses tab has a `Trip #` column, the script uses it. If not, Trip #1 is the first driver response, #2 the second, and so on, so the Public tab must number trips the same way. `checkSetup` tells you which it's using and shows who Trip #1 is.

**Limits:** emails come from the Google account that installs the script. Free Gmail accounts can send about 100 a day (each sign-up uses 2).

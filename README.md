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

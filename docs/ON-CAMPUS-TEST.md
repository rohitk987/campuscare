# On-campus setup and GPS test

Two checks from the [pilot audit](PILOT-COMPLETION-AUDIT.md) can only be done on campus: real site and building boundaries, and a report from a physical phone. Do both in one visit before students are admitted. GPS is weaker indoors, so the aim is to find boundary and accuracy settings that work inside the buildings students will report from.

Bring two phones signed in at [campuscare-dln.pages.dev](https://campuscare-dln.pages.dev): one as the administrator, one as a test student with an active record (add one with **Student access → Add student**). Allow location and camera when the browser asks.

## 1. Map the site and buildings (administrator)

1. **Site.** Stand in the open near the middle of the campus. Open **Locations**, add the site and choose **Use current position**. Wait for a reading of about ±15 m or better before saving. Set **Radius in metres** so the circle just covers the campus boundary, and leave reporting off for now.
2. **Buildings.** For each block students will report from, stand at its centre (or outside, at the middle of its longest wall, if the reading inside is poor) and choose **Use current position**. Set the radius to reach the outer walls, usually 20 to 40 m. Where two circles would overlap, shrink both until they don't.
3. **Rooms.** Add each building's floors and rooms or areas. Use `Outdoor` as the level for grounds, parking and similar places.
4. Note every centre and radius you saved (a screenshot of each building is enough). Then open the site again and choose **Enable reporting at this site**.

## 2. Try reports at known spots (test student)

At each spot, choose **Report an issue**, run the location check and note the result and the ± accuracy it shows. You can cancel before the photo step except at the last spot.

| Spot | Expected result | Result | Accuracy shown |
| --- | --- | --- | --- |
| Ground floor of a mapped building, near a window | Passes; that building is marked (suggested) | | |
| Upper floor, middle of the same building | Passes, or asks for a better reading | | |
| Between two mapped buildings | Both appear under Building or zone | | |
| Open ground away from any mapped building | Refused: no mapped building or zone matches | | |
| Just inside the campus edge | Passes for the nearest building, or overlaps the boundary | | |
| Outside the main gate | Refused: outside this site | | |
| Anywhere off campus: open an existing complaint | Works; tracking needs no location | | |

## 3. One report from start to finish

From a mapped room, the test student submits a real report with a photo. Then the administrator (or an approved verifier) verifies it, assigns it, starts and resolves it, and the student confirms the fix and asks to reopen it once. Check that the student sees each update and that the photo opens only for staff and the reporter.

## 4. Adjust and record

- If indoor checks often fail with "Location accuracy is ±… m", raise **Settings → Maximum location uncertainty (metres)** in steps of 10 (it accepts up to 100), or move that building's centre and enlarge its radius. Retest the failing spot after each change.
- If a reading near the edge "overlaps the site boundary", enlarge the site radius a little rather than the accuracy limit.
- Record what you changed and the typical indoor accuracy in [the pilot audit](PILOT-COMPLETION-AUDIT.md), with the date.
- Sign out on both phones and check that complaints need a new code afterwards. Close the test complaint and mark the test student `withdrawn` if it was not a real student.

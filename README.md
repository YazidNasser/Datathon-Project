# Datathon-Project
# Vancouver Crime Heat Map

A simple, user-friendly web app that shows a heat map of reported crime in Vancouver, built on open data from the Vancouver Police Department (VPD). It helps people understand two things quickly: *"What does reported crime look like across the neighbourhoods I'm considering for housing?"* and *"What has been happening around here lately?"*

> **Team:** Crimes Against Humanity · **Datathon:** Datathon Season 2026 · **Status:** Build Session 1 – problem framing

---

## 1. Problem Evidence

### The problem is real

Moving to a new city means making a high-stakes housing decision about neighbourhoods you have never lived in. Safety is one of the first things newcomers want to know, but the information available is either anecdotal (Reddit threads, friends' opinions, "don't live near X") or buried in raw police data that is hard to interpret.

**When it happens:** while browsing rental listings, comparing two neighbourhoods, or deciding whether to book a viewing.
**Why it happens:** there is no simple, trustworthy way to compare neighbourhoods on reported crime at a glance.

**Our N of 1:**
> When I moved to Vancouver in 2026, I spent days trying to figure out which area of Vancouver was safer to live in. I ended up relying on AI to tell me which areas were safer, asking about one area at a time, and it would give me an analysis based on indicators such as violent crime rate and car break-ins. I also checked a bunch of Reddit comments, which were helpful but not that reliable.

- [x] I experience this problem myself
- [x] I am the **N of 1** user
- [x] I can clearly describe when and why the problem occurs
- [x] The problem is not hypothetical or invented for the Datathon

### Target users

| User | Need | Time window |
|---|---|---|
| **Newcomers to Vancouver** looking for housing (primary) | Compare neighbourhoods on reported crime before choosing where to live | Long-term trends (months to years) |
| **Residents who want recent activity** (secondary) | See what has happened nearby recently | Short-term (past days to weeks) |

### The problem deserves a solution

**Why a Google search or single prompt isn't enough:** a search returns opinions and news stories, not a comparison. Our own N of 1 experience shows the limits of AI prompts: we had to ask about one area at a time, couldn't see neighbourhoods side by side, and couldn't tell where the numbers came from or how current they were. A prompt also can't reliably summarize tens of thousands of geolocated incidents or keep up with data that is updated every weekday.

**Existing alternatives and what's missing:**

| Alternative | What it does well | What's missing for our users |
|---|---|---|
| **VPD GeoDASH** (official crime map) | Authoritative data, incident-level map, last 7 days by default | Built as a dot map of incidents, not a neighbourhood comparison. Hard to answer "how does area A compare to area B?" Violent crime has no map location. Desktop-optimized. |
| AI chat assistants | Fast, conversational answers | One area at a time, unclear sources, unknown freshness |
| Reddit / word of mouth | Local context and lived experience | Anecdotal, biased, outdated, inconsistent |
| Rental sites (Craigslist, Facebook Marketplace, etc.) | Listings | No crime information |
| News coverage | Context on major incidents | Skews toward dramatic events, not overall patterns |

**Our differentiation:**
- A heat map with neighbourhood-level summaries, designed for *comparison* rather than browsing individual incidents
- Neighbourhood summaries that can include violent crime, which can't be shown as points on a map (see Signal below)
- Mobile-friendly, since people check this while out viewing apartments
- Toggle between a long-term view (for housing) and a recent view (for short-term awareness)

- [x] The problem is complex enough that a single prompt or Google search does not already solve it
- [x] Solving it would create meaningful value
- [x] Existing tools do not already solve the problem just as well or better
- [x] I can explain what is missing from the current alternatives

### The scope is right

We are building a **microproduct**: one web page, one dataset, one core interaction.

**Useful first version (MVP):**
1. A map of Vancouver with a crime-density heat layer from VPD data
2. Filters for crime type and time range (e.g. last 30 days vs. last 12 months)
3. Click a neighbourhood to see a short summary (total incidents, most common crime types, trend vs. last year)

**Out of scope:** user accounts, real-time alerts, predictive "safety scores", coverage beyond the City of Vancouver, combining with rental listing data.

- [x] The problem is narrow enough to make meaningful progress during the Datathon
- [x] The solution does not require building an entire platform or company
- [x] I can define what a useful first version looks like

---

## 2. Data Evidence

### Source

**VPD GeoDASH Open Data** – [geodash.vpd.ca](https://geodash.vpd.ca/) · [FAQ](https://geodash.vpd.ca/docs/VPD_GeoDASH_FAQs.pdf)

Data is extracted from the PRIME BC Police Records Management System and filtered to comply with BC's Freedom of Information and Protection of Privacy Act (FIPPA). It counts "founded" incidents only, meaning police determined after investigation that the offence occurred. Dates reflect when the incident occurred, not when it was reported.

**Fields:** crime type, year/month/day/hour/minute, hundred block, neighbourhood, X/Y coordinates.

### Accessibility

- Downloadable as CSV from the GeoDASH open data page, covering incidents from 2003 onward
- Updated Monday to Friday (excluding statutory holidays)
- No API key or account needed
- We have downloaded the data and loaded the 2026 incidents (see Signal below). Sample data is in [`/data`](data/) and the exploration is in [`/notebooks`](notebooks/).

- [x] I know where the required data comes from
- [x] I can realistically access it during the Datathon
- [x] I have enough data to begin testing the idea

### Permission

**What we found (checked Oct 7, 2026):**
- Users must accept the GeoDASH disclaimer before accessing the data. The VPD, Vancouver Police Board, and City of Vancouver accept no liability for decisions made based on the data.
- No explicit open data licence was found on the GeoDASH site or in the FAQ. The site footer reads "© City of Vancouver, all rights reserved."
- The VPD cautions users not to rely on the data to make decisions about the specific safety level of a specific location or area.

**How we're handling it:**
- We are contacting the VPD (vpd@vpd.ca / gishelp@vpd.ca) to confirm that we may display and publicly host visualizations built from the Open Data CSV for a non-commercial, educational Datathon project, and whether attribution is required. _Status: awaiting reply._
- Our use is non-commercial and educational, with attribution to the VPD.
- Because of the VPD's caution, the app presents **patterns in reported crime** to help users ask better questions, not verdicts on whether an area is "safe" or "unsafe." We don't produce safety scores, and the UI repeats the VPD's caution.

- [x] I understand the license or terms of use _(disclaimer reviewed; no explicit licence published)_
- [ ] I am allowed to use the data for my intended purpose _(pending VPD confirmation)_
- [ ] I understand whether the data can be used commercially, educationally, or only under specific restrictions _(pending VPD confirmation)_

### Signal

**Why we expect signal:** two decades of geolocated incidents across all Vancouver neighbourhoods, with crime type and timestamp, is enough to show spatial patterns and trends over time.

**Initial exploration (2026 data, Jan 1 – Oct 2, 2026):**

| | Rows |
|---|---:|
| Rows read | 25,092 |
| Mapped (have a location) | 22,997 (92%) |
| No location (withheld for privacy) | 2,094 |
| Outside Vancouver | 1 |

**Mapped incidents by type:**

| Crime type | Incidents |
|---|---:|
| Other theft | 11,353 |
| Theft from cars | 4,275 |
| Mischief and vandalism | 4,137 |
| Traffic collisions with injury | 900 |
| Business break-ins | 841 |
| Bike theft | 609 |
| Home break-ins | 580 |
| Car theft | 291 |
| Fatal traffic collisions | 11 |
| **Total** | **22,997** |

**Key finding: violent crime is not on the map.** "Offence Against a Person" (robbery, assault, sexual assault) and homicide don't appear among the mapped incidents. The VPD randomizes or withholds locations for these offences, so they are very likely the 2,094 rows without a location. That's a significant gap, since violent crime is what newcomers care about most. If those rows still include a neighbourhood, we will include them in the neighbourhood summaries even though they can't appear on the heat map. _Next step: confirm whether the neighbourhood field is populated for these rows._

**Known limitations (and how we'll handle them):**

| Limitation | Impact | Mitigation |
|---|---|---|
| Violent crime has no map location | Heat map shows mostly property crime | Count violent crime at neighbourhood level in summaries; label the heat map clearly |
| Property crime locations are generalized to the hundred block and offset | Block-level precision isn't possible | Aggregate to neighbourhood/grid level; state this clearly in the UI |
| Only certain crime categories are included | Not a full picture of safety | Label the map as "reported crime in these categories," not "safety" |
| Raw counts favour busy areas (e.g. Downtown has more people and visitors) | Heat map may mislead newcomers | Explore normalizing by population or showing crime-type mix |
| SkyTrain crimes are excluded (Transit Police jurisdiction) | Gaps around transit stations | Note in the UI |
| Not true real-time; data lags by at least a day and classifications can change | Limits the "recent activity" use case | Frame as "recent" rather than "live" |
| Data reflects *reported* crime only | Under-reporting varies by crime type and area | Note in the UI |

- [x] The data contains information relevant to the problem
- [x] I believe there is enough signal in the data to support a useful solution
- [x] I have enough coverage, quality, and volume to test that assumption

---

## 3. Taking into Build Session 2

**Exit statement:**
> We have a real problem, we are the first users, solving it creates meaningful value, the scope is buildable, and we have access to data that can reasonably help solve it. Confirmation of permitted use from the VPD is pending.

**Open questions to resolve:**
- Do the no-location rows include a neighbourhood, so violent crime can be counted in summaries?
- How do we avoid the heat map unfairly stigmatizing neighbourhoods? (Normalization, clear labelling, showing crime-type mix.)
- How do we make the VPD's caution visible without cluttering a simple UI?
- What will the VPD confirm about permitted use?

**Build Session 2 plan:**
1. Clean the data and convert coordinates to latitude/longitude
2. Check the no-location rows for neighbourhood values
3. Exploratory analysis: incidents by neighbourhood, type, and time
4. Build the map with a heat layer and filters, designed first for newcomers
5. Add the neighbourhood summary panel
6. Test with team members acting as newcomers

**Proposed stack:** Python (standard library only) to clean the VPD CSV, convert UTM coordinates to lat/long, and output `web/data.json`. The frontend is a single `index.html` (plain HTML/CSS/JS, no build step) using Leaflet 1.9.4 + Leaflet.heat on OpenStreetMap tiles. It runs locally with `python -m http.server`. Everything is free, needs no API keys, and nothing extra to install.

---

## Repository Structure

```
├── README.md
├── data/          # raw and cleaned VPD data (or download script)
├── notebooks/     # exploratory analysis
└── app/           # frontend
```

## Disclaimer

This project uses VPD GeoDASH Open Data for non-commercial, educational purposes. It shows reported crime in selected categories only and should not be treated as a complete measure of safety. Following the VPD's guidance, it should not be relied on to make decisions about the safety of a specific location or area. Neither the VPD, the Vancouver Police Board, nor the City of Vancouver is responsible for this project.

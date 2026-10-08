# Vancouver Crime Heat Map

A simple, user-friendly web app that shows patterns of reported crime in Vancouver, built on open data from the Vancouver Police Department (VPD). It helps people quickly understand two things: *"How does reported crime compare across the neighbourhoods I'm considering for housing?"* and *"What kinds of incidents have been reported in a neighbourhood lately?"*

The app is one input to a newcomer's research, alongside visiting neighbourhoods, talking to locals, and other sources. It does not rate the safety of any location.

> **Team:** Crimes Against Humanity · **Datathon:** Datathon Season 2026 · **Status:** Build Session 1 – problem framing

---

## 1. Problem Evidence

### The problem is real

Moving to a new city means making a high-stakes housing decision about neighbourhoods you have never lived in. Crime is one of the first things newcomers want to know about, but the information available is either anecdotal (Reddit threads, friends' opinions, "don't live near X") or buried in raw police data that is hard to interpret.

**When it happens:** while browsing rental listings, comparing two neighbourhoods, or deciding whether to book a viewing.
**Why it happens:** there is no simple, transparent way to compare neighbourhoods on reported crime at a glance.

**Our N of 1:**
> When I moved to Vancouver in 2026, I spent days trying to figure out which area of Vancouver was safer to live in. I ended up relying on AI to tell me which areas were safer, asking about one area at a time, and it would give me an analysis based on indicators such as violent crime rate and car break-ins. I also checked a bunch of Reddit comments, which were helpful but not that reliable.

- [x] I experience this problem myself
- [x] I am the **N of 1** user
- [x] I can clearly describe when and why the problem occurs
- [x] The problem is not hypothetical or invented for the Datathon

### Target users

| User | Need | Time window |
|---|---|---|
| **Newcomers to Vancouver** looking for housing (primary) | Compare neighbourhoods on reported crime as context while researching where to live | Long-term trends (months to years) |
| **Residents interested in recent activity** (secondary) | See what kinds of incidents have been reported in their neighbourhood recently | Short-term (past weeks) |

### The problem deserves a solution

**Why a Google search or single prompt isn't enough:** a search returns opinions and news stories, not a comparison. Our N of 1 experience shows the limits of AI prompts: we had to ask about one area at a time, couldn't see neighbourhoods side by side, and couldn't tell where the numbers came from or how current they were. A prompt also can't reliably summarize tens of thousands of geolocated incidents or keep up with data that is refreshed weekly.

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
- Neighbourhood summaries that include violent crime, which can't be shown as points on a map (see Signal below)
- Transparent sourcing: every number links back to the VPD data and its known limitations
- Mobile-friendly, since people check this while out viewing apartments
- Toggle between a long-term view (for housing research) and a recent view (for short-term awareness)

- [x] The problem is complex enough that a single prompt or Google search does not already solve it
- [x] Solving it would create meaningful value
- [x] Existing tools do not already solve the problem just as well or better
- [x] I can explain what is missing from the current alternatives

### The scope is right

We are building a **microproduct**: one web page, one dataset, one core interaction.

**Useful first version (MVP):**
1. A map of Vancouver with a reported-crime density layer from VPD data, aggregated so it doesn't imply exact locations
2. Filters for crime type and time range (e.g. last 30 days vs. last 12 months)
3. Click a neighbourhood to see a short summary (total incidents, most common crime types, trend vs. last year)

**Out of scope:** user accounts, real-time alerts, predictive "safety scores," address- or block-level lookups, coverage beyond the City of Vancouver, combining with rental listing data.

- [x] The problem is narrow enough to make meaningful progress during the Datathon
- [x] The solution does not require building an entire platform or company
- [x] I can define what a useful first version looks like

---

## 2. Data Evidence

### Source

**VPD GeoDASH Open Data** – [geodash.vpd.ca](https://geodash.vpd.ca/) · [FAQ](https://geodash.vpd.ca/docs/VPD_GeoDASH_FAQs.pdf)

Data is extracted from the PRIME BC Police Records Management System and filtered to comply with BC's Freedom of Information and Protection of Privacy Act (FIPPA). It counts "founded" incidents only, meaning police determined after investigation that the offence occurred. Dates reflect when the incident occurred, not when it was reported.

**Fields:** crime type, year/month/day/hour/minute, hundred block, neighbourhood, X/Y coordinates (UTM Zone 10, offset for privacy).

### Accessibility

- Downloadable as CSV from the GeoDASH open data page, covering incidents from 2003 onward
- The Open Data CSV is scheduled to update weekly (Sunday mornings), with up to a week's delay from the VPD's internal system
- No API key or account needed
- We have downloaded the 2026 data and explored it (see Signal below). Download instructions are in [`data/README.md`](data/README.md) and the exploration is in [`/notebooks`](notebooks/).

- [x] I know where the required data comes from
- [x] I can realistically access it during the Datathon
- [x] I have enough data to begin testing the idea

### Permission

No open data licence is published. Access requires accepting the [GeoDASH disclaimer](https://geodash.vpd.ca/), and the site is marked "© City of Vancouver, all rights reserved." The disclaimer cautions users not to rely on the data to judge the safety of a specific location or area, and states that all locations are offset.

We have not sought separate permission. We limit our use to:
- **Non-commercial, educational use**, attributed to the VPD
- **Aggregated data only.** The raw CSV is not committed to this repo.
- **Patterns, not safety verdicts.** No safety scores or address-level lookups.

We will contact the VPD before any commercial use.

- [x] I understand the licence or terms of use
- [x] I am allowed to use the data for my intended purpose _(non-commercial, educational, within the limits above)_
- [x] I understand whether the data can be used commercially, educationally, or only under specific restrictions _(educational only; commercial use not confirmed)_

### Signal

**Why we expect signal:** two decades of incidents across all Vancouver neighbourhoods, with crime type, date, and (for most types) location, is enough to show neighbourhood-level patterns and trends over time.

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

**Key finding: violent crime can't be mapped, but it can be counted by neighbourhood.** All 2,094 rows without a location are violent crime: 2,088 "Offence Against a Person" (robbery, assault, sexual assault, domestic assault) and 6 homicides. Their hundred block reads "OFFSET TO PROTECT PRIVACY" and they have no coordinates, but **every one of them has a neighbourhood value**, spread across 24 neighbourhoods. So violent crime can't appear on the heat map, but it can be included in neighbourhood summaries. That matters, because violent crime is what newcomers care about most.

**Known limitations (and how we'll handle them):**

| Limitation | Impact | Mitigation |
|---|---|---|
| Violent crime has no map location | Heat map shows mostly property crime and collisions | Count violent crime at neighbourhood level in summaries; label the heat map "property crime and collisions" |
| Property crime locations are generalized to the hundred block and offset | Block-level precision isn't possible or appropriate | Aggregate to neighbourhood/grid level; cap map zoom; state this clearly in the UI |
| "Offence Against a Person" is one broad category with no time | Can't break violent crime down by type or time of day | Show it as a single neighbourhood-level count |
| Only certain crime categories are included | Not a full picture of safety | Label the map "reported incidents in these categories," not "safety" |
| Raw counts favour busy areas (e.g. Downtown has more residents, workers, and visitors) | Heat map may mislead newcomers and stigmatize neighbourhoods | Explore normalizing by population; show crime-type mix, not just totals |
| SkyTrain crimes are excluded (Transit Police jurisdiction) | Gaps around transit stations | Note in the UI |
| "All Offence" counting | Totals aren't comparable to Statistics Canada figures | Don't compare against StatCan; note in the UI |
| Not real-time; data lags up to about two weeks and classifications can change | Limits the "recent activity" use case | Frame as "recent" rather than "live"; show the data's last-updated date |
| Data reflects *reported* crime only | Under-reporting varies by crime type and area | Note in the UI |

- [x] The data contains information relevant to the problem
- [x] I believe there is enough signal in the data to support a useful solution
- [x] I have enough coverage, quality, and volume to test that assumption

---

## 3. Taking into Build Session 2

**Exit statement:**
> We have a real problem, we are the first users, solving it creates meaningful value, the scope is buildable, and we have access to data that can reasonably help solve it. Our use is limited to non-commercial, educational, attributed, and aggregated use, consistent with the VPD disclaimer.

**Resolved in Build Session 1:**
- ~~Do the no-location rows include a neighbourhood?~~ Yes. All 2,094 violent-crime rows have a neighbourhood, so violent crime can be counted in summaries.

**Open questions:**
- How do we avoid the heat map unfairly stigmatizing neighbourhoods? (Normalization, clear labelling, showing crime-type mix.)
- How do we make the VPD's caution visible without cluttering a simple UI?

**Build Session 2 plan:**
1. Clean the data and convert UTM coordinates to latitude/longitude
2. Aggregate incidents by neighbourhood, type, and month, including violent crime counts
3. Exploratory analysis: incidents by neighbourhood, type, and time
4. Build the map with an aggregated density layer and filters, designed first for newcomers
5. Add the neighbourhood summary panel with the VPD caution and data limitations
6. Test with team members acting as newcomers, checking that nobody reads the map as a safety rating

**Proposed stack:** Python (standard library only) to clean the VPD CSV, convert UTM coordinates to lat/long, aggregate, and output `app/data.json`. The frontend is a single `app/index.html` (plain HTML/CSS/JS, no build step) using Leaflet 1.9.4 + Leaflet.heat on OpenStreetMap tiles. It runs locally with `python -m http.server`. Everything is free, needs no API keys, and has nothing extra to install.

---

## Repository Structure

```
├── README.md
├── .gitignore     # excludes raw VPD CSVs
├── data/
│   └── README.md  # how to download the VPD data (raw CSV not committed)
├── notebooks/     # exploratory analysis
└── app/           # frontend + aggregated data.json
```

## Disclaimer

Data courtesy of the Vancouver Police Department, [GeoDASH Open Data](https://geodash.vpd.ca/). This project shows reported crime in selected categories only, with locations offset by the VPD. It is not a measure of safety and should not be relied on to judge a specific location or area. It is not affiliated with or endorsed by the VPD or the City of Vancouver.

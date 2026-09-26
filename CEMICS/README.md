# CEMICS — Community Employment Management & Intelligent Candidate Screening

A full-stack platform connecting **community members**, **employers**, and
**councillors** in a community, with AI-assisted candidate matching.

The councillor is the single point of contact between employers and the
community: employers post vacancies to the councillor (never directly to
community members), the councillor holds the full community register, finds
suitable candidates, and forwards ("refers") them to the employer. Community
members register and keep their profile/CV/documents up to date, but never
apply to a vacancy themselves — the councillor decides who gets put forward.

## What's included

- **Frontend** (root folder): the original CEMICS pages (`index.html`, `login.html`,
  `register.html`) plus four dashboards:
  - `dashboard-seeker.html` — the **community member** dashboard: keep your profile,
    CV and supporting documents up to date, and track the status of referrals your
    councillor has made on your behalf, plus any resulting interviews.
  - `dashboard-poster.html` — shared by **employers** and **councillors**: employers
    post vacancies, edit/close them, and review AI-ranked applicants who have been
    referred to them (shortlist, schedule interviews). Councillors additionally get
    a **Community Register** (every registered member, searchable) and an
    **All Vacancies** view (every open role, across every employer) with AI-ranked
    candidate suggestions per vacancy and a one-click "Refer to employer" action.
  - `dashboard-admin.html` — the **System Administrator** dashboard: manage every
    account (community members, employers, councillors, actors/partner orgs), monitor and
    remove any job post, view platform-wide reports, review login/security activity,
    and change system-wide settings.
  - `dashboard-actor.html` — a lightweight profile page for partner/actor accounts,
    which are created by the administrator rather than through public registration.
- **Backend** (`/backend`): a self-contained Node.js + Express API with an embedded
  SQLite database (no separate database server to install).

The backend serves the frontend directly, so the whole app runs from **one process,
one port** — no CORS setup or separate dev servers needed.

## Requirements

- Node.js 22.5+ (tested on Node 22 and 24). The database uses Node's built-in
  `node:sqlite` module, so there's nothing to compile — `npm install` never
  needs Python or Visual Studio build tools.

## Setup

```bash
cd backend
npm install
cp .env.example .env      # edit JWT_SECRET before going to production
npm start
```

Then open **http://localhost:4000** in your browser. That single URL serves:

- the public site (`/`, `/login.html`, `/register.html`)
- the dashboards (`/dashboard-seeker.html`, `/dashboard-poster.html`, `/dashboard-admin.html`, `/dashboard-actor.html`)
- the API (`/api/...`)
- uploaded files (`/uploads/...`)

The SQLite database file is created automatically at `backend/data/cemics.db` on
first run — nothing else to configure.

### Creating the first System Administrator account

Administrator accounts are **not** available on the public registration page —
create the first one from the command line:

```bash
cd backend
node create-admin.js "Jane" "Doe" jane@cemics.org.za "a-strong-password"
```

Or run `node create-admin.js` with no arguments to answer the prompts
interactively. Once created, log in normally at `/login.html` — the platform
routes admin accounts to `/dashboard-admin.html` automatically. From there, the
administrator can create additional admin, councillor, or actor/partner
accounts directly (see "Add Account" on the dashboard).

## How the roles work

| Role | Registers as | Can do |
|---|---|---|
| Community member | `seeker` | Register, upload a CV + supporting documents, keep a profile (qualification, field of interest, skills) up to date, track the status of referrals the councillor has made on their behalf, see scheduled interviews. Cannot browse vacancies or apply directly — that's the councillor's job. |
| Employer | `employer` | Post vacancies (sent to the councillor for matching), edit them, close/reopen them, view applicants who have been referred to them, ranked by AI match score, shortlist/reject/hire, schedule interviews (candidate is notified automatically). Employers only ever see community members who've been referred to one of their vacancies — never the full register — and only communicate through the councillor. |
| Councillor | `councillor` | Everything an employer can do, **plus**: the full Community Register (every registered member, searchable/filterable), an org-wide All Vacancies view (every employer's open roles, not just their own), AI-ranked candidate suggestions per vacancy, and the ability to refer a suitable community member to the employer. |
| Actor / Partner org | `actor` | Created by the administrator only. Has a basic profile page; intended for NGOs, training providers, or other community partners CEMICS wants to track. |
| System Administrator | `admin` | Created via `create-admin.js` only. Manage every account (activate/suspend/delete, or create new ones of any role), monitor and remove any job post, view platform-wide reports, review login/security activity, and change system settings (site name, support email, allow/disallow registrations, maintenance mode). |

Registration and login already exist in the original frontend (`register.html` /
`login.html`) — they now call the real backend (`/api/auth/register`,
`/api/auth/login`), store a JWT in `localStorage`, and redirect to the correct
dashboard for the account's role.

## The "intelligent screening" (AI shortlisting)

`backend/utils/scoring.js` implements a transparent, explainable scoring engine
(0–100), run both when the councillor is browsing suggested candidates for a
vacancy and the moment they refer someone. It compares:

- **Skills** — the community member's listed skills/cover note against the vacancy's
  required skills and description (keyword + phrase matching)
- **Qualification** — the member's highest qualification against the vacancy's
  minimum requirement, on a ranked scale (Grade 10 → Postgraduate)
- **Field of interest** — whether it matches the vacancy's industry

Candidates scoring **65+** are flagged "AI recommended" and referred applicants are
always returned to employers/councillors sorted highest-score-first, so the best
matches surface automatically. Every score comes with a breakdown
(`aiBreakdown` in the API) explaining *why* it scored that way — this is
important for fairness and for the councillor/employer who want to double-check the
AI's reasoning.

This is a rule-based engine so it works with **no external API key or cost**. If
you later want to swap in a large-language-model-based screener (e.g. calling the
Anthropic API to read full CV text), you only need to change `scoreApplication()`
in `scoring.js` — nothing in the routes or frontend needs to change.

## API overview

All endpoints are under `/api`. Authenticated requests send
`Authorization: Bearer <token>` (the token returned from register/login).

**Auth**
- `POST /api/auth/register` — `{ role, firstName, lastName, email, password, profile, ... }`
- `POST /api/auth/login` — `{ email, password }`
- `GET  /api/auth/me`

**Users**
- `PUT  /api/users/me` — update profile fields
- `POST /api/users/me/cv` — multipart upload, field name `cv`
- `POST /api/users/me/documents` — multipart upload, field name `documents` (up to 5)

**Vacancies**
- `GET  /api/vacancies` — councillor only, supports `?q=`, `?industry=`, `?status=`
- `GET  /api/vacancies/mine` — employer/councillor's own postings + applicant counts
- `GET  /api/vacancies/:id` — employer/councillor only
- `POST /api/vacancies` — employer/councillor only
- `PUT  /api/vacancies/:id`
- `PATCH /api/vacancies/:id/close`
- `PATCH /api/vacancies/:id/reopen`
- `DELETE /api/vacancies/:id`

**Applications** (created only via `POST /api/councillor/refer` — see below)
- `GET  /api/applications/mine` — community member's own referrals
- `GET  /api/applications/vacancies/:vacancyId` — ranked applicant list (vacancy owner or councillor only)
- `PATCH /api/applications/:id/status` — `{ status }` one of submitted/shortlisted/interview/rejected/hired
- `POST /api/applications/:id/interview` — `{ scheduledAt, mode, location, notes }`
- `GET  /api/applications/interviews/mine` — community member's scheduled interviews

**Councillor** (all require a `councillor` account)
- `GET  /api/councillor/members` — the full community register, supports `?q=`, `?skill=`, `?fieldOfInterest=`, `?qualification=`
- `GET  /api/councillor/members/:id` — one member's profile + referral history
- `GET  /api/councillor/vacancies` — every vacancy in the system, org-wide (not just self-posted), supports `?q=`, `?status=`
- `GET  /api/councillor/vacancies/:id/suggestions` — community members ranked by AI match score for that vacancy (excludes those already referred)
- `POST /api/councillor/refer` — `{ vacancyId, memberId, coverLetter }`, creates the application/referral and notifies both the employer and the member

**Notifications**
- `GET   /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

**Admin** (all require an `admin` account)
- `GET  /api/admin/stats` — dashboard summary counts
- `GET  /api/admin/users` — list/search/filter all accounts (`?role=`, `?q=`)
- `POST /api/admin/users` — create an account directly, any role
- `PUT  /api/admin/users/:id` — edit a user's profile fields
- `PATCH /api/admin/users/:id/status` — `{ isActive }` suspend/reactivate
- `DELETE /api/admin/users/:id` — remove an account and its related data
- `GET  /api/admin/jobs` — every vacancy in the system, with poster info
- `PUT  /api/admin/jobs/:id` / `PATCH /api/admin/jobs/:id/close` / `DELETE /api/admin/jobs/:id`
- `GET  /api/admin/reports` — aggregate counts (users, jobs by industry/status, applications by status, sign-ups by month, average AI match score)
- `GET  /api/admin/security/summary` — login activity + suspended account counts
- `GET  /api/admin/security/logins` — recent login attempts (`?onlyFailed=true`)
- `GET  /api/admin/settings` / `PUT /api/admin/settings` — site name, support email, allow-registrations toggle, maintenance mode

## Notes for production use

- Change `JWT_SECRET` in `.env` to a long random value.
- Put this behind HTTPS — passwords and JWTs must not travel over plain HTTP.
- The SQLite file is fine for a community-scale deployment; if you outgrow it,
  swap `backend/db.js` for a Postgres client — the route files only call the
  small set of query helpers in that file.
- Uploaded CVs/documents are stored on local disk under `backend/uploads/`. For a
  multi-server deployment, point this at shared/object storage instead.

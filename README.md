# Tamkeen Expo 2026 — Reservation System

Interactive floor plan and stand reservation system for Tamkeen Expo 2026.

## Features

- Interactive exhibition map with real-time stand availability
- Online stand reservation form
- Admin panel to manage, approve, and reject reservations
- Admin-controlled company name visibility on the public map
- Email invitations
- Sponsorship plan page

## Tech Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Database**: Firebase Firestore (REST API)
- **Hosting**: Vercel — [tamkeen-expo-reservation.vercel.app](https://tamkeen-expo-reservation.vercel.app)
- **Notifications**: Vercel serverless function (`/api/notify.js`)

## Project Structure

```
├── index.html            # Public reservation page (map + form)
├── admin-panel.html      # Admin dashboard
├── admin.html            # Admin login
├── exhibition_map.html   # Standalone map view
├── sponsoring_plan.html  # Sponsorship plan
├── email_invite.html     # Email invitation template
├── firestore.rules       # Firebase security rules
├── firebase.json         # Firebase config
└── deploy/               # Vercel deployment folder
    ├── index.html
    ├── admin-panel.html
    ├── admin.html
    ├── vercel.json
    └── api/
        └── notify.js
```

## Admin Panel

Access at `/admin-panel`. Features:
- View all reservations (pending, confirmed, rejected)
- Approve or reject reservations
- Toggle company name visibility on the public map
- Interactive floor plan view

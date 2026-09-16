# Peak District Trials Group Dates — live version

This folder is ready to deploy to the existing Vercel project. It uses the Supabase environment variables already connected to that project.

## One-time Supabase setup

1. Open the Supabase project.
2. Choose **SQL Editor → New query**.
3. Paste the complete contents of `Peak_District_Trials_Group_Supabase_Setup.sql` and press **Run**.
4. Go to **Authentication → URL Configuration**.
5. Set **Site URL** and an allowed **Redirect URL** to:
   `https://peak-district-trials-group-dates-ap.vercel.app/`

## Update Vercel

Replace the existing project files with everything in this folder, including the `api` folder, then redeploy. If GitHub is connected, commit and push the files and Vercel will deploy them automatically.

## First administrator

1. Open the deployed app and choose **Club sign in**.
2. Sign in with `martyhilltrials@gmail.com`.
3. Open the link received by email.

That address is automatically approved as the administrator.

## Add a club representative

1. The representative signs in once with their email address.
2. The administrator opens **Setup** in the app.
3. Add their club if necessary.
4. Assign the representative to the club and press **Approve**.

Club representatives can add and edit their own club's dates. Their dates remain pending until the administrator approves them. Visitors can only see approved dates.

## Live calendar subscription

The **Subscribe to Calendar** button uses this permanent feed:

`https://peak-district-trials-group-dates-ap.vercel.app/api/calendar.ics`

Only approved dates are included. Google Calendar, Apple Calendar and other compatible calendar apps periodically check the address for additions, changes and cancellations. The app updates the feed immediately, but each calendar provider controls its own refresh timing and may take several hours to display a change.

The live feed requires both `api/calendar.js` and the rewrite in `vercel.json`. Keep the complete `api` folder when updating the GitHub repository.

The PDF and Mobile HTML exports show a reminder that dates may change and that the live calendar subscription is the most up-to-date option.

## Security

The browser receives only the Supabase public URL and publishable/anonymous key. The app never sends the database password, secret key or service-role key to the browser. Supabase Row Level Security controls every read and change.

# Peak District Trials Group Dates — live version

This folder is ready to deploy to the existing Vercel project. It uses the Supabase environment variables already connected to that project.

## One-time Supabase setup

1. Open the Supabase project.
2. Choose **SQL Editor → New query**.
3. Paste the complete contents of `Peak_District_Trials_Group_Supabase_Setup.sql` and press **Run**.
4. Go to **Authentication → URL Configuration**.
5. Set **Site URL** and an allowed **Redirect URL** to:
   `https://peak-district-trials-group-dates-ap.vercel.app/`

### Updating an existing live installation

After uploading this version, run `Peak_District_Trials_Group_Update_Auto_Publish_Name_Email.sql` once in **Supabase → SQL Editor → New query**. Do not rerun the complete setup file. The update publishes any existing pending dates and changes future club dates to publish immediately.

## Update Vercel

Replace the existing project files with everything in this folder, including the `api` folder, then redeploy. If GitHub is connected, commit and push the files and Vercel will deploy them automatically.

## First administrator

1. Open the deployed app and choose **Club sign in**.
2. Sign in with `martyhilltrials@gmail.com`.
3. Open the link received by email.

That address is automatically approved as the administrator.

## Add a club representative

1. The representative enters their name and email address under **Club sign in**.
2. They open the secure sign-in link received by email.
3. The administrator receives an access-request notification at `martyhilltrials@gmail.com`.
4. The administrator opens **Setup** in the app.
5. Add their club if necessary.
6. Assign the representative to the club and press **Approve**.

The representative's name is stored only in their private access profile and is not shown on the calendar, PDF, Mobile HTML or calendar subscription. Once access is approved, club representatives can add and edit their own club's dates and those dates publish immediately without a second approval.

### Using more than one device

An approved representative can stay signed in on multiple devices, such as a laptop and mobile phone. On each additional device they choose **Club sign in**, enter the same name and email address, and open the new sign-in link on that device. Their existing club assignment and approval carry across automatically. Each sign-in link is single-use, so it should not be forwarded between devices. The administrator receives only the original pending-access notification, not a new request for every device.

## Administrator email notifications

The notification function uses Resend through Vercel. In Vercel:

1. Open the project and choose **Integrations/Marketplace**.
2. Add the **Resend** integration to this project.
3. Confirm that `RESEND_API_KEY` appears under **Settings → Environment Variables** for Production.
4. Redeploy the project after adding the integration.

The app defaults to `Peak District Trials Dates <onboarding@resend.dev>` while testing. Resend's testing sender normally delivers only to the email address associated with the Resend account. For unrestricted delivery, verify a sending domain in Resend and add this optional server-only Vercel variable:

`RESEND_FROM_EMAIL=Peak District Trials Dates <calendar@your-verified-domain.co.uk>`

Never place `RESEND_API_KEY` in GitHub or prefix it with `NEXT_PUBLIC_`.

## Live calendar subscription

The **Subscribe to Calendar** button uses this permanent feed:

`https://peak-district-trials-group-dates-ap.vercel.app/api/calendar.ics`

Published dates are included. Google Calendar, Apple Calendar and other compatible calendar apps periodically check the address for additions, changes and cancellations. The app updates the feed immediately, but each calendar provider controls its own refresh timing and may take several hours to display a change.

The live feed requires both `api/calendar.js` and the rewrite in `vercel.json`. Keep the complete `api` folder when updating the GitHub repository.

The PDF and Mobile HTML exports show a reminder that dates may change and that the live calendar subscription is the most up-to-date option.

## Security

The browser receives only the Supabase public URL and publishable/anonymous key. The app never sends the database password, secret key, service-role key or Resend key to the browser. Supabase Row Level Security controls every read and change. The email function accepts notification details only from the signed-in user's private Supabase profile.

# Stay To Myself: website, admin and Square checkout

## What this is

- **The website** (`/`) shows the brand, the story and the shop. Shoppers add items to a cart and pay on
  Square's secure checkout page.
- **The admin** (`/admin`) is where your team signs in to manage everything:
  - **Orders:** every paid website order, with the items, size, color, shipping address, email and phone.
    Mark each order New, Packed, Shipped or Canceled, and add a tracking number and a note.
  - **Products:** add, edit, reorder, hide or delete items. Set the price, sizes and description. Mark a
    size sold out. Add colors and upload photos from a phone or computer.
  - **Store settings:** open or close the shop, set the shipping fee, free shipping over an amount, sales
    tax, and size upcharges for larger sizes.
  - **Site content:** the top banner, tagline, founder story, stats and social links.
  - **Team:** add people, reset passwords, remove access, and change your own password.
- **Square** handles the money. Items do NOT need to be in the Square Item Library.

## What happens when someone buys

1. The shopper pays on Square's checkout page. **Square emails them a receipt.**
2. Square tells the site the order is paid (the "webhook"). The order appears in **Admin > Orders** as
   **New**, with everything needed to pack and ship it.
3. If email alerts are set up (step 5), **your team also gets an email with the full order details.**
4. The payment and order also show in the Square Dashboard, as before.

If the webhook is ever missed, click **Check Square for orders** in the admin. It pulls in any paid
website orders from the last 90 days without creating duplicates.

Note: marking an order Shipped in the admin does not email the customer or update Square. Send the
tracking number to the customer yourself for now.

---

## Setup (about 45 minutes, one time)

### 1. Put the site on Netlify

The admin and checkout need Netlify's server functions, so **drag-and-drop (Netlify Drop) will not work.**

1. Create a free GitHub account and a new repository. Upload everything in this folder **except**
   `node_modules` if it exists.
2. In Netlify: **Add new site > Import an existing project > GitHub**, and pick the repository. Leave the
   build settings as they are (they come from `netlify.toml`). Click **Deploy**.

Product data, photos, orders and logins are stored in Netlify Blobs, which is built into Netlify. There is
nothing extra to sign up for.

### 2. Get your Square keys

1. Go to https://developer.squareup.com and sign in with the Square account that should get paid.
2. Create an application (for example "STM Website").
3. **Credentials:** copy the **Sandbox access token** for testing.
4. **Locations:** copy the **Sandbox location ID**.

Never put a token in a website file or send it in a text or email. It only goes into Netlify.

### 3. Add the settings in Netlify

In Netlify go to **Site configuration > Environment variables** and add these:

| Name | What to put |
|---|---|
| `ADMIN_SECRET` | A long random string, 32+ characters. Mash the keyboard; nobody needs to remember it. |
| `ADMIN_SETUP_CODE` | A one-time code you make up, used only to create the first login. |
| `SQUARE_ACCESS_TOKEN` | Square access token |
| `SQUARE_LOCATION_ID` | Square location ID |
| `SQUARE_ENV` | `sandbox` while testing, `production` when live |
| `SITE_URL` | The site address, for example `https://staytomyself.netlify.app` (no slash at the end) |
| `SQUARE_WEBHOOK_URL` | `SITE_URL` + `/api/square-webhook`, for example `https://staytomyself.netlify.app/api/square-webhook` |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | From step 4 below |

Then **Deploys > Trigger deploy** so the settings take effect.

### 4. Connect the Square webhook

1. In the Square developer site, open your application > **Webhooks > Subscriptions > Add subscription**.
2. URL: the same value as `SQUARE_WEBHOOK_URL`, exactly.
3. Events: check **payment.created** and **payment.updated**.
4. Save, then copy the **Signature key** into Netlify as `SQUARE_WEBHOOK_SIGNATURE_KEY` and redeploy.

### 5. (Optional) Email alerts with full order details

1. Create a free account at https://resend.com and make an API key.
2. Add to Netlify: `RESEND_API_KEY`, `ALERT_EMAIL_TO` (one or more emails, separated by commas), and
   `ALERT_EMAIL_FROM`.
3. Until you own a domain, use `onboarding@resend.dev` as `ALERT_EMAIL_FROM`. In that mode Resend only
   delivers to the email you signed up to Resend with, so set `ALERT_EMAIL_TO` to that same email. After
   you buy a domain, verify it in Resend to send from your own address to anyone.

### 6. First login

1. Go to `your-site/admin`. It will say **Set up the admin**.
2. Enter the `ADMIN_SETUP_CODE`, your name, email and a password (10+ characters).
3. Go to **Team** and add Tyrone with a temporary password. Give it to him in person. He should change it
   under **Team > Change my password**.

### 7. Set real prices, then test

1. **Products:** fix every price (the starting ones are placeholders) and click **Save products**.
2. **Store settings:** set shipping, and sales tax after checking with your accountant. Square does not
   add tax for you on these orders.
   Also check the **Size upcharges** (starting at 2XL +$2, 3XL +$4, 4XL +$6, 5XL +$8). They are
   placeholders: set them to match what your printer charges for larger blanks.
3. With `SQUARE_ENV` = `sandbox`, buy something on the site using Square's test card
   `4111 1111 1111 1111`, any future date, any CVV. You should return to the site with a thank-you
   message, and the order should appear in **Admin > Orders** within a minute.

### 8. Go live

1. In the Square developer site, switch to **Production**. Copy the production access token and location
   ID, and add a production webhook subscription (same URL and events) to get its signature key.
2. Replace `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, and set
   `SQUARE_ENV` to `production`. Redeploy.
3. Place one small real order, check it shows up in the admin, then refund it in Square.

### Adding a domain later

Buy the domain, add it in Netlify under **Domain management**, then update `SITE_URL`,
`SQUARE_WEBHOOK_URL` and the Square webhook subscription URL to the new address.

## Good to know

- **Forgot password:** another team member can reset it under **Team**. If everyone is locked out, ask
  whoever manages Netlify for help.
- **Inventory** is not counted automatically. Check **Sold out** on a size when it runs out.
- **Customers can't change prices.** The checkout always uses the prices saved in the admin.
- `products.json` is only the starting product list. After the first save in the admin, the admin is the
  source of truth.

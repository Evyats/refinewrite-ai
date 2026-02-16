<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy RefineWrite AI

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1QUuYKjiZVxO0DKhAh89VhhTrgRgELVoM

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set environment variables in `.env.local`:
   - `OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE`
   - `OPENAI_MODEL=gpt-4o-mini`
   - `GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_HERE`
   - `ALLOWED_EMAIL=your-email@example.com`
3. Run the app (frontend + backend API):
   `npm run dev`

## Security model

- The OpenAI key is server-only (`OPENAI_API_KEY`) and is never sent to the browser.
- The frontend calls `/api/refine`, and the server calls OpenAI.

## Vercel deployment notes

Set these environment variables in your Vercel project:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional; defaults to `gpt-4o-mini`)
- `GOOGLE_CLIENT_ID`
- `ALLOWED_EMAIL`

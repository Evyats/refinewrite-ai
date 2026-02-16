<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy RefineWrite AI

## Run locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set environment variables in `.env.local`:
   - `OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE`
   - `OPENAI_MODEL=gpt-4o-mini`
   - `GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_HERE`
   - `ALLOWED_EMAIL=your-email@example.com`
   - Optional safeguards:
     - `LLM_REFINEMENT_ENABLED=true`
     - `MAX_INPUT_CHARS=20000`
     - `MAX_REQUESTS_PER_MINUTE_PER_IP=20`
     - `MAX_REQUESTS_PER_DAY_PER_IP=300`
     - `MIN_INTERVAL_BETWEEN_REQUESTS_MS=500`
     - `MAX_CONCURRENT_REFINES_PER_IP=2`
     - `MAX_CONCURRENT_REFINES_GLOBAL=40`
3. Run the app (frontend + backend API):
   `npm run dev`

## Validate changes

- Build: `npm run build`
- Tests: `npm test`

## Security model

- The OpenAI key is server-only (`OPENAI_API_KEY`) and never sent to the browser.
- The frontend calls `/api/refine`; the server calls OpenAI.

## Vercel deployment

Set these environment variables in your Vercel project:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional; defaults to `gpt-4o-mini`)
- `GOOGLE_CLIENT_ID`
- `ALLOWED_EMAIL`

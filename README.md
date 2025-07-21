# minecraft-ai-agent
This is our minecraft ai agent

## Running the minecraft server
java -Xmx2G -jar paper-1.20.4-499.jar

## Running the bot
npm run dev:bot

## Running the AI agent
(this currently has a single hard-coded prompt)
npm run dev:ai

## Deployment
from apps/api folder:

gcloud functions deploy stripe-api \
  --gen2 \
  --region=us-central1 \
  --runtime=nodejs22 \
  --entry-point=app \
  --source=. \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars STRIPE_SECRET_KEY=xxx,STRIPE_PRODUCT_ID_STARTER_TIER=xxx,STRIPE_PRODUCT_ID_PRO_TIER=xxx,STRIPE_PRODUCT_ID_ADMIN_TIER=xxx,DOMAIN=mcbuilderbot.com
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

gcloud functions deploy api \
  --gen2 \
  --region=us-central1 \
  --runtime=nodejs22 \
  --entry-point=app \
  --source=apps/api \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars STRIPE_SECRET_KEY=xxx,STRIPE_PRODUCT_ID_STARTER_TIER=xxx,STRIPE_PRODUCT_ID_PRO_TIER=xxx,STRIPE_PRODUCT_ID_ADMIN_TIER=xxx,DOMAIN=mcbuilderbot.com



gcloud functions deploy api \
  --gen2 \
  --region=us-central1 \
  --runtime=nodejs22 \
  --entry-point=app \
  --source=apps/api \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars OPENAI_API_KEY=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,STRIPE_SECRET_KEY=sk_test_51Rn8AjDGLEXOtfemrDGQZOFVVoUSf71Fla9Lc3yDry41M0VIGhOE0sbZ7BI2fTP8vcSAPDOnrLAObw9wtjUQieut00ihbANn84,STRIPE_PRODUCT_ID_STARTER_TIER=prod_SiZNEpedp2qqlD,STRIPE_PRODUCT_ID_PRO_TIER=prod_SiZNguPFUq2XUR,STRIPE_PRODUCT_ID_ADMIN_TIER=prod_SiZO2iNNV6oHdF,DOMAIN=mcbuilderbot.com





gcloud functions deploy webui \
  --gen2 \
  --region=us-central1 \
  --runtime=nodejs22 \
  --entry-point=app \
  --source=apps/webui \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars STRIPE_SECRET_KEY=xxx,STRIPE_PRODUCT_ID_STARTER_TIER=xxx,STRIPE_PRODUCT_ID_PRO_TIER=xxx,STRIPE_PRODUCT_ID_ADMIN_TIER=xxx,DOMAIN=mcbuilderbot.com
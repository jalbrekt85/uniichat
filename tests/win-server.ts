import { serve } from "../Server.ts";
await serve(Number(process.env.UNII_PORT ?? 18789), null);
